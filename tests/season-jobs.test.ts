import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryScheduler } from "../src/scheduler/scheduler.js";
import {
  DEFAULT_SEASON_JOB_TIMES,
  buildSeasonJobs,
  registerSeasonJobs,
  runDailySeasonJob,
  runLineupLockJob,
  runWaiverSweepJob
} from "../src/seasons/season-jobs.js";
import { SEASON_NOTIFICATION_TYPES } from "../src/notifications/season-alerts.js";
import type { SeasonJobDeps } from "../src/seasons/season-jobs.js";
import type { SeasonOrchestrationSummary } from "../src/seasons/season-orchestration.js";
import type { NotificationRecord, RefreshSummary, } from "../src/models/v1.js";
import type { SeasonRefreshSummary } from "../src/season-refresh.js";

const IN_SEASON = new Date(2026, 8, 22, 6, 0, 0); // Tuesday of week 2, 2026 (kickoff Sep 10).
const OFFSEASON = new Date(2026, 4, 15, 6, 0, 0); // May.

function refreshSummary(): SeasonRefreshSummary {
  return {
    snapshotId: "snap-1",
    season: "2026",
    scoringPeriod: "2026-W2",
    sources: { "espn": 12 },
    skipped: {},
    projectionsStored: 12,
    playersUpdated: 12,
    modelsRebuilt: 12,
    errors: []
  };
}

function orchestrationSummary(overrides: Partial<SeasonOrchestrationSummary> = {}): SeasonOrchestrationSummary {
  return {
    teamId: "team-001",
    leagueId: "league-001",
    starters: [{ playerId: "p1", slot: "RB" }],
    lineupExpectedPoints: 118.2,
    waiverCandidates: [],
    tradeCandidates: [],
    queued: [],
    ...overrides
  };
}

function newsSummary(): RefreshSummary {
  return {
    refreshed_at: IN_SEASON.toISOString(),
    league_id: "league-001",
    team_id: "team-001",
    snapshot_id: "snap-1",
    news_ingested: 3,
    injury_alerts: 1,
    projection_updates: 5,
    notifications_sent: 2,
    weekly_report_id: "rec-weekly-1"
  };
}

function deps(overrides: Partial<SeasonJobDeps> = {}): { deps: SeasonJobDeps; sent: NotificationRecord[] } {
  const sent: NotificationRecord[] = [];
  return {
    sent,
    deps: {
      clock: () => IN_SEASON,
      dataDir: "data-test",
      login: async () => {},
      seasonRefresh: async () => refreshSummary(),
      refresh: async () => newsSummary(),
      orchestrate: async () => orchestrationSummary(),
      notify: async (notifications) => { sent.push(...notifications); },
      ...overrides
    }
  };
}

test("daily job runs login -> projections -> news -> orchestrator in season", async () => {
  const seen: string[] = [];
  const { deps: jobDeps } = deps({
    login: async () => { seen.push("login"); },
    seasonRefresh: async (options) => {
      seen.push(`projections:${options.week}`);
      return refreshSummary();
    },
    refresh: async () => { seen.push("news"); return newsSummary(); },
    orchestrate: async (options) => {
      seen.push(`orchestrate:auto=${options.autoApproveLowRisk}`);
      return orchestrationSummary();
    }
  });

  const result = await runDailySeasonJob(jobDeps);

  assert.equal(result.skipped, false);
  assert.equal(result.scoringPeriod, "2026-W2");
  assert.deepEqual(seen, ["login", "projections:2", "news", "orchestrate:auto=false"]);
  assert.equal(result.errors.length, 0);
  assert.match(result.steps.projections, /12 projections stored/);
  assert.match(result.steps.news, /3 news item/);
  assert.match(result.steps.orchestrator, /118\.2 pts/);
});

test("season jobs pause in the offseason", async () => {
  const { deps: jobDeps, sent } = deps({
    clock: () => OFFSEASON,
    seasonRefresh: async () => { throw new Error("must not run in the offseason"); }
  });

  for (const run of [runDailySeasonJob, runLineupLockJob, runWaiverSweepJob]) {
    const result = await run(jobDeps);
    assert.equal(result.skipped, true);
    assert.match(result.skipReason ?? "", /regular season/i);
  }
  assert.equal(sent.length, 0);
});

test("premium login failure degrades to the free tier and alerts instead of aborting", async () => {
  const { deps: jobDeps, sent } = deps({
    login: async () => { throw new Error("401 Unauthorized"); }
  });

  const result = await runDailySeasonJob(jobDeps);

  assert.equal(result.skipped, false);
  assert.match(result.steps.login, /failed: 401/);
  assert.match(result.steps.projections, /12 projections stored/, "the loop still pulls projections");
  const alert = sent.find((n) => n.type === SEASON_NOTIFICATION_TYPES.sourceDegraded);
  assert.ok(alert, "a degraded-source alert is sent");
  assert.match(alert.body, /free-tier/);
});

test("missing Razzball credentials are skipped quietly", async () => {
  const original = { user: process.env.RAZZBALL_USERNAME, pass: process.env.RAZZBALL_PASSWORD };
  delete process.env.RAZZBALL_USERNAME;
  delete process.env.RAZZBALL_PASSWORD;
  try {
    const { deps: jobDeps, sent } = deps({ login: undefined });
    const result = await runDailySeasonJob(jobDeps);
    assert.match(result.steps.login, /skipped \(no Razzball credentials/);
    assert.equal(sent.filter((n) => n.type === SEASON_NOTIFICATION_TYPES.sourceDegraded).length, 0);
  } finally {
    if (original.user) process.env.RAZZBALL_USERNAME = original.user;
    if (original.pass) process.env.RAZZBALL_PASSWORD = original.pass;
  }
});

test("skipped projection sources raise a degraded alert but keep the run green", async () => {
  const { deps: jobDeps, sent } = deps({
    seasonRefresh: async () => ({ ...refreshSummary(), skipped: { "fftoday-rb": "Fetch failed with status 404." } })
  });

  const result = await runDailySeasonJob(jobDeps);

  assert.equal(result.skipped, false);
  assert.equal(result.errors.length, 0);
  const alert = sent.find((n) => n.type === SEASON_NOTIFICATION_TYPES.sourceDegraded);
  assert.ok(alert);
  assert.match(alert.title, /fftoday-rb/);
});

test("a failing step is recorded without stopping the rest of the loop", async () => {
  const { deps: jobDeps } = deps({
    seasonRefresh: async () => { throw new Error("store offline"); }
  });

  const result = await runDailySeasonJob(jobDeps);

  assert.match(result.steps.projections, /failed: store offline/);
  assert.match(result.steps.news, /3 news item/);
  assert.match(result.steps.orchestrator, /118\.2 pts/);
  assert.deepEqual(result.errors, ["season-refresh: store offline"]);
});

test("queued high-risk actions become approval requests, never executions", async () => {
  const { deps: jobDeps, sent } = deps({
    orchestrate: async () => orchestrationSummary({
      queued: [{
        actionId: "act-9",
        action: { type: "propose_trade", fromTeamId: "team-001", toTeamId: "team-002", givePlayerIds: ["p1"], receivePlayerIds: ["p2"] },
        risk: "high",
        rationale: "Propose +EV trade.",
        status: "pending",
        createdAt: IN_SEASON.toISOString(),
        expiresAt: IN_SEASON.toISOString()
      }]
    })
  });

  const result = await runDailySeasonJob(jobDeps);

  assert.equal(result.queuedForApproval, 1);
  const approval = sent.find((n) => n.type === SEASON_NOTIFICATION_TYPES.approvalRequest);
  assert.ok(approval);
  assert.match(approval.body, /pmt action-approve act-9/);
});

test("lineup lock job sends the final start/sit reminder", async () => {
  const { deps: jobDeps, sent } = deps();
  const result = await runLineupLockJob(jobDeps);

  assert.equal(result.job, "season-lineup-lock");
  assert.equal(result.notifications, 1);
  assert.equal(sent[0].type, SEASON_NOTIFICATION_TYPES.lineupLock);
  assert.match(sent[0].body, /RB:p1/);
});

test("waiver sweep job refreshes projections then reports targets", async () => {
  const seen: string[] = [];
  const { deps: jobDeps, sent } = deps({
    seasonRefresh: async () => { seen.push("projections"); return refreshSummary(); },
    orchestrate: async () => {
      seen.push("orchestrate");
      return orchestrationSummary({
        waiverCandidates: [{ type: "add_drop", teamId: "team-001", addPlayerIds: ["fa1"], dropPlayerIds: ["p9"] }]
      });
    }
  });

  const result = await runWaiverSweepJob(jobDeps);

  assert.deepEqual(seen, ["projections", "orchestrate"]);
  assert.equal(result.job, "season-waiver-sweep");
  const sweep = sent.find((n) => n.type === SEASON_NOTIFICATION_TYPES.waiverWindow);
  assert.ok(sweep);
  assert.match(sweep.body, /\+fa1 -p9/);
});

test("buildSeasonJobs schedules Mon-Sat daily, Sunday lock, Tuesday sweep", () => {
  const jobs = buildSeasonJobs({ clock: () => IN_SEASON });
  const byId = new Map(jobs.map((job) => [job.jobId, job]));

  assert.deepEqual(byId.get("season-daily")?.days, [1, 2, 3, 4, 5, 6]);
  assert.equal(byId.get("season-daily")?.time, DEFAULT_SEASON_JOB_TIMES.daily);
  assert.deepEqual(byId.get("season-lineup-lock")?.days, [0]);
  assert.equal(byId.get("season-lineup-lock")?.time, DEFAULT_SEASON_JOB_TIMES.lineupLock);
  assert.deepEqual(byId.get("season-waiver-sweep")?.days, [2]);
  assert.equal(byId.get("season-waiver-sweep")?.time, DEFAULT_SEASON_JOB_TIMES.waiverSweep);
});

test("registered season jobs fire through the scheduler on their day", async () => {
  const ran: string[] = [];
  const scheduler = new InMemoryScheduler();
  const { deps: jobDeps } = deps({
    times: { daily: "06:00", lineupLock: "11:00", waiverSweep: "13:00" },
    log: (result) => { ran.push(result.job); }
  });
  registerSeasonJobs(scheduler, jobDeps);

  // Sunday 2026-09-13 11:00 -> only the lineup-lock job.
  assert.deepEqual(await scheduler.runDue(new Date(2026, 8, 13, 11, 0, 0)), ["season-lineup-lock"]);
  // Tuesday 2026-09-15 13:00 -> only the waiver sweep.
  assert.deepEqual(await scheduler.runDue(new Date(2026, 8, 15, 13, 0, 0)), ["season-waiver-sweep"]);
  assert.deepEqual(ran, ["season-lineup-lock", "season-waiver-sweep"]);
  scheduler.stop();
});

test("registered season jobs do not overlap", async () => {
  let release: (() => void) | undefined;
  let started = 0;
  const { deps: jobDeps } = deps({
    orchestrate: async () => {
      started++;
      await new Promise<void>((resolve) => { release = resolve; });
      return orchestrationSummary();
    }
  });
  const scheduler = new InMemoryScheduler();
  registerSeasonJobs(scheduler, jobDeps);
  const first = scheduler.runDue(new Date(2026, 8, 13, 11, 0, 0));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = scheduler.runDue(new Date(2026, 8, 13, 11, 0, 0));
  release?.();
  await Promise.all([first, second]);
  assert.equal(started, 1);
  scheduler.stop();
});

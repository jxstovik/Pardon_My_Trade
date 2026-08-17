import { loginRazzball } from "../projections/razzball-auth.js";
import { runSeasonRefresh } from "../season-refresh.js";
import { runSeasonOrchestration } from "./season-orchestration.js";
import { getCurrentScoringPeriod, isOffseason, weekFromScoringPeriod } from "./nfl-calendar.js";
import {
  buildApprovalRequestNotifications,
  buildLineupLockNotification,
  buildSourceDegradedNotification,
  buildWaiverWindowNotification
} from "../notifications/season-alerts.js";
import {
  FRIDAY,
  MONDAY,
  SATURDAY,
  SUNDAY,
  THURSDAY,
  TUESDAY,
  WEDNESDAY,
  type ScheduledJob,
  type Scheduler
} from "../scheduler/scheduler.js";
import type { SeasonRefreshOptions, SeasonRefreshSummary } from "../season-refresh.js";
import type { SeasonOrchestrationOptions, SeasonOrchestrationSummary } from "./season-orchestration.js";
import type { NotificationRecord, RefreshSummary } from "../models/v1.js";

export type SeasonJobName = "season-daily" | "season-lineup-lock" | "season-waiver-sweep";

export interface SeasonJobTimes {
  /** Daily projection + advisory loop (Mon–Sat). */
  readonly daily: string;
  /** Sunday pre-lock start/sit reminder. */
  readonly lineupLock: string;
  /** Tuesday post-waiver-processing sweep. */
  readonly waiverSweep: string;
}

export const DEFAULT_SEASON_JOB_TIMES: SeasonJobTimes = {
  daily: "06:00",
  lineupLock: "11:00",
  waiverSweep: "13:00"
};

export const DAILY_JOB_DAYS = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY] as const;

export interface SeasonJobDeps {
  readonly clock?: () => Date;
  readonly dataDir?: string;
  readonly userId?: string;
  readonly teamId?: string;
  readonly season?: string;
  readonly times?: Partial<SeasonJobTimes>;
  /** Refresh the Razzball premium session. Throwing degrades to the free tier. */
  readonly login?: () => Promise<void>;
  readonly seasonRefresh?: (options: SeasonRefreshOptions) => Promise<SeasonRefreshSummary>;
  /** News/injuries/weekly-report pipeline; skipped when not wired in. */
  readonly refresh?: () => Promise<RefreshSummary>;
  readonly orchestrate?: (options: SeasonOrchestrationOptions) => Promise<SeasonOrchestrationSummary>;
  readonly notify?: (notifications: ReadonlyArray<NotificationRecord>) => Promise<void>;
  readonly log?: (result: SeasonJobResult) => void;
}

export interface SeasonJobResult {
  readonly job: SeasonJobName;
  readonly ranAt: string;
  readonly scoringPeriod: string;
  readonly skipped: boolean;
  readonly skipReason?: string;
  readonly steps: Record<string, string>;
  readonly notifications: number;
  readonly queuedForApproval: number;
  readonly errors: string[];
}

interface JobRunContext {
  readonly now: Date;
  readonly dataDir: string;
  readonly scoringPeriod: string;
  readonly week?: number;
  readonly steps: Record<string, string>;
  readonly notifications: NotificationRecord[];
  readonly errors: string[];
}

function times(deps: SeasonJobDeps): SeasonJobTimes {
  return {
    daily: deps.times?.daily ?? process.env.PMT_SEASON_DAILY_TIME ?? DEFAULT_SEASON_JOB_TIMES.daily,
    lineupLock: deps.times?.lineupLock ?? process.env.PMT_SEASON_LINEUP_LOCK_TIME ?? DEFAULT_SEASON_JOB_TIMES.lineupLock,
    waiverSweep: deps.times?.waiverSweep ?? process.env.PMT_SEASON_WAIVER_TIME ?? DEFAULT_SEASON_JOB_TIMES.waiverSweep
  };
}

function startContext(deps: SeasonJobDeps): JobRunContext {
  const now = (deps.clock ?? (() => new Date()))();
  const scoringPeriod = getCurrentScoringPeriod(now, deps.season);
  return {
    now,
    dataDir: deps.dataDir ?? process.env.PMT_DATA_DIR ?? "data",
    scoringPeriod,
    week: weekFromScoringPeriod(scoringPeriod),
    steps: {},
    notifications: [],
    errors: []
  };
}

function offseasonResult(job: SeasonJobName, context: JobRunContext): SeasonJobResult {
  return {
    job,
    ranAt: context.now.toISOString(),
    scoringPeriod: context.scoringPeriod,
    skipped: true,
    skipReason: "Outside the NFL regular season; season jobs are paused.",
    steps: {},
    notifications: 0,
    queuedForApproval: 0,
    errors: []
  };
}

async function finish(
  job: SeasonJobName,
  context: JobRunContext,
  deps: SeasonJobDeps,
  queuedForApproval: number
): Promise<SeasonJobResult> {
  if (context.notifications.length > 0 && deps.notify) {
    try {
      await deps.notify(context.notifications);
    } catch (cause) {
      context.errors.push(`notify: ${(cause as Error).message}`);
    }
  }
  const result: SeasonJobResult = {
    job,
    ranAt: context.now.toISOString(),
    scoringPeriod: context.scoringPeriod,
    skipped: false,
    steps: context.steps,
    notifications: context.notifications.length,
    queuedForApproval,
    errors: context.errors
  };
  deps.log?.(result);
  return result;
}

function alertContext(deps: SeasonJobDeps, context: JobRunContext, leagueId: string) {
  return {
    leagueId,
    userId: deps.userId ?? process.env.PMT_USER_ID ?? "manager-001",
    scoringPeriod: context.scoringPeriod,
    clock: () => context.now
  };
}

async function defaultLogin(dataDir: string): Promise<void> {
  const username = process.env.RAZZBALL_USERNAME;
  const password = process.env.RAZZBALL_PASSWORD;
  if (!username || !password) {
    throw new Error("NO_CREDENTIALS");
  }
  await loginRazzball(username, password, { dataDir });
}

/**
 * Best-effort premium login. A failure never aborts the loop: the projection
 * sources fall back to the free tier and the user gets a degraded-source alert
 * (doc 21 Phase 5).
 */
async function runLoginStep(deps: SeasonJobDeps, context: JobRunContext): Promise<void> {
  const login = deps.login ?? (() => defaultLogin(context.dataDir));
  try {
    await login();
    context.steps.login = "premium session refreshed";
  } catch (cause) {
    const message = (cause as Error).message;
    if (message === "NO_CREDENTIALS") {
      context.steps.login = "skipped (no Razzball credentials configured)";
      return;
    }
    context.steps.login = `failed: ${message}`;
    context.errors.push(`login: ${message}`);
    context.notifications.push(
      buildSourceDegradedNotification(alertContext(deps, context, process.env.PMT_LEAGUE_ID ?? ""), {
        source: "razzball-premium",
        reason: `Premium login failed (${message}).`,
        fallback: "free-tier Razzball projections"
      })
    );
  }
}

async function runProjectionStep(deps: SeasonJobDeps, context: JobRunContext): Promise<void> {
  const seasonRefresh = deps.seasonRefresh ?? runSeasonRefresh;
  try {
    const summary = await seasonRefresh({
      dataDir: context.dataDir,
      season: deps.season,
      week: context.week
    });
    context.steps.projections =
      `${summary.projectionsStored} projections stored for ${summary.scoringPeriod} ` +
      `across ${Object.keys(summary.sources).length} source(s)`;
    for (const error of summary.errors) context.errors.push(`season-refresh: ${error}`);
    for (const [source, reason] of Object.entries(summary.skipped ?? {})) {
      context.notifications.push(
        buildSourceDegradedNotification(alertContext(deps, context, process.env.PMT_LEAGUE_ID ?? ""), {
          source,
          reason,
          fallback: "the remaining configured sources"
        })
      );
    }
  } catch (cause) {
    const message = (cause as Error).message;
    context.steps.projections = `failed: ${message}`;
    context.errors.push(`season-refresh: ${message}`);
  }
}

async function runNewsStep(deps: SeasonJobDeps, context: JobRunContext): Promise<void> {
  if (!deps.refresh) {
    context.steps.news = "skipped (no refresh pipeline wired)";
    return;
  }
  try {
    const summary = await deps.refresh();
    context.steps.news =
      `${summary.news_ingested} news item(s), ${summary.injury_alerts} injury alert(s), ` +
      `report ${summary.weekly_report_id}`;
  } catch (cause) {
    const message = (cause as Error).message;
    context.steps.news = `failed: ${message}`;
    context.errors.push(`refresh: ${message}`);
  }
}

async function runOrchestrationStep(
  deps: SeasonJobDeps,
  context: JobRunContext
): Promise<SeasonOrchestrationSummary | undefined> {
  const orchestrate = deps.orchestrate ?? runSeasonOrchestration;
  try {
    const summary = await orchestrate({
      dataDir: context.dataDir,
      teamId: deps.teamId,
      autoApproveLowRisk: false
    });
    context.steps.orchestrator =
      `lineup ${Math.round(summary.lineupExpectedPoints * 100) / 100} pts, ` +
      `${summary.waiverCandidates.length} waiver, ${summary.tradeCandidates.length} trade, ` +
      `${summary.queued.length} awaiting approval`;
    return summary;
  } catch (cause) {
    const message = (cause as Error).message;
    context.steps.orchestrator = `failed: ${message}`;
    context.errors.push(`orchestrator: ${message}`);
    return undefined;
  }
}

/**
 * Daily 06:00 (Mon–Sat): premium login -> pull every configured projection
 * source -> news/injuries -> FF_Orchestrator (advisory only) -> notifications.
 */
export async function runDailySeasonJob(deps: SeasonJobDeps = {}): Promise<SeasonJobResult> {
  const context = startContext(deps);
  if (isOffseason(context.now)) {
    const result = offseasonResult("season-daily", context);
    deps.log?.(result);
    return result;
  }

  await runLoginStep(deps, context);
  await runProjectionStep(deps, context);
  await runNewsStep(deps, context);
  const orchestration = await runOrchestrationStep(deps, context);

  if (orchestration && orchestration.queued.length > 0) {
    context.notifications.push(
      ...buildApprovalRequestNotifications(
        alertContext(deps, context, orchestration.leagueId),
        orchestration.queued
      )
    );
  }

  return finish("season-daily", context, deps, orchestration?.queued.length ?? 0);
}

/** Sunday pre-lock: final start/sit reminder before kickoff. */
export async function runLineupLockJob(deps: SeasonJobDeps = {}): Promise<SeasonJobResult> {
  const context = startContext(deps);
  if (isOffseason(context.now)) {
    const result = offseasonResult("season-lineup-lock", context);
    deps.log?.(result);
    return result;
  }

  const orchestration = await runOrchestrationStep(deps, context);
  if (orchestration) {
    context.notifications.push(
      buildLineupLockNotification(alertContext(deps, context, orchestration.leagueId), {
        teamId: orchestration.teamId,
        starters: orchestration.starters,
        expectedPoints: orchestration.lineupExpectedPoints
      })
    );
  }

  return finish("season-lineup-lock", context, deps, orchestration?.queued.length ?? 0);
}

/** Tuesday post-waiver-processing: waiver-wire scan + trade review. */
export async function runWaiverSweepJob(deps: SeasonJobDeps = {}): Promise<SeasonJobResult> {
  const context = startContext(deps);
  if (isOffseason(context.now)) {
    const result = offseasonResult("season-waiver-sweep", context);
    deps.log?.(result);
    return result;
  }

  await runProjectionStep(deps, context);
  const orchestration = await runOrchestrationStep(deps, context);

  if (orchestration) {
    const alerts = alertContext(deps, context, orchestration.leagueId);
    context.notifications.push(
      buildWaiverWindowNotification(alerts, {
        teamId: orchestration.teamId,
        waiverCandidates: orchestration.waiverCandidates,
        tradeCandidates: orchestration.tradeCandidates
      })
    );
    if (orchestration.queued.length > 0) {
      context.notifications.push(...buildApprovalRequestNotifications(alerts, orchestration.queued));
    }
  }

  return finish("season-waiver-sweep", context, deps, orchestration?.queued.length ?? 0);
}

/** The three in-season jobs, ready to hand to a `Scheduler`. */
export function buildSeasonJobs(deps: SeasonJobDeps = {}): ScheduledJob[] {
  const schedule = times(deps);
  let running = false;
  const guarded = (job: () => Promise<void>): (() => Promise<void>) => async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } finally {
      running = false;
    }
  };
  return [
    {
      jobId: "season-daily",
      name: "Daily projections + advisory loop",
      time: schedule.daily,
      days: [...DAILY_JOB_DAYS],
      handler: guarded(async () => { await runDailySeasonJob(deps); })
    },
    {
      jobId: "season-lineup-lock",
      name: "Sunday lineup-lock reminder",
      time: schedule.lineupLock,
      days: [SUNDAY],
      handler: guarded(async () => { await runLineupLockJob(deps); })
    },
    {
      jobId: "season-waiver-sweep",
      name: "Tuesday waiver + trade sweep",
      time: schedule.waiverSweep,
      days: [TUESDAY],
      handler: guarded(async () => { await runWaiverSweepJob(deps); })
    }
  ];
}

export function registerSeasonJobs(scheduler: Scheduler, deps: SeasonJobDeps = {}): ScheduledJob[] {
  const jobs = buildSeasonJobs(deps);
  for (const job of jobs) scheduler.register(job);
  return jobs;
}

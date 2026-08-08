import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultConfig } from "./config/app-config.js";
import { FixturePlatformReader } from "./adapters/fixture/fixture-platform-reader.js";
import { SleeperPlatformReader } from "./adapters/sleeper/sleeper-platform-reader.js";
import { buildSnapshotFromPlatform } from "./knowledge/ingestion.js";
import { ScoringRuleEngine } from "./rules/rule-engine.js";
import { DefaultDecisionEngine } from "./decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "./recommendations/recommendation-engine.js";
import { SqliteKnowledgeRepository } from "./knowledge/sqlite-knowledge-repository.js";
import { SqliteV1Store } from "./history/sqlite-v1-store.js";
import { InMemoryKnowledgeRepository } from "./knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "./history/v1-store.js";
import { FixtureNewsSource } from "./news/news-source.js";
import { ConsoleNotificationProvider, FileNotificationProvider } from "./notifications/notification-provider.js";
import { loadFixtureSnapshotSource, ingestFixtureSnapshot } from "./knowledge/ingestion.js";
import { runRefresh } from "./pipeline/refresh.js";
import { createApiServer } from "./api/server.js";
import { loadEnv } from "./config/load-env.js";
import { EspnPlatformReader } from "./adapters/espn/espn-platform-reader.js";
import { EspnProjectionSource } from "./projections/espn-projection-source.js";
import { buildProjectionSources } from "./projections/projection-source-registry.js";
import { matchProjectionsToRoster } from "./projections/projection-matching.js";
import { mergeProjections } from "./agents/snapshot-integration.js";
import { runProjectionsCommand, runRazzballLogin } from "./cli-projections.js";
import { runSeasonRefresh } from "./season-refresh.js";
import { JsonModelStore } from "./probabilistic/model-store.js";
import { buildPriorsFromSnapshot, buildOrchestratorInputFromSnapshot, mergeProjectionCandidates } from "./agents/snapshot-integration.js";
import { buildModels, applyObservations, rankByValue } from "./probabilistic/model-engine.js";
import { runOrchestrator, buildModelsForOrchestrator } from "./agents/ff-orchestrator.js";
import { ActionQueue, JsonActionQueueStore } from "./agents/action-queue.js";
import { InMemoryScheduler } from "./scheduler/scheduler.js";
import { registerSeasonJobs, runDailySeasonJob } from "./seasons/season-jobs.js";
import { runSeasonOrchestration } from "./seasons/season-orchestration.js";
import type { SeasonJobDeps } from "./seasons/season-jobs.js";
import type { KnowledgeRepository } from "./knowledge/repository.js";
import type { V1Store } from "./history/v1-store.js";
import type { NotificationProvider } from "./notifications/notification-provider.js";
import type { ModelPrior, Observation } from "./probabilistic/bayesian-model.js";
import type { OrchestratorInput } from "./agents/types.js";

const command = process.argv[2] ?? "help";

async function main(): Promise<void> {
  loadEnv();
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "version":
    case "--version":
      console.log("pardon-my-trade 0.2.0");
      return;
    case "import-fixture": {
      const config = createDefaultConfig();
      const reader = new FixturePlatformReader(config.fixturePath);
      const league = await reader.getLeague("pmt-demo-football", "2026");
      const teams = await reader.getTeams(league.external_id);
      const players = await reader.getPlayers(league.sport, league.season);
      const freeAgents = await reader.getFreeAgents(league.external_id);

      console.log(JSON.stringify({
        leagueId: league.league_id,
        name: league.name,
        sport: league.sport,
        season: league.season,
        teams: teams.length,
        players: players.length,
        freeAgents: freeAgents.length
      }, null, 2));
      return;
    }
    case "weekly-report": {
      const { runWeeklyReport } = await import("./pipeline/weekly-report.js");
      const config = createDefaultConfig();
      const leagueExternalId = process.argv[3] ?? "pmt-demo-football";
      const teamExternalId = process.argv[4] ?? "team-001";

      const result = await runWeeklyReport(config.fixturePath, leagueExternalId, teamExternalId);
      console.log(JSON.stringify({
        team: result.team.name,
        lineupValid: result.lineupEvaluationValid,
        projectedPoints: result.inputs.currentProjectedPoints,
        lineupCandidates: result.inputs.lineupCandidates.length,
        waiverCandidates: result.inputs.waiverCandidates.length,
        dropCandidates: result.inputs.dropCandidates.length,
        tradeCandidates: result.inputs.tradeCandidates.length,
        recommendation: {
          id: result.report.recommendation_id,
          type: result.report.type,
          confidence: result.report.confidence,
          status: result.report.status
        }
      }, null, 2));
      return;
    }
    case "refresh": {
      const config = createDefaultConfig();
      const leagueExternalId = process.argv[3] ?? "pmt-demo-football";
      const teamExternalId = process.argv[4] ?? "team-001";
      const repository = new InMemoryKnowledgeRepository();
      const v1Store = new InMemoryV1Store();
      const ruleEngine = new ScoringRuleEngine();
      const decisionEngine = new DefaultDecisionEngine(ruleEngine);
      const recommendationEngine = new DefaultRecommendationEngine(ruleEngine);
      const newsPath = process.env.PMT_NEWS_PATH ?? "tests/fixtures/sample-news.json";

      const summary = await runRefresh({
        fixturePath: config.fixturePath,
        newsPath,
        leagueExternalId,
        teamExternalId,
        repository,
        v1Store,
        ruleEngine,
        decisionEngine,
        recommendationEngine,
        notificationProviders: [new ConsoleNotificationProvider()]
      });
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    case "import-sleeper": {
      const leagueId = process.argv[3];
      if (!leagueId) {
        throw new Error("import-sleeper requires a Sleeper league id: pmt import-sleeper <leagueId> [season]");
      }
      const season = process.argv[4] ?? new Date().getFullYear().toString();
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      await mkdir(dataDir, { recursive: true });

      const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
      const reader = new SleeperPlatformReader();
      const snapshot = await buildSnapshotFromPlatform(reader, leagueId, season);

      await repository.saveLeagueSnapshot(snapshot);
      const pointer = { snapshot_id: snapshot.snapshot_id, league_id: snapshot.league.league_id };
      await writeFile(join(dataDir, "last-snapshot.json"), JSON.stringify(pointer), "utf8");

      console.log(JSON.stringify({
        message: "Imported Sleeper league snapshot (read-only).",
        snapshotId: snapshot.snapshot_id,
        league: snapshot.league.name,
        teams: snapshot.league.teams.length,
        players: snapshot.players.length,
        freeAgents: snapshot.free_agents.length,
        note: "Projections and news are empty until a projection source is connected. Run `pmt serve` to view."
      }, null, 2));
      return;
    }
    case "serve": {
      const config = createDefaultConfig();
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      await mkdir(dataDir, { recursive: true });

      const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
      const v1Store = new SqliteV1Store({ filePath: join(dataDir, "pmt-v1.db") });
      const ruleEngine = new ScoringRuleEngine();
      const decisionEngine = new DefaultDecisionEngine(ruleEngine);
      const recommendationEngine = new DefaultRecommendationEngine(ruleEngine);
      const newsPath = process.env.PMT_NEWS_PATH ?? "tests/fixtures/sample-news.json";

      const initialSource = await loadFixtureSnapshotSource(config.fixturePath);
      try {
        await ingestFixtureSnapshot(config.fixturePath, repository);
      } catch {
        // Snapshot already ingested from a previous run; reuse existing.
      }
      const initialSnapshot0 = await repository.getLeagueSnapshot(initialSource.snapshot_id) ?? initialSource;
      let initialSnapshot = initialSnapshot0;

      try {
        const pointerRaw = await readFile(join(dataDir, "last-snapshot.json"), "utf8");
        const pointer = JSON.parse(pointerRaw) as { snapshot_id: string };
        const imported = await repository.getLeagueSnapshot(pointer.snapshot_id);
        if (imported) {
          initialSnapshot = imported;
        }
      } catch {
        // No previously imported snapshot; fall back to the fixture.
      }

      const doRefresh = () => runRefresh({
        fixturePath: config.fixturePath,
        newsPath,
        leagueExternalId: "pmt-demo-football",
        teamExternalId: "team-001",
        repository,
        v1Store,
        ruleEngine,
        decisionEngine,
        recommendationEngine,
        notificationProviders: [
          new ConsoleNotificationProvider(),
          new FileNotificationProvider(join(dataDir, "notifications.log"))
        ]
      });

      const port = Number(process.env.PMT_PORT ?? 3000);
      const server = createApiServer({ repository, v1Store, refresh: doRefresh, initialSnapshot });
      server.listen(port, () => {
        console.log(`Pardon My Trade GUI running at http://localhost:${port}`);
      });

      if (process.argv.includes("--scheduler")) {
        const scheduler = new InMemoryScheduler();
        const jobs = registerSeasonJobs(scheduler, buildSeasonJobDeps(dataDir, { repository, v1Store }));
        scheduler.start();
        console.log(`Season scheduler started: ${jobs.map((job) => `${job.jobId}@${job.time}`).join(", ")}`);
      }
      return;
    }
    case "import-espn": {
      const leagueId = process.argv[3];
      if (!leagueId) {
        throw new Error("import-espn requires a league id: pmt import-espn <leagueId> [season]");
      }
      const season = process.argv[4] ?? new Date().getFullYear().toString();
      const teamId = process.argv[5];
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      await mkdir(dataDir, { recursive: true });

      const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
      const reader = new EspnPlatformReader();
      let snapshot = await buildSnapshotFromPlatform(reader, leagueId, season);

      // Best-effort: seed model priors with real projections from the
      // configured sources (default: ESPN only; opt in via
      // PMT_PROJECTION_SOURCES=razzball,fftoday,espn). Matched to roster
      // players by name so imported leagues use real projected points.
      const projectionSources = buildProjectionSources({
        sources: process.env.PMT_PROJECTION_SOURCES,
        season,
        dataDir
      });
      const rosterPlayers = [...snapshot.players, ...snapshot.free_agents];
      for (const source of projectionSources) {
        try {
          const candidates = await source.fetchProjections("football", season, `${season}-W01`);
          const projections = matchProjectionsToRoster(candidates, rosterPlayers, `${season}-W01`, source.name);
          snapshot = mergeProjections(snapshot, projections);
        } catch {
          // Source unavailable; fall back to remaining sources / baselines.
        }
      }

      await repository.saveLeagueSnapshot(snapshot);
      const pointer = { snapshot_id: snapshot.snapshot_id, league_id: snapshot.league.league_id };
      await writeFile(join(dataDir, "last-snapshot.json"), JSON.stringify(pointer), "utf8");

      const chosenTeam = teamId ?? snapshot.league.teams[0].team_id;
      const priors = buildPriorsFromSnapshot(snapshot);
      const models = buildModelsForOrchestrator(priors, []);
      const modelStore = new JsonModelStore(join(dataDir, "models.json"));
      await modelStore.saveAll([...models.values()]);

      const queue = new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));
      const input = buildOrchestratorInputFromSnapshot(snapshot, chosenTeam, models);
      const result = await runOrchestrator({ input, priors, queue, autoApproveLowRisk: false });

      console.log(JSON.stringify({
        message: "Imported ESPN league snapshot and ran the FF_Orchestrator.",
        snapshotId: snapshot.snapshot_id,
        league: snapshot.league.name,
        team: chosenTeam,
        teams: snapshot.league.teams.length,
        players: snapshot.players.length,
        freeAgents: snapshot.free_agents.length,
        projections: snapshot.projections.length,
        lineupExpectedPoints: Math.round(result.lineupExpectedPoints * 100) / 100,
        starters: result.lineup.map((s) => s.playerId),
        waiverCandidates: result.waiverCandidates.length,
        tradeCandidates: result.tradeCandidates.length,
        queuedForApproval: result.queued.length
      }, null, 2));
      return;
    }
    case "build-models": {
      const priorsPath = process.argv[3] ?? process.env.PMT_PRIORS_PATH;
      if (!priorsPath) {
        throw new Error("build-models requires a priors JSON file: pmt build-models <priors.json> [observations.json]");
      }
      const observationsPath = process.argv[4];
      const priors = JSON.parse(await readFile(priorsPath, "utf8")) as ModelPrior[];
      const observations: Observation[] = observationsPath
        ? (JSON.parse(await readFile(observationsPath, "utf8")) as Observation[])
        : [];

      let models = buildModels(priors);
      models = applyObservations(models, observations);

      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      const store = new JsonModelStore(join(dataDir, "models.json"));
      await store.saveAll([...models.values()]);

      const ranked = rankByValue(models.values()).slice(0, 10);
      console.log(JSON.stringify({
        built: models.size,
        topByValue: ranked.map((r) => ({
          player: r.model.playerName,
          position: r.model.position,
          expectedPoints: Math.round(r.expectedPoints * 100) / 100,
          value: Math.round(r.value * 100) / 100,
          p12: Math.round(r.probabilities[12] * 1000) / 1000
        }))
      }, null, 2));
      return;
    }
    case "ff-run": {
      const configPath = process.argv[3];
      if (!configPath) {
        throw new Error("ff-run requires a config JSON: pmt ff-run <config.json> [--auto]");
      }
      const autoApproveLowRisk = process.argv.includes("--auto");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        input: OrchestratorInput;
        priors: ModelPrior[];
        observations?: Observation[];
      };
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      const queue = new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));

      const result = await runOrchestrator({
        input: config.input,
        priors: config.priors,
        observations: config.observations,
        queue,
        autoApproveLowRisk
      });

      console.log(JSON.stringify({
        team: result.teamId,
        lineupExpectedPoints: Math.round(result.lineupExpectedPoints * 100) / 100,
        starters: result.lineup.map((s) => s.playerId),
        waiverCandidates: result.waiverCandidates.length,
        tradeCandidates: result.tradeCandidates.length,
        executed: result.executed.map((a) => a.type),
        queuedForApproval: result.queued.map((q) => ({ actionId: q.actionId, type: q.action.type, risk: q.risk }))
      }, null, 2));
      return;
    }
    case "action-queue": {
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      const queue = new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));
      const pending = await queue.pending();
      console.log(JSON.stringify({
        pending: pending.length,
        actions: pending.map((q) => ({
          actionId: q.actionId,
          type: q.action.type,
          risk: q.risk,
          rationale: q.rationale,
          expiresAt: q.expiresAt
        }))
      }, null, 2));
      return;
    }
    case "action-approve": {
      const actionId = process.argv[3];
      if (!actionId) throw new Error("action-approve requires an action id: pmt action-approve <actionId>");
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      const queue = new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));
      const approved = await queue.approve(actionId);
      console.log(JSON.stringify({ actionId: approved.actionId, status: approved.status }, null, 2));
      return;
    }
    case "action-reject": {
      const actionId = process.argv[3];
      if (!actionId) throw new Error("action-reject requires an action id: pmt action-reject <actionId>");
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      const queue = new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));
      const rejected = await queue.reject(actionId);
      console.log(JSON.stringify({ actionId: rejected.actionId, status: rejected.status }, null, 2));
      return;
    }
    case "razzball-login": {
      await runRazzballLogin();
      return;
    }
    case "season-refresh": {
      const positionals = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
      const season = positionals[0];
      const weekArg = positionals[1];
      const week = weekArg ? Number(weekArg) : undefined;
      const force = process.argv.includes("--force");
      const summary = await runSeasonRefresh({ season, week, force });
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    case "daemon": {
      const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
      await mkdir(dataDir, { recursive: true });
      const scheduler = new InMemoryScheduler(() => new Date(), 60_000, true);
      const jobs = registerSeasonJobs(scheduler, buildSeasonJobDeps(dataDir));
      scheduler.start();
      console.log(JSON.stringify({
        message: "Pardon My Trade season daemon running (Ctrl+C to stop).",
        dataDir,
        jobs: jobs.map((job) => ({ jobId: job.jobId, name: job.name, time: job.time, days: job.days }))
      }, null, 2));

      if (process.argv.includes("--run-now")) {
        await runDailySeasonJob(buildSeasonJobDeps(dataDir));
      }

      const shutdown = () => {
        scheduler.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }
    case "projections": {
      await runProjectionsCommand(process.argv.slice(3));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Wire the in-season scheduled jobs (doc 21 Phase 3) to the real pipeline:
 * projections -> news/injuries -> orchestrator -> notifications. Shared SQLite
 * handles are reused when `serve` already opened them.
 */
function buildSeasonJobDeps(
  dataDir: string,
  shared?: { repository: KnowledgeRepository; v1Store: V1Store }
): SeasonJobDeps {
  const config = createDefaultConfig();
  const repository = shared?.repository ?? new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
  const v1Store = shared?.v1Store ?? new SqliteV1Store({ filePath: join(dataDir, "pmt-v1.db") });
  const ruleEngine = new ScoringRuleEngine();
  const decisionEngine = new DefaultDecisionEngine(ruleEngine);
  const recommendationEngine = new DefaultRecommendationEngine(ruleEngine);
  const newsPath = process.env.PMT_NEWS_PATH ?? "tests/fixtures/sample-news.json";
  const providers: NotificationProvider[] = [
    new ConsoleNotificationProvider(),
    new FileNotificationProvider(join(dataDir, "notifications.log"))
  ];

  return {
    dataDir,
    refresh: () => runRefresh({
      fixturePath: config.fixturePath,
      newsPath,
      leagueExternalId: process.env.PMT_LEAGUE_EXTERNAL_ID ?? "pmt-demo-football",
      teamExternalId: process.env.PMT_TEAM_EXTERNAL_ID ?? "team-001",
      repository,
      v1Store,
      ruleEngine,
      decisionEngine,
      recommendationEngine,
      notificationProviders: providers
    }),
    seasonRefresh: (options) => runSeasonRefresh({ ...options, repository }),
    orchestrate: (options) => runSeasonOrchestration({ ...options, repository }),
    notify: async (notifications) => {
      for (const notification of notifications) {
        await v1Store.saveNotification(notification);
        for (const provider of providers) {
          await provider.send(notification);
        }
      }
    },
    log: (result) => {
      console.log(JSON.stringify(result));
    }
  };
}

function printHelp(): void {
  console.log(`Pardon My Trade CLI

Usage:
  pmt help
  pmt version
  pmt import-fixture
  pmt weekly-report [leagueExternalId] [teamExternalId]
  pmt refresh [leagueExternalId] [teamExternalId]
  pmt import-sleeper <sleeperLeagueId> [season]
  pmt import-espn <espnLeagueId> [season] [teamId]
  pmt build-models <priors.json> [observations.json]
  pmt ff-run <config.json> [--auto]
  pmt action-queue
  pmt action-approve <actionId>
  pmt action-reject <actionId>
  pmt razzball-login
  pmt season-refresh [season] [week] [--force]
  pmt projections <razzball|razzball-premium|fftoday|espn> <position> [--week N] [--auto] [--ppr] [--force] [--no-save] [--persist] [--max N]
  pmt projections --clear-cache
  pmt projections --cache-stats
  pmt daemon [--run-now]
  pmt serve [--scheduler]

V1 adds scheduled refresh, news ingestion, injury alerts, projection
consensus, manager profiles, historical tracking, and notifications,
surfaced through a local web GUI (pmt serve).

DraftKat (feature/DraftKat) adds the ESPN read/write adapter, a
probabilistic Bayesian player-model engine (plan Open Claw Agent Fantasy
section 5), and the FF_Orchestrator agent with a human-approval action
queue for high-risk moves (trades, drops). Live ESPN logins require
ESPN_LEAGUE_ID (+ ESPN_S2, SWID) in the environment.

The in-season loop (pmt daemon, or pmt serve --scheduler) runs the daily
projection pull + advisory pass Mon-Sat, a Sunday lineup-lock reminder, and
a Tuesday waiver/trade sweep. Jobs pause automatically in the offseason and
never execute a move: high-risk actions wait for pmt action-approve.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

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

const command = process.argv[2] ?? "help";

async function main(): Promise<void> {
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
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
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
  pmt serve

V1 adds scheduled refresh, news ingestion, injury alerts, projection
consensus, manager profiles, historical tracking, and notifications,
surfaced through a local web GUI (pmt serve).

MVP status:
  Read-only fixture import and weekly recommendation report are available.
  Live platform logins are intentionally postponed.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

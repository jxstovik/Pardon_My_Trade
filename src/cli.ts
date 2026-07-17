import { createDefaultConfig } from "./config/app-config.js";
import { FixturePlatformReader } from "./adapters/fixture/fixture-platform-reader.js";
import { runWeeklyReport } from "./pipeline/weekly-report.js";

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
      console.log("pardon-my-trade 0.1.0");
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

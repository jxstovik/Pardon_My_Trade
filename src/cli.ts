import { createDefaultConfig } from "./config/app-config.js";
import { FixturePlatformReader } from "./adapters/fixture/fixture-platform-reader.js";

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

MVP status:
  Read-only fixture import is available. Live platform logins are intentionally postponed.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

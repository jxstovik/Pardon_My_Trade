import assert from "node:assert/strict";
import test from "node:test";
import { SleeperPlatformReader } from "../src/adapters/sleeper/sleeper-platform-reader.js";
import type { PlatformReader } from "../src/adapters/platform-reader.js";

const leagueResponse = {
  league_id: "12345",
  name: "Sleeper Demo",
  season: "2026",
  sport: "nfl",
  status: "in_season",
  total_rosters: 2,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "IR"],
  settings: { leg: 1, wins: 0 },
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1 }
};

const rostersResponse = [
  {
    roster_id: 1,
    owner_id: "user-1",
    players: ["p-qb", "p-rb1", "p-bn", "p-ir", "p-taxi"],
    starters: ["p-qb", "p-rb1"],
    reserve: ["p-ir"],
    taxi: ["p-taxi"],
    settings: { wins: 2, losses: 1, ties: 0, fpts: 220.5, fpts_against: 200.1 }
  },
  {
    roster_id: 2,
    owner_id: "user-2",
    players: ["p-qb2", "p-wr2"],
    starters: ["p-qb2", "p-wr2"],
    reserve: [],
    taxi: [],
    settings: { wins: 1, losses: 2, ties: 0, fpts: 190, fpts_against: 210 }
  }
];

const usersResponse = [
  { user_id: "user-1", display_name: "Alice", team_name: "A-Team", metadata: {} },
  { user_id: "user-2", display_name: "Bob", team_name: "B-Squad", metadata: {} }
];

const matchupsResponse = [
  { roster_id: 1, matchup_id: 10, points: 118.2, opponents: [2] },
  { roster_id: 2, matchup_id: 10, points: 110.0, opponents: [1] }
];

const playersResponse = {
  p_qb: { player_id: "p_qb", full_name: "Caleb Meridian", position: "QB", team: "CHI", status: "Active", injury_status: "Active", fantasy_positions: ["QB"] },
  p_rb1: { player_id: "p_rb1", full_name: "Marcus Vale", position: "RB", team: "DET", status: "Active", injury_positions: ["RB"] },
  p_bn: { player_id: "p_bn", full_name: "Bench Body", position: "RB", team: "MIA", status: "Active" },
  p_qb2: { player_id: "p_qb2", full_name: "Rowan Fields", position: "QB", team: "SEA", status: "Active" },
  p_wr2: { player_id: "p_wr2", full_name: "Evan Lane", position: "WR", team: "CIN", status: "Questionable", injury_status: "Questionable" }
};

const transactionsResponse = [
  { transaction_id: "t1", type: "waiver", roster_ids: [1], adds: { p_bn: 1 }, drops: {}, created: "2026-09-01T10:00:00Z" }
];

function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const table: Record<string, unknown> = {
      "https://api.sleeper.app/v1/league/12345": leagueResponse,
      "https://api.sleeper.app/v1/league/12345/rosters": rostersResponse,
      "https://api.sleeper.app/v1/league/12345/users": usersResponse,
      "https://api.sleeper.app/v1/league/12345/matchups/1": matchupsResponse,
      "https://api.sleeper.app/v1/league/12345/transactions/1": transactionsResponse,
      "https://api.sleeper.app/v1/players/nfl": playersResponse
    };
    const body = table[url];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function makeReader(): PlatformReader {
  return new SleeperPlatformReader({ fetchImpl: fakeFetch() });
}

test("sleeper getLeague maps canonical league", async () => {
  const reader = makeReader();
  const league = await reader.getLeague("12345", "2026");
  assert.equal(league.platform, "sleeper");
  assert.equal(league.name, "Sleeper Demo");
  assert.equal(league.roster_settings.bench_count, 2);
  assert.equal(league.roster_settings.injured_reserve_count, 1);
});

test("sleeper getTeams maps rosters and users", async () => {
  const reader = makeReader();
  const teams = await reader.getTeams("12345");
  assert.equal(teams.length, 2);
  assert.equal(teams[0].name, "A-Team");
  assert.equal(teams[0].standings.wins, 2);
  assert.equal(teams[0].roster.starters.length, 2);
  assert.equal(teams[0].roster.starters[0].slot_type, "QB");
  assert.equal(teams[0].roster.starters[1].slot_type, "RB");
  assert.deepEqual(teams[0].roster.injured_reserve.map((slot) => slot.player_id), ["p-ir"]);
  assert.deepEqual(teams[0].roster.taxi.map((slot) => slot.player_id), ["p-taxi"]);
  assert.deepEqual(teams[0].roster.bench.map((slot) => slot.player_id), ["p-bn"]);
});

test("sleeper getScoringSettings maps known scoring keys", async () => {
  const reader = makeReader();
  const scoring = await reader.getScoringSettings("12345");
  assert.ok(scoring.rules.length >= 4);
  assert.ok(scoring.rules.some((rule) => rule.stat === "receptions" && rule.points === 1));
});

test("sleeper getFreeAgents excludes owned players", async () => {
  const reader = makeReader();
  const freeAgents = await reader.getFreeAgents("12345");
  const owned = new Set(["p-qb", "p-rb1", "p-bn", "p-qb2", "p-wr2"]);
  for (const player of freeAgents) {
    assert.ok(!owned.has(player.player_id), `${player.player_id} should not be free`);
  }
});

test("sleeper getSchedule maps matchups", async () => {
  const reader = makeReader();
  const schedule = await reader.getSchedule("12345");
  assert.equal(schedule.length, 2);
  assert.equal(schedule[0].opponent_team_id, "team-2");
});

test("sleeper maps questionable injury status", async () => {
  const reader = makeReader();
  const players = await reader.getPlayers("football", "2026");
  const wr = players.find((p) => p.player_id === "p_wr2");
  assert.ok(wr);
  assert.equal(wr?.injury_status, "questionable");
});

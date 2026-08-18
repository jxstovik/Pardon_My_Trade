import assert from "node:assert/strict";
import test from "node:test";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";
import { loadEspnCredentials } from "../src/adapters/espn/espn-auth.js";
import type { PlayerPosition } from "../src/models/types.js";

const sampleLeague = {
  id: 999,
  name: "DraftKat League",
  seasonId: 2026,
  status: { type: 2 },
  settings: {
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BE", "BE", "IR"],
    waiverSettings: { type: "ROLLING" },
    tradeReview: { type: 2 }
  },
  members: [{ id: "m1", displayName: "Ada" }, { id: "m2", displayName: "Bob" }],
  teams: [
    {
      id: 1,
      nickname: "Ada's Aces",
      waiverRank: 1,
      record: { overall: { wins: 3, losses: 1, ties: 0, pointsFor: 410, pointsAgainst: 380 } },
      roster: {
        entries: [
          { playerId: 101, lineuSlotId: 0 },
          { playerId: 102, lineuSlotId: 2 },
          { playerId: 103, lineuSlotId: 20 }
        ]
      }
    },
    {
      id: 2,
      nickname: "Bob's Bombers",
      waiverRank: 2,
      record: { overall: { wins: 1, losses: 3, ties: 0, pointsFor: 350, pointsAgainst: 400 } },
      roster: { entries: [{ playerId: 201, lineuSlotId: 0 }] }
    }
  ],
  players: [
    { id: 101, firstName: "Caleb", lastName: "Meridian", defaultPositionId: 1, proTeamId: 4, injured: false },
    { id: 102, firstName: "Marcus", lastName: "Vale", defaultPositionId: 2, proTeamId: 5, injured: false },
    { id: 103, firstName: "Bench", lastName: "Warm", defaultPositionId: 2, proTeamId: 6, injured: false },
    { id: 201, firstName: "Rowan", lastName: "Fields", defaultPositionId: 1, proTeamId: 7, injured: false },
    { id: 301, firstName: "Free", lastName: "Agent", defaultPositionId: 3, proTeamId: 8, injured: false }
  ],
  schedule: [
    { id: 11, homeTeamId: 1, awayTeamId: 2, homePoints: 120, awayPoints: 110, matchupPeriodId: 1 }
  ],
  scoringSettings: { passYd: 0.04, rushYd: 0.1, rec: 1 }
};

function fakeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {}))) as unknown as typeof fetch;
}

function makeReader(): EspnPlatformReader {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("leagues/999") && !url.includes("/transactions") && !url.includes("/trades")) {
      return new Response(JSON.stringify(sampleLeague), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return new EspnPlatformReader({
    credentials: { leagueId: "999", season: "2026", espnS2: "cookie", swid: "{swid}" },
    fetchImpl
  });
}

test("loadEspnCredentials reads env", () => {
  const creds = loadEspnCredentials({ ESPN_LEAGUE_ID: "42", ESPN_SEASON: "2025" } as NodeJS.ProcessEnv);
  assert.equal(creds.leagueId, "42");
  assert.equal(creds.season, "2025");
});

test("getLeague maps canonical league", async () => {
  const reader = makeReader();
  const league = await reader.getLeague("999", "2026");
  assert.equal(league.platform, "espn");
  assert.equal(league.name, "DraftKat League");
  assert.equal(league.teams.length, 2);
  assert.equal(league.roster_settings.bench_count, 2);
  assert.equal(league.roster_settings.injured_reserve_count, 1);
  assert.equal(league.trade_settings.review_type, "league_vote");
  assert.equal(
    reader.client.recordedRequests[0]?.url,
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/999?view=mTeam&view=mRoster&view=mMatchup&view=mStandings&view=mSettings&view=mPlayer"
  );
});

test("getTeams maps rosters and standings", async () => {
  const reader = makeReader();
  const teams = await reader.getTeams("999");
  const ada = teams.find((t) => t.team_id === "1")!;
  assert.equal(ada.name, "Ada's Aces");
  assert.equal(ada.standings.wins, 3);
  assert.equal(ada.roster.starters.length, 2);
  assert.equal(ada.roster.bench.length, 1);
});

test("getFreeAgents excludes owned players", async () => {
  const reader = makeReader();
  const free = await reader.getFreeAgents("999");
  const owned = new Set(["101", "102", "103", "201"]);
  for (const player of free) {
    assert.ok(!owned.has(player.player_id), `${player.player_id} should be free`);
  }
  assert.ok(free.some((p) => p.player_id === "301"));
});

test("getScoringSettings maps known keys with defaults", async () => {
  const reader = makeReader();
  const scoring = await reader.getScoringSettings("999");
  assert.ok(scoring.rules.some((r) => r.stat === "passing_yards" && r.points === 0.04));
  assert.ok(scoring.rules.some((r) => r.stat === "receptions" && r.points === 1));
});

test("setRoster posts correct body and filter header", async () => {
  const reader = makeReader();
  const assignments: Array<{ playerId: string; slot: PlayerPosition }> = [
    { playerId: "101", slot: "QB" },
    { playerId: "102", slot: "RB" }
  ];
  await reader.setRoster("1", assignments);
  const post = reader.client.recordedRequests.find((r) => r.method === "POST")!;
  assert.ok(post, "a POST was recorded");
  assert.ok(post.url.includes("leagues/999"));
  assert.ok(post.headers["X-Fantasy-Filter"]);
  const body = post.body as { teamId: number; roster: Array<{ id: number; lineupSlotId: number }> };
  assert.equal(body.teamId, 1);
  assert.deepEqual(body.roster, [
    { id: 101, lineupSlotId: 0 },
    { id: 102, lineupSlotId: 2 }
  ]);
});

test("addDrop builds add and drop transact items", async () => {
  const reader = makeReader();
  await reader.addDrop("1", ["301"], ["103"], "freeagent");
  const post = reader.client.recordedRequests.find((r) => r.method === "POST" && r.url.includes("/transactions/"))!;
  const body = post.body as { type: string; transactItems: Array<{ type: string; playerId: number; toTeamId: number; fromTeamId: number }> };
  assert.equal(body.type, "ADD");
  assert.ok(body.transactItems.some((i) => i.type === "ADD" && i.playerId === 301 && i.toTeamId === 1));
  assert.ok(body.transactItems.some((i) => i.type === "DROP" && i.playerId === 103 && i.fromTeamId === 1));
});

test("proposeTrade builds give/receive assets", async () => {
  const reader = makeReader();
  await reader.proposeTrade("1", "2", ["102"], ["201"]);
  const post = reader.client.recordedRequests.find((r) => r.method === "POST" && r.url.includes("/trades/"))!;
  const body = post.body as { proposingTeamId: number; receivingTeamId: number; assets: Array<{ type: string; teamId: number; playerId: number }> };
  assert.equal(body.proposingTeamId, 1);
  assert.equal(body.receivingTeamId, 2);
  const give = body.assets.find((a) => a.playerId === 102);
  const receive = body.assets.find((a) => a.playerId === 201);
  assert.equal(give?.teamId, 1);
  assert.equal(receive?.teamId, 2);
});

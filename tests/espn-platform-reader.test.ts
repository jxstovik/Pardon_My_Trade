import assert from "node:assert/strict";
import test from "node:test";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";
import { loadEspnCredentials } from "../src/adapters/espn/espn-auth.js";
import { readFile } from "node:fs/promises";
import { scoreProjectionPoints, ScoringRuleEngine } from "../src/rules/rule-engine.js";
import type { PlayerPosition, Projection, Roster } from "../src/models/types.js";

const sampleLeague = {
  id: 999,
  name: "DraftKat League",
  seasonId: 2026,
  status: { type: 2 },
  settings: {
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BE", "BE", "IR"],
    scoringSettings: { scoringItems: [{ statId: 3, points: 0.04 }, { statId: 53, points: 1 }, { statId: 16, points: 3 }] },
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
  const konaPayload = {
    players: [
      { player: { id: 301, firstName: "Free", lastName: "Agent", defaultPositionId: 3, proTeamId: 8, injured: false }, status: "FREEAGENT" },
      { player: { id: 101, firstName: "Caleb", lastName: "Meridian", defaultPositionId: 1, proTeamId: 4, injured: false }, status: "FREEAGENT" }
    ]
  };
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("leagues/999") && url.includes("kona_player_info")) {
      return new Response(JSON.stringify(konaPayload), { status: 200 });
    }
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

test("getScoringSettings maps explicit known keys without guessed defaults", async () => {
  const reader = makeReader();
  const scoring = await reader.getScoringSettings("999");
  assert.ok(scoring.rules.some((r) => r.stat === "passing_yards" && r.points === 0.04));
  assert.ok(scoring.rules.some((r) => r.stat === "receptions" && r.points === 1));
  assert.equal(scoring.rules.length, 2, "unknown bonus stat IDs are not misrepresented as defaults");
});

test("live league scoring imports every configured stat and D/ST position override", async () => {
  // Safe mSettings capture: only identifiers and scoring weights, no members/cookies.
  const data = JSON.parse(await readFile("tests/fixtures/espn-scoring-98806880-2026.json", "utf8"));
  const reader = new EspnPlatformReader({
    credentials: { leagueId: "98806880", season: "2026" },
    fetchImpl: fakeFetch(() => new Response(JSON.stringify(data), { status: 200 }))
  });
  const scoring = await reader.getScoringSettings("98806880");
  const items = data.settings.scoringSettings.scoringItems;
  assert.equal(new Set(scoring.rules.map(rule => rule.rule_id)).size, scoring.rules.length);
  assert.equal(new Set(scoring.rules.map(rule => rule.rule_id.match(/^espn-stat-(\d+)/)?.[1])).size, items.length);
  for (const item of items) {
    const rules = scoring.rules.filter(rule => rule.rule_id === `espn-stat-${item.statId}` || rule.rule_id.startsWith(`espn-stat-${item.statId}-`));
    assert.ok(rules.length, `missing ESPN stat ${item.statId}`);
    for (const rule of rules) {
      const expected = rule.applies_to_positions.includes("DST") ? item.pointsOverrides?.["16"] ?? item.points : item.points;
      assert.equal(rule.points, expected, `wrong points for ESPN stat ${item.statId}`);
    }
  }
  assert.equal(scoring.rules.find(rule => rule.stat === "sacks")?.points, 1);
  assert.equal(scoring.rules.find(rule => rule.stat === "points_allowed_0")?.points, 5);
  assert.equal(scoring.rules.find(rule => rule.stat === "yards_allowed_550_plus")?.points, -7);
  assert.ok(!scoring.rules.some(rule => rule.stat === "points_allowed_18_21"), "absent tiers are not synthesized");
  assert.ok(!scoring.rules.some(rule => rule.stat === "yards_allowed_300_349"), "absent tiers are not synthesized");

  const base = { schema_version: "1.0.0", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z",
    source_system: "espn", source: "espn", projection_id: "test", scoring_period: "2026-W7", floor: 0, ceiling: 30, confidence: 1 };
  const kicker: Projection = { ...base, player_id: "k", projected_points: 0, projected_stats: {
    field_goals_0_39: 1, field_goals_40_49: 1, field_goals_50_59: 1, field_goals_60_plus: 1,
    field_goals_missed: 1, extra_points: 2, extra_points_missed: 1
  } };
  const defense: Projection = { ...base, player_id: "dst", projected_points: 0, projected_stats: {
    sacks: 3, defensive_interceptions: 1, defensive_fumble_recoveries: 1, blocked_kicks: 1,
    safeties: 1, def_interception_td: 1, points_allowed_28_34: 1, yards_allowed_400_449: 1
  } };
  assert.equal(scoreProjectionPoints(scoring, kicker, ["K"]), 17);
  assert.equal(scoreProjectionPoints(scoring, defense, ["DST"]), 13);
  assert.equal(scoreProjectionPoints(scoring, defense, ["QB"]), 0, "defensive interceptions are not interceptions thrown");
  const roster: Roster = { team_id: "7", last_updated_at: "2026-10-24T00:00:00Z", bench: [], injured_reserve: [], taxi: [], starters: [
    {slot_id: "k", slot_type: "K", allowed_positions: ["K"], locked: false, player_id: "k"},
    {slot_id: "dst", slot_type: "DST", allowed_positions: ["DST"], locked: false, player_id: "dst"}
  ] };
  assert.equal(new ScoringRuleEngine().calculateProjectedScore(scoring, [kicker, defense], roster), 30);
});

test("scoring overrides preserve zero and do not leak D/ST weights to offensive returners", async () => {
  const data = { scoringSettings: { scoringItems: [
    { statId: 101, points: 6, pointsOverrides: {"16": 0} },
    { statId: 99, points: 9, pointsOverrides: {"16": 0} },
    { statId: 80, points: 3, pointsOverrides: {"5": 0} },
    { statId: 89, pointsOverrides: {"16": 5} }
  ] } };
  const reader = new EspnPlatformReader({ credentials: {leagueId: "999", season: "2026"},
    fetchImpl: fakeFetch(() => new Response(JSON.stringify(data), {status: 200})) });
  const { rules } = await reader.getScoringSettings("999");
  assert.equal(rules.find(rule => rule.stat === "kickoff_return_touchdowns" && rule.applies_to_positions.includes("DST"))?.points, 0);
  assert.equal(rules.find(rule => rule.stat === "kickoff_return_touchdowns" && rule.applies_to_positions.includes("WR"))?.points, 6);
  assert.equal(rules.find(rule => rule.stat === "sacks")?.points, 0);
  assert.equal(rules.find(rule => rule.stat === "field_goals_0_39")?.points, 0);
  assert.equal(rules.find(rule => rule.stat === "points_allowed_0")?.points, 5, "an explicit override works without a base weight");
  assert.equal(new Set(rules.map(rule => rule.rule_id)).size, rules.length);
});

test("player position IDs preserve kicker and D/ST, and actual ESPN eligibility is retained", async () => {
  const data: any = structuredClone(sampleLeague);
  data.players.push(
    { id: 401, firstName: "K", lastName: "Player", defaultPositionId: 5, proTeamId: 9, injured: false },
    { id: 402, firstName: "Defense", lastName: "Player", defaultPositionId: 16, proTeamId: 10, injured: false },
    { id: 403, firstName: "Eligible", lastName: "Flex", defaultPositionId: 2, proTeamId: 11, eligibleSlots: [2, 23], locked: true }
  );
  data.teams[0].roster.entries.push({ playerId: 403, lineupSlotId: 23 });
  const reader = new EspnPlatformReader({ credentials: { leagueId: "999", season: "2026" }, fetchImpl: fakeFetch((url) =>
    new Response(JSON.stringify(url.includes("kona_player_info") ? { players: [] } : data), { status: 200 })) });
  const players = await reader.getPlayers("football", "2026");
  assert.deepEqual(players.find((player) => player.player_id === "401")?.positions, ["K"]);
  assert.deepEqual(players.find((player) => player.player_id === "402")?.positions, ["DST"]);
  assert.deepEqual(players.find((player) => player.player_id === "403")?.eligibility.eligible_slots, ["RB", "FLEX", "BN"]);
  const roster = await reader.getRoster("999", "1");
  assert.equal(roster.starters.find((slot) => slot.player_id === "403")?.locked, true);
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

test('pending waiver reads distinguish an empty queue from an unavailable view',async()=>{
 let payload:Record<string,unknown>={id:999,seasonId:2026,transactions:[]};
 const reader=new EspnPlatformReader({credentials:{leagueId:'999',season:'2026'},fetchImpl:async(input)=>{
  const url=new URL(String(input));
  if(!url.searchParams.getAll('view').includes('mTransactions2'))return new Response(JSON.stringify({id:999,seasonId:2026,scoringPeriodId:9}));
  assert.equal(url.searchParams.get('scoringPeriodId'),'9');
  return new Response(JSON.stringify(payload),{headers:{'x-fantasy-role':'OWNER'}});
 }});
 assert.deepEqual(await reader.getPendingWaiverClaims('999','7'),[]);
 payload={id:999,seasonId:2026};await assert.rejects(reader.getPendingWaiverClaims('999','7'),/unavailable/);
 payload={id:998,seasonId:2026,transactions:[]};await assert.rejects(reader.getPendingWaiverClaims('999','7'),/mismatched/);
 payload={id:999,seasonId:2026,transactions:[{id:'claim1',teamId:7,type:'WAIVER',status:'PENDING',priority:1,items:[{playerId:301,type:'ADD'}]},{id:'other',teamId:8,type:'WAIVER',status:'PENDING',priority:1,items:[]}]};
 assert.deepEqual((await reader.getPendingWaiverClaims('999','7')).map(c=>c.id),['claim1']);
});
test('public league access cannot stand in for authenticated private pending claims',async()=>{
 for(const role of [undefined,'NONE']){
  const reader=new EspnPlatformReader({credentials:{leagueId:'999',season:'2026'},fetchImpl:async(input)=>{
   const pending=String(input).includes('mTransactions2');
   return new Response(JSON.stringify(pending?{id:999,seasonId:2026,transactions:[]}:{id:999,seasonId:2026,scoringPeriodId:10}),{headers:role?{'x-fantasy-role':role}:{}});
  }});
  await assert.rejects(reader.getPendingWaiverClaims('999','7'),/unauthenticated/);
 }
});
test('waiver pool accepts only explicitly confirmed WAIVERS, not immediate free agents',async()=>{
 const reader=new EspnPlatformReader({credentials:{leagueId:'999',season:'2026'},fetchImpl:async(input)=>new Response(JSON.stringify(String(input).includes('kona_player_info')?{players:[{player:{id:301},status:'WAIVERS'},{player:{id:302},status:'FREEAGENT'}]}:sampleLeague))});
 assert.deepEqual(await reader.getWaiverPlayerIds('999'),['301']);
 await assert.rejects(reader.getWaiverPlayerIds('998'),/scope/);
});

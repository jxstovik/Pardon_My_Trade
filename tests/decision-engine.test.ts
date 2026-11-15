import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ScoringRuleEngine } from "../src/rules/rule-engine.js";
import { DefaultDecisionEngine } from "../src/decisions/decision-engine.js";
import { assertLeagueSnapshot } from "../src/models/validation.js";
import type { LeagueSnapshot } from "../src/models/types.js";

async function loadFixture(): Promise<LeagueSnapshot> {
  const raw = await readFile("tests/fixtures/sample-football-league.json", "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertLeagueSnapshot(parsed);
  return parsed;
}

test("generateLineupCandidates proposes bench-over-starter upgrades from projections", async () => {
  const snapshot = await loadFixture();
  const engine = new DefaultDecisionEngine(new ScoringRuleEngine());
  const team = snapshot.league.teams[0];

  const candidates = engine.generateLineupCandidates(
    snapshot.league,
    team,
    [...snapshot.players, ...snapshot.free_agents],
    snapshot.projections
  );

  assert.ok(Array.isArray(candidates));
  for (const candidate of candidates) {
    assert.ok(candidate.projectedPoints >= 0);
    assert.ok(candidate.rationale.length > 0);
  }
});

test("generateWaiverCandidates respects roster-full drop pairing via rule engine", async () => {
  const snapshot = await loadFixture();
  const engine = new DefaultDecisionEngine(new ScoringRuleEngine());
  const team = snapshot.league.teams[0];

  const candidates = engine.generateWaiverCandidates(
    snapshot.league,
    team,
    snapshot.free_agents,
    [...snapshot.players, ...snapshot.free_agents],
    snapshot.projections
  );

  for (const candidate of candidates) {
    if (candidate.dropPlayerId === undefined) continue;
    const onRoster = [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve]
      .some((slot) => slot.player_id === candidate.dropPlayerId);
    assert.ok(onRoster, `drop player ${candidate.dropPlayerId} must be on roster`);
  }
});

test("generateWaiverCandidates protects top-ranked Josh Allen from being dropped", async () => {
  const snapshot = await loadFixture();
  const baseTeam = snapshot.league.teams[0];
  const joshId = baseTeam.roster.starters[0].player_id!;
  const josh = { ...snapshot.players.find((player) => player.player_id === joshId)!, full_name: "Josh Allen" };
  const freeAgent = {
    ...snapshot.free_agents[0],
    positions: ["QB" as const],
    eligibility: { ...snapshot.free_agents[0].eligibility, eligible_slots: ["QB" as const] }
  };
  const team = {
    ...baseTeam,
    roster: { ...baseTeam.roster, starters: [baseTeam.roster.starters[0]], bench: [], injured_reserve: [] }
  };
  const league = {
    ...snapshot.league,
    roster_settings: {
      ...snapshot.league.roster_settings,
      slots: [{ slot: "QB" as const, count: 1, positions: ["QB" as const] }],
      bench_count: 0,
      injured_reserve_count: 0,
      taxi_count: 0
    }
  };
  const joshProjection = {
    ...snapshot.projections[0],
    player_id: joshId,
    projected_stats: { passing_yards: 100 }
  };
  const freeAgentProjection = {
    ...snapshot.projections[1],
    player_id: freeAgent.player_id,
    projected_stats: { passing_yards: 700, passing_touchdowns: 10, rushing_yards: 500, rushing_touchdowns: 4 }
  };

  const candidates = new DefaultDecisionEngine(new ScoringRuleEngine()).generateWaiverCandidates(
    league,
    team,
    [freeAgent],
    [josh, freeAgent],
    [joshProjection, freeAgentProjection]
  );

  assert.deepEqual(candidates, []);
});

test("generateWeeklyReportInputs returns aggregated candidate sets", async () => {
  const snapshot = await loadFixture();
  const engine = new DefaultDecisionEngine(new ScoringRuleEngine());
  const team = snapshot.league.teams[0];

  const inputs = engine.generateWeeklyReportInputs(snapshot, team);
  assert.equal(inputs.leagueId, snapshot.league.league_id);
  assert.equal(inputs.teamId, team.team_id);
  assert.ok(inputs.currentProjectedPoints >= 0);
  assert.ok(inputs.notes.length >= 0);
});

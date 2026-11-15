import assert from "node:assert/strict";
import test from "node:test";
import { matchProjectionsToRoster, normalizeName } from "../src/projections/projection-matching.js";
function player(playerId, fullName, team, externalIds = {}) {
    return {
        schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper", source_record_id: playerId,
        player_id: playerId, external_id: playerId, sport: "football", full_name: fullName, team,
        positions: ["RB"], status: "active", injury_status: "active",
        eligibility: { eligible_slots: ["RB"], injured_reserve_eligible: false, taxi_eligible: false }, external_ids: externalIds
    };
}
test("normalizeName strips suffixes and punctuation", () => {
    assert.equal(normalizeName("Christian McCaffrey Jr."), normalizeName("Christian McCaffrey"));
    assert.equal(normalizeName("CeeDee Lamb"), "ceedeelamb");
});
test("matchProjectionsToRoster re-keys ESPN projections to roster player_id", () => {
    const players = [player("sl-1", "Christian McCaffrey", "SF"), player("sl-2", "CeeDee Lamb", "DAL")];
    const candidates = [
        { name: "Christian McCaffrey", team: "SF", positions: ["RB"], projected_stats: { rushing_yards: 95 }, projected_points: 21.4, floor: 15, ceiling: 28, confidence: 0.7 },
        { name: "CeeDee Lamb", team: "DAL", positions: ["WR"], projected_stats: { receiving_yards: 84 }, projected_points: 18.1, floor: 12, ceiling: 24, confidence: 0.7 },
        { name: "Unmatched Player", team: "GB", positions: ["QB"], projected_stats: {}, projected_points: 12, floor: 8, ceiling: 16, confidence: 0.7 }
    ];
    const projections = matchProjectionsToRoster(candidates, players, "2025-W01", "espn");
    assert.equal(projections.length, 2);
    const cmc = projections.find((p) => p.player_id === "sl-1");
    assert.ok(cmc);
    assert.equal(cmc?.source, "espn");
    assert.equal(cmc?.projected_stats.rushing_yards, 95);
    assert.equal(cmc?.projection_id, "espn-sl-1-2025-W01");
});
test("matchProjectionsToRoster falls back by name when team mismatches and name is unique", () => {
    const players = [player("sl-1", "Christian McCaffrey", "SF")];
    const candidates = [
        { name: "Christian McCaffrey", team: "XX", positions: ["RB"], projected_stats: {}, projected_points: 20, floor: 14, ceiling: 26, confidence: 0.7 }
    ];
    const projections = matchProjectionsToRoster(candidates, players, "2025-W01", "espn");
    assert.equal(projections.length, 1);
    assert.equal(projections[0].player_id, "sl-1");
});
test("native ESPN ID matches despite a changed source display name and keeps source metadata", () => {
    const candidates = [{
            player_id: "4037", name: "Updated Display Name", team: "SF", positions: ["RB"], projected_stats: {},
            projected_points: 18, floor: 12, ceiling: 24, confidence: 0.7,
            scoring_period: "2026-W4", observed_at: "2026-09-30T20:00:00.000Z"
        }];
    const [projection] = matchProjectionsToRoster(candidates, [player("canonical-1", "Old Display Name", "SF", { espn: "4037" })], "2026-W4", "espn");
    assert.equal(projection?.player_id, "canonical-1");
    assert.equal(projection?.scoring_period, "2026-W4");
    assert.equal(projection?.created_at, "2026-09-30T20:00:00.000Z");
});
test("name fallback skips ambiguous matches", () => {
    const players = [player("one", "Jordan Example", "NYG"), player("two", "Jordan Example", "DAL")];
    const projections = matchProjectionsToRoster([{
            name: "Jordan Example", team: "GB", positions: ["WR"], projected_stats: {},
            projected_points: 10, floor: 7, ceiling: 13, confidence: 0.5
        }], players, "2026-W4", "espn");
    assert.deepEqual(projections, []);
});
test("weekly period matching accepts W4/W04 equivalence and rejects a different source week", () => {
    const base = { name: "Weekly Player", team: "SF", positions: ["RB"], projected_stats: {}, projected_points: 10, floor: 5, ceiling: 15, confidence: 0.7 };
    const roster = [player("weekly", "Weekly Player", "SF")];
    const matched = matchProjectionsToRoster([{ ...base, scoring_period: "2026-W04" }], roster, "2026-W4", "espn");
    assert.equal(matched[0]?.scoring_period, "2026-W4");
    assert.equal(matchProjectionsToRoster([{ ...base, scoring_period: "2026-W5" }], roster, "2026-W4", "espn").length, 0);
});

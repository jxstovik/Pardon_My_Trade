import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleSlotsFor,
  evaluateAddCandidate,
  lineupSwapCandidates,
  rankFreeAgents,
  type AddCandidate,
  type RosteredPlayer
} from "../src/recommendations/slot-aware.js";

const SLOT_COUNTS_1QB = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };

/** League-shaped roster: 1 QB, 2 RB, 2 WR, 1 TE (FLEX = 3rd RB/WR/TE), DST, K + bench. */
const ROSTER: RosteredPlayer[] = [
  { playerId: "allen", slot: "QB", projected: 16.3 },
  { playerId: "achane", slot: "RB", projected: 16.6 },
  { playerId: "jeanty", slot: "RB", projected: 15.8 },
  { playerId: "nabers", slot: "WR", projected: 11.8 },
  { playerId: "jamw", slot: "WR", projected: 11.4 },
  { playerId: "pollard", slot: "FLEX", projected: 13.2 },
  { playerId: "henry", slot: "TE", projected: 8.6 },
  { playerId: "ravens", slot: "DST", projected: 6.6 },
  { playerId: "pineiro", slot: "K", projected: 10.7 },
  { playerId: "kittle", slot: "BN", projected: 7.2 },
  { playerId: "mitchell", slot: "BN", projected: 8.2 },
  { playerId: "gainwell", slot: "BN", projected: 9.9 }
];

test("eligibleSlotsFor: FLEX eligibility is RB/WR/TE only", () => {
  assert.deepEqual(eligibleSlotsFor("QB"), ["QB"]);
  assert.deepEqual(eligibleSlotsFor("RB"), ["RB", "FLEX"]);
  assert.deepEqual(eligibleSlotsFor("WR"), ["WR", "FLEX"]);
  assert.deepEqual(eligibleSlotsFor("TE"), ["TE", "FLEX"]);
  assert.deepEqual(eligibleSlotsFor("K"), ["K"]);
  assert.deepEqual(eligibleSlotsFor("DST"), ["DST"]);
});

test("1-QB league: an elite FA QB is only valuable if he starts over the incumbent", () => {
  const love: AddCandidate = { playerId: "love", position: "QB", projected: 29.9 };
  const result = evaluateAddCandidate(ROSTER, SLOT_COUNTS_1QB, love);
  assert.equal(result.startsThisWeek, true);
  assert.equal(result.replaces?.playerId, "allen");
  assert.ok(Math.abs(result.weeklyDelta - 13.6) < 1e-9, "delta vs Allen");
  assert.equal(result.bestDropPlayerId, "kittle", "lowest-value bench player is the drop");
  assert.match(result.rationale, /starts over allen/);
});

test("1-QB league: a mid FA QB below the starter has NO add value", () => {
  const result = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "meh-qb", position: "QB", projected: 14.0 }
  );
  assert.equal(result.weeklyDelta, 0);
  assert.equal(result.startsThisWeek, false);
  assert.equal(result.upsideStash, false);
  assert.match(result.rationale, /cannot beat/);
});

test("a QB candidate can never take RB/WR/TE/FLEX slots and vice versa", () => {
  const result = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "love", position: "QB", projected: 40 }
  );
  // Even a 40-point QB can only displace the QB (16.3), not the 8.6 TE.
  assert.equal(result.replaces?.playerId, "allen");

  const te = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "strange", position: "TE", projected: 10.3 }
  );
  assert.equal(te.replaces?.playerId, "henry", "TE displaces TE (8.6), not QB");
  assert.ok(Math.abs(te.weeklyDelta - 1.7) < 1e-9);
});

test("RB/WR/TE candidates can also take FLEX", () => {
  const result = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "coker", position: "WR", projected: 13.5 }
  );
  // WR-eligible starters: nabers 11.8, jamw 11.4, FLEX pollard 13.2.
  // Worst eligible is jamw (11.4).
  assert.equal(result.replaces?.playerId, "jamw");
  assert.ok(Math.abs(result.weeklyDelta - 2.1) < 1e-9);
});

test("upside stash: mean can't start, but p90 beats the worst eligible starter", () => {
  const result = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "rookie-rb", position: "RB", projected: 12.0, upside: 20.0 }
  );
  assert.equal(result.weeklyDelta, 0);
  assert.equal(result.startsThisWeek, false);
  assert.equal(result.upsideStash, true);
  assert.match(result.rationale, /bench stash/);
});

test("no upside stash when upside is absent or below the worst starter", () => {
  const noUpside = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "rb-a", position: "RB", projected: 12.0 }
  );
  assert.equal(noUpside.upsideStash, false);
  // RB-eligible worst starter is Pollard (FLEX, 13.2); 12.5 upside doesn't clear it.
  const low = evaluateAddCandidate(
    ROSTER,
    SLOT_COUNTS_1QB,
    { playerId: "rb-c", position: "RB", projected: 12.0, upside: 12.5 }
  );
  assert.equal(low.upsideStash, false);
});

test("empty required slot: candidate fills it and gains full projection", () => {
  const noKicker = ROSTER.filter((p) => p.slot !== "K");
  const result = evaluateAddCandidate(
    noKicker,
    SLOT_COUNTS_1QB,
    { playerId: "k-add", position: "K", projected: 10.7 }
  );
  assert.equal(result.startsThisWeek, true);
  assert.ok(Math.abs(result.weeklyDelta - 10.7) < 1e-9);
  assert.match(result.rationale, /empty K slot/);
});

test("rankFreeAgents sorts by weekly delta and filters no-value adds", () => {
  const ranked = rankFreeAgents(ROSTER, SLOT_COUNTS_1QB, [
    { playerId: "meh-qb", position: "QB", projected: 12.0 },
    { playerId: "love", position: "QB", projected: 29.9 },
    { playerId: "strange", position: "TE", projected: 10.3 },
    { playerId: "stash-rb", position: "RB", projected: 12.0, upside: 20.0 }
  ]);
  assert.equal(ranked[0].playerId, "love");
  assert.equal(ranked[1].playerId, "strange");
  assert.equal(ranked[2].playerId, "stash-rb");
  assert.ok(!ranked.some((r) => r.playerId === "meh-qb"), "no-value adds are filtered");
});

test("lineupSwapCandidates finds bench players who should start", () => {
  // Kittle (7.2) cannot beat Henry (8.6); give the bench a 12-pt TE instead.
  const roster: RosteredPlayer[] = [
    ...ROSTER.filter((p) => p.playerId !== "kittle"),
    { playerId: "strange", slot: "BN", projected: 12.0 }
  ];
  const swaps = lineupSwapCandidates(roster, { strange: "TE", mitchell: "WR", gainwell: "RB" });
  assert.ok(swaps.some((s) => s.benchPlayerId === "strange" && s.outPlayerId === "henry"));
});

test("lineupSwapCandidates flags a bench player for an empty required slot", () => {
  // Move Pineiro to the bench while keeping the K slot requirement.
  const noKicker: RosteredPlayer[] = ROSTER.map((p) =>
    p.playerId === "pineiro" ? { ...p, slot: "BN" } : p
  );
  const swaps = lineupSwapCandidates(
    noKicker,
    { pineiro: "K", mitchell: "WR", gainwell: "RB", kittle: "TE" },
    SLOT_COUNTS_1QB
  );
  const kSwap = swaps.find((s) => s.benchPlayerId === "pineiro");
  assert.ok(kSwap, "benched K is flagged for the empty K slot");
  assert.equal(kSwap.slot, "K");
  assert.equal(kSwap.outPlayerId, "");
  assert.ok(Math.abs(kSwap.delta - 10.7) < 1e-9);
});

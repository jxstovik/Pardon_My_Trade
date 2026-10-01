import type { PlayerPosition } from "../../models/types.js";
import type { PlayerModel } from "../../probabilistic/bayesian-model.js";
import type { FreeAgentInput, OpponentInput, RosterSlotInput } from "../types.js";

function muOf(models: Map<string, PlayerModel>, playerId: string): number {
  return models.get(playerId)?.mu ?? 0;
}

const FLEX_FILLABLE: PlayerPosition[] = ["RB", "WR", "TE"];
const SUPERFLEX_FILLABLE: PlayerPosition[] = ["QB", "RB", "WR", "TE"];

function isEligible(playerPosition: PlayerPosition, slot: PlayerPosition): boolean {
  if (slot === playerPosition) return true;
  if (slot === "FLEX") return FLEX_FILLABLE.includes(playerPosition);
  if (slot === "SUPER_FLEX") return SUPERFLEX_FILLABLE.includes(playerPosition);
  return false;
}

function candidateCanPlay(candidate: RosterSlotInput, slot: PlayerPosition): boolean {
  if (candidate.eligiblePositions) {
    return candidate.eligiblePositions.some((position) => isEligible(position, slot));
  }
  return isEligible(candidate.slot, slot);
}

export interface LineupResult {
  readonly starters: RosterSlotInput[];
  readonly bench: RosterSlotInput[];
  readonly expectedPoints: number;
}

/**
 * Maximum expected-points legal lineup. A rectangular assignment solve avoids
 * consuming a multi-position player in a scarce slot when a single-position
 * player could fill it and leave the flexible player for another slot.
 */
export function optimizeLineup(
  rosterSlots: ReadonlyArray<RosterSlotInput>,
  starterCounts: ReadonlyArray<{ readonly slot: PlayerPosition; readonly count: number }>,
  models: Map<string, PlayerModel>
): LineupResult {
  const needed: PlayerPosition[] = [];
  for (const { slot, count } of starterCounts) {
    for (let i = 0; i < count; i += 1) needed.push(slot);
  }
  const players = rosterSlots.filter((candidate) => !candidate.locked ||
    (candidate.currentSlot ?? candidate.slot) !== "BN" && needed.includes(candidate.currentSlot ?? candidate.slot));
  const weights = needed.map((slot) => players.map((candidate) => {
    if (candidate.locked) return (candidate.currentSlot ?? candidate.slot) === slot && candidateCanPlay(candidate, slot) ? 1e12 + muOf(models, candidate.playerId) : -1e12;
    if (!candidateCanPlay(candidate, slot)) return -1e12;
    return 1e9 + muOf(models, candidate.playerId);
  }).concat(Array(needed.length).fill(0)));
  const assignment = maximumAssignment(weights);
  const starters: RosterSlotInput[] = [];
  const used = new Set<string>();
  assignment.forEach((playerIndex, slotIndex) => {
    if (playerIndex < 0 || playerIndex >= players.length) return;
    const player = players[playerIndex]!;
    if (used.has(player.playerId)) return;
    used.add(player.playerId);
    starters.push({ ...player, slot: needed[slotIndex]! });
  });
  // A locked player assigned to the bench is frozen there and unavailable to
  // the matching problem above.
  for (const candidate of rosterSlots) if (candidate.locked && !needed.includes(candidate.currentSlot ?? candidate.slot)) used.add(candidate.playerId);

  const bench: RosterSlotInput[] = rosterSlots
    .filter((slot) => !used.has(slot.playerId))
    .map((slot) => ({ playerId: slot.playerId, slot: "BN" as PlayerPosition }));

  const expectedPoints = starters.reduce((sum, slot) => sum + muOf(models, slot.playerId), 0);
  return { starters, bench, expectedPoints };
}

/** Hungarian minimum-cost assignment, adapted for rows <= columns. */
function maximumAssignment(weights: number[][]): number[] {
  const rows = weights.length;
  if (!rows) return [];
  const columns = weights[0]!.length;
  const u = Array(rows + 1).fill(0) as number[];
  const v = Array(columns + 1).fill(0) as number[];
  const p = Array(columns + 1).fill(0) as number[];
  const way = Array(columns + 1).fill(0) as number[];
  for (let i = 1; i <= rows; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(columns + 1).fill(Infinity) as number[];
    const used = Array(columns + 1).fill(false) as boolean[];
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= columns; j += 1) {
        if (used[j]) continue;
        const cost = -weights[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cost < minv[j]!) { minv[j] = cost; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= columns; j += 1) {
        if (used[j]) { u[p[j]!] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = Array(rows).fill(-1) as number[];
  for (let j = 1; j <= columns; j += 1) if (p[j]) assignment[p[j]! - 1] = j - 1;
  return assignment;
}

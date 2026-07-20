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

const SLOT_PRIORITY: PlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DST", "FLEX", "SUPER_FLEX"];

export interface LineupResult {
  readonly starters: RosterSlotInput[];
  readonly bench: RosterSlotInput[];
  readonly expectedPoints: number;
}

/**
 * Greedy, expected-points-maximizing lineup subject to roster slot counts.
 * Each required starter slot is filled by the highest-mu eligible player not
 * yet used; everyone else is benched.
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
  needed.sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b));

  const used = new Set<string>();
  const starters: RosterSlotInput[] = [];
  for (const slot of needed) {
    let best: RosterSlotInput | undefined;
    let bestMu = -Infinity;
    for (const candidate of rosterSlots) {
      if (used.has(candidate.playerId)) continue;
      if (!isEligible(candidate.slot, slot)) continue;
      const mu = muOf(models, candidate.playerId);
      if (mu > bestMu) {
        bestMu = mu;
        best = candidate;
      }
    }
    if (best) {
      used.add(best.playerId);
      starters.push({ playerId: best.playerId, slot });
    }
  }

  const bench: RosterSlotInput[] = rosterSlots
    .filter((slot) => !used.has(slot.playerId))
    .map((slot) => ({ playerId: slot.playerId, slot: "BN" as PlayerPosition }));

  const expectedPoints = starters.reduce((sum, slot) => sum + muOf(models, slot.playerId), 0);
  return { starters, bench, expectedPoints };
}

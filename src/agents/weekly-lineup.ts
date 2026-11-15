import type { PlayerPosition } from "../models/types.js";
import type { PlayerModel } from "../probabilistic/bayesian-model.js";
import type { RosterSlotInput } from "./types.js";
import { optimizeLineup } from "./skills/lineup-optimizer.js";

/** Strict live-write planning boundary around the maximum-weight assignment. */
export function planWeeklyLineup(roster: RosterSlotInput[], counts: Array<{slot: PlayerPosition; count: number}>, points: ReadonlyMap<string, number>) {
  if (!counts.length || counts.some(c => ["BN", "IR", "TAXI"].includes(c.slot) || !Number.isInteger(c.count) || c.count < 1) || new Set(counts.map(c => c.slot)).size !== counts.length) throw new Error("Invalid starter slot capacities.");
  if (new Set(roster.map(p => p.playerId)).size !== roster.length) throw new Error("Duplicate owned player identity.");
  for (const p of roster) {
    if (!p.eligiblePositions?.length) throw new Error(`Live eligibility missing for ${p.playerId}.`);
    if (!Number.isFinite(points.get(p.playerId))) throw new Error(`Current-week model coverage missing for ${p.playerId}.`);
  }
  const models = new Map(roster.map(p => [p.playerId, { mu: points.get(p.playerId)! } as PlayerModel]));
  const optimized = optimizeLineup(roster, counts, models, { exactEligibility: true });
  const required = counts.reduce((n, c) => n + c.count, 0);
  if (optimized.starters.length !== required) throw new Error("Owned roster cannot fill every legal starter slot.");
  for (const c of counts) if (optimized.starters.filter(p => p.slot === c.slot).length !== c.count) throw new Error("Starter slot capacity mismatch.");
  for (const p of roster.filter(p => p.locked)) {
    const before = p.currentSlot ?? p.slot;
    const after = optimized.starters.find(s => s.playerId === p.playerId)?.slot ?? "BN";
    if (before !== after) throw new Error(`Locked player cannot move: ${p.playerId}.`);
  }
  const current = roster.filter(p => counts.some(c => c.slot === (p.currentSlot ?? p.slot))).map(p => ({ ...p, slot: p.currentSlot ?? p.slot }));
  const currentPoints = current.reduce((n, p) => n + points.get(p.playerId)!, 0);
  const currentLegal = current.length === required && counts.every(c => current.filter(p => p.slot === c.slot).length === c.count) && current.every(p => p.eligiblePositions!.includes(p.slot));
  // A tie does not justify a platform move or reshuffling flexible assignments.
  const starters = currentLegal && Math.abs(currentPoints - optimized.expectedPoints) < 1e-8 ? current : optimized.starters;
  const changes = roster.flatMap(p => {
    const before = p.currentSlot ?? p.slot;
    const after = starters.find(s => s.playerId === p.playerId)?.slot ?? "BN";
    return before === after ? [] : [{ playerId: p.playerId, from: before, to: after }];
  });
  const expectedPoints = starters.reduce((n, p) => n + points.get(p.playerId)!, 0);
  return { starters, changes, currentLegal, currentPoints, expectedPoints, expectedGain: Math.abs(expectedPoints-currentPoints)<1e-8?0:expectedPoints-currentPoints };
}

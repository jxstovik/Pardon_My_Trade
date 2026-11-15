import type { PlayerPosition } from "../../models/types.js";
import type { PlayerModel, ModelPosition } from "../../probabilistic/bayesian-model.js";
import { DEFAULT_SCARCITY } from "../../probabilistic/model-engine.js";
import { DEFAULT_DO_NOT_DROP_RANK_LIMIT, buildDoNotDropList } from "../../decisions/do-not-drop.js";
import type { AddDropAction, FreeAgentInput, RosterSlotInput } from "../types.js";

function scarcityFor(position: PlayerPosition): number {
  return DEFAULT_SCARCITY[position as ModelPosition] ?? 1;
}

function valueOf(models: Map<string, PlayerModel>, playerId: string): number {
  const model = models.get(playerId);
  if (!model) return 0;
  return model.mu * scarcityFor(model.position as ModelPosition);
}

/**
 * Rank free agents by position-adjusted value and propose add/drop pairs
 * whenever a free agent clearly out-values the worst rostered player.
 */
export function scanWaivers(
  freeAgents: ReadonlyArray<FreeAgentInput>,
  rosterSlots: ReadonlyArray<RosterSlotInput>,
  models: Map<string, PlayerModel>,
  options: { threshold?: number; maxCandidates?: number; doNotDropRankLimit?: number } = {}
): AddDropAction[] {
  const threshold = options.threshold ?? 2;
  const maxCandidates = options.maxCandidates ?? 3;

  const rankedFree = [...freeAgents]
    .map((fa) => ({ fa, value: fa.projectedPoints * scarcityFor(fa.position) }))
    .sort((a, b) => b.value - a.value);

  const doNotDrop = buildDoNotDropList(
    rosterSlots.map((slot) => slot.playerId),
    [...models.values()].map((model) => ({ playerId: model.playerId, value: valueOf(models, model.playerId) })),
    options.doNotDropRankLimit ?? DEFAULT_DO_NOT_DROP_RANK_LIMIT
  );
  const rosterWithValue = rosterSlots
    .filter((slot) => !doNotDrop.has(slot.playerId))
    .map((slot) => ({ slot, value: valueOf(models, slot.playerId) }))
    .sort((a, b) => a.value - b.value);

  const candidates: AddDropAction[] = [];
  for (const { fa, value } of rankedFree) {
    if (candidates.length >= maxCandidates) break;
    const drop = rosterWithValue[0];
    if (!drop) break;
    if (value - drop.value < threshold) continue;
    candidates.push({
      type: "add_drop",
      teamId: "",
      addPlayerIds: [fa.playerId],
      dropPlayerIds: [drop.slot.playerId]
    });
    rosterWithValue.shift();
  }
  return candidates;
}

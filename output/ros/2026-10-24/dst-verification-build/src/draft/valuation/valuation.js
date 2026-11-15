import { buildModels, applyObservations, rankByValue, DEFAULT_SCARCITY } from "../../probabilistic/model-engine.js";
import { buildPriorsFromSnapshot } from "../../agents/snapshot-integration.js";
import { normalCdf } from "../../probabilistic/normal.js";
export function buildValuationModels(snapshot, options) {
    const useProjections = options?.useProjections ?? true;
    const priors = buildPriorsFromSnapshot(snapshot, { useProjections });
    let models = buildModels(priors);
    if (options?.observations && options.observations.length > 0) {
        models = applyObservations(models, options.observations);
    }
    const scarcity = options?.scarcity ?? DEFAULT_SCARCITY;
    const ranked = rankByValue(models.values(), scarcity);
    const result = new Map();
    for (const rp of ranked) {
        result.set(rp.model.playerId, {
            playerId: rp.model.playerId,
            playerName: rp.model.playerName,
            position: rp.model.position,
            expectedPoints: rp.expectedPoints,
            value: rp.value,
            probabilities: rp.probabilities,
            tier: 0,
            survival: 1
        });
    }
    return result;
}
export function rankBestAvailable(models, excludeIds, limit) {
    const exclude = new Set(excludeIds);
    let list = [...models].filter((m) => !exclude.has(m.playerId));
    list = list.sort((a, b) => b.value - a.value);
    if (limit !== undefined)
        list = list.slice(0, limit);
    return tierPlayers(list);
}
export function tierPlayers(ranked) {
    const sorted = [...ranked].sort((a, b) => b.value - a.value);
    let tier = 0;
    let prevValue = Number.POSITIVE_INFINITY;
    const result = [];
    for (const m of sorted) {
        if (prevValue !== Number.POSITIVE_INFINITY && m.value < 0.85 * prevValue) {
            tier += 1;
        }
        result.push({ ...m, tier: tier === 0 ? 1 : tier });
        prevValue = m.value;
    }
    return result;
}
export function survivalProbability(model, picksUntilNext) {
    const sigma = Math.max(1, model.value * 0.25);
    const threshold = model.value * (picksUntilNext / (picksUntilNext + 3));
    return Math.min(1, Math.max(0, normalCdf(model.value, threshold, sigma)));
}
export function applySurvival(models, picksUntilNext) {
    return models.map((m) => ({ ...m, survival: survivalProbability(m, picksUntilNext) }));
}

import { createModel, probabilityTable, updateModel, value } from "./bayesian-model.js";
import { normalCdf } from "./normal.js";
export const DEFAULT_SCARCITY = {
    QB: 1.4,
    RB: 1.8,
    WR: 1.6,
    TE: 1.5,
    K: 1.0,
    DST: 1.1,
    FLEX: 1.3
};
export function buildModels(priors) {
    const models = new Map();
    for (const prior of priors) {
        models.set(prior.playerId, createModel(prior));
    }
    return models;
}
export function applyObservations(models, observations) {
    let next = models;
    for (const observation of observations) {
        const current = next.get(observation.playerId);
        if (!current)
            continue;
        const updated = updateModel(current, observation);
        if (next === models)
            next = new Map(models);
        next.set(observation.playerId, updated);
    }
    return next;
}
export function rankByValue(models, scarcity = DEFAULT_SCARCITY) {
    const ranked = [];
    for (const model of models) {
        const factor = scarcity[model.position] ?? 1;
        ranked.push({
            model,
            expectedPoints: model.mu,
            value: value(model, factor),
            probabilities: probabilityTable(model)
        });
    }
    return ranked.sort((a, b) => b.value - a.value);
}
/**
 * Probability that `proposed` outscores `baseline` in a given week, treating
 * both as independent normals. Used to size up trade / add-drop deltas.
 */
export function probabilityBeats(proposed, baseline) {
    const diffMu = proposed.mu - baseline.mu;
    const diffSigma = Math.sqrt(proposed.sigma * proposed.sigma + baseline.sigma * baseline.sigma);
    return 1 - normalCdf(0, diffMu, diffSigma);
}
export function evaluateTrade(give, receive, scarcity = DEFAULT_SCARCITY) {
    const factor = (m) => scarcity[m.position] ?? 1;
    const giveValue = give.reduce((sum, m) => sum + value(m, factor(m)), 0);
    const receiveValue = receive.reduce((sum, m) => sum + value(m, factor(m)), 0);
    const giveModel = aggregate(give);
    const receiveModel = aggregate(receive);
    return {
        giveValue,
        receiveValue,
        netValue: receiveValue - giveValue,
        winProbability: giveModel && receiveModel ? probabilityBeats(receiveModel, giveModel) : 0.5
    };
}
function aggregate(models) {
    if (models.length === 0)
        return null;
    if (models.length === 1)
        return models[0];
    const totalVar = models.reduce((s, m) => s + m.sigma * m.sigma, 0);
    const mu = models.reduce((s, m) => s + m.mu, 0);
    return {
        ...models[0],
        mu,
        sigma: Math.sqrt(totalVar)
    };
}

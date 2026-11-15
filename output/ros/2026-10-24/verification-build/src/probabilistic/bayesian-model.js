import { normalCdf } from "./normal.js";
export const DEFAULT_ALPHA = 0.3;
export const DEFAULT_BETA = 0.4;
function normalizeVar(variance) {
    if (!Number.isFinite(variance) || variance <= 0)
        return Math.max(variance, 1e-6);
    return variance;
}
export function createModel(prior) {
    const alpha = prior.alpha ?? DEFAULT_ALPHA;
    const beta = prior.beta ?? DEFAULT_BETA;
    return {
        playerId: prior.playerId,
        playerName: prior.playerName,
        position: prior.position,
        alpha,
        beta,
        historyMean: prior.historyMean,
        historyVar: normalizeVar(prior.historyVar),
        mu: prior.historyMean,
        sigma: Math.sqrt(normalizeVar(prior.historyVar)),
        lastObserved: null,
        weeksObserved: 0,
        lastUpdatedWeek: null,
        lastUpdatedScoringPeriod: null
    };
}
/**
 * Per-player EWMA update (plan §5):
 *   mu_{w}   = alpha * historyMean + (1 - alpha) * level_{w-1}
 *   sigma^2_{w} = beta * historyVar + (1 - beta) * sigma^2_{w-1}
 * where level_{w-1} is the previous week's realized points (or the history
 * mean before any observation). The freshly scored points become the level
 * carried into the next week's recurrence, so the model adapts to form.
 */
export function updateModel(model, observation) {
    const prevLevel = model.lastObserved ?? model.historyMean;
    const muNew = model.alpha * model.historyMean + (1 - model.alpha) * prevLevel;
    const varNew = model.beta * model.historyVar + (1 - model.beta) * model.sigma * model.sigma;
    return {
        ...model,
        mu: muNew,
        sigma: Math.sqrt(normalizeVar(varNew)),
        lastObserved: observation.points,
        weeksObserved: model.weeksObserved + 1,
        lastUpdatedWeek: observation.week,
        lastUpdatedScoringPeriod: observation.scoringPeriod ?? model.lastUpdatedScoringPeriod ?? null
    };
}
export function expectedPoints(model) {
    return model.mu;
}
export function probabilityAbove(model, threshold) {
    return 1 - normalCdf(threshold, model.mu, model.sigma);
}
export function probabilityTable(model, thresholds = [8, 12, 18]) {
    const table = {};
    for (const tau of thresholds) {
        table[tau] = probabilityAbove(model, tau);
    }
    return table;
}
export function value(model, positionScarcity) {
    return model.mu * positionScarcity;
}

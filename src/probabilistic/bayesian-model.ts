import { normalCdf } from "./normal.js";

export type ModelPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST" | "FLEX";

export interface ModelPrior {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: ModelPosition;
  readonly historyMean: number;
  readonly historyVar: number;
  readonly alpha?: number;
  readonly beta?: number;
}

export interface PlayerModel {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: ModelPosition;
  readonly alpha: number;
  readonly beta: number;
  readonly historyMean: number;
  readonly historyVar: number;
  readonly mu: number;
  readonly sigma: number;
  readonly lastObserved: number | null;
  readonly weeksObserved: number;
  readonly lastUpdatedWeek: number | null;
}

export interface Observation {
  readonly playerId: string;
  readonly week: number;
  readonly points: number;
}

export const DEFAULT_ALPHA = 0.3;
export const DEFAULT_BETA = 0.4;

function normalizeVar(variance: number): number {
  if (!Number.isFinite(variance) || variance <= 0) return Math.max(variance, 1e-6);
  return variance;
}

export function createModel(prior: ModelPrior): PlayerModel {
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
    lastUpdatedWeek: null
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
export function updateModel(model: PlayerModel, observation: Observation): PlayerModel {
  const prevLevel = model.lastObserved ?? model.historyMean;
  const muNew = model.alpha * model.historyMean + (1 - model.alpha) * prevLevel;
  const varNew = model.beta * model.historyVar + (1 - model.beta) * model.sigma * model.sigma;
  return {
    ...model,
    mu: muNew,
    sigma: Math.sqrt(normalizeVar(varNew)),
    lastObserved: observation.points,
    weeksObserved: model.weeksObserved + 1,
    lastUpdatedWeek: observation.week
  };
}

export function expectedPoints(model: PlayerModel): number {
  return model.mu;
}

export function probabilityAbove(model: PlayerModel, threshold: number): number {
  return 1 - normalCdf(threshold, model.mu, model.sigma);
}

export function probabilityTable(
  model: PlayerModel,
  thresholds: readonly number[] = [8, 12, 18]
): Record<number, number> {
  const table: Record<number, number> = {};
  for (const tau of thresholds) {
    table[tau] = probabilityAbove(model, tau);
  }
  return table;
}

export function value(model: PlayerModel, positionScarcity: number): number {
  return model.mu * positionScarcity;
}

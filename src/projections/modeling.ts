import type { PlayerPosition } from "../models/types.js";
import { projectionFromPoint, type ProbabilisticProjection } from "./probabilistic.js";

export interface HistoricalPlayerStat {
  readonly playerId: string;
  readonly position: PlayerPosition;
  readonly scoringPeriod: string;
  readonly points: number;
  readonly availability?: number;
}

export interface PlayerFeatureRow {
  readonly playerId: string;
  readonly position: PlayerPosition;
  readonly scoringPeriod: string;
  readonly sourceMean?: number;
  readonly history?: readonly number[];
  readonly availability?: number;
}

export interface PositionBaseline {
  readonly position: PlayerPosition;
  readonly mean: number;
  readonly standardDeviation: number;
  readonly samples: number;
}

export interface ProbabilisticModel {
  readonly name: string;
  predict(row: PlayerFeatureRow): ProbabilisticProjection;
}

const DEFAULTS: Partial<Record<PlayerPosition, number>> = { QB: 16, RB: 11, WR: 10, TE: 8, K: 8, DST: 7 };

export function fitPositionBaselines(history: readonly HistoricalPlayerStat[], priorWeight = 3): PositionBaseline[] {
  const grouped = new Map<PlayerPosition, number[]>();
  for (const row of history) {
    if (!Number.isFinite(row.points)) continue;
    const values = grouped.get(row.position) ?? [];
    values.push(row.points);
    grouped.set(row.position, values);
  }
  return (Object.keys(DEFAULTS) as PlayerPosition[]).map((position) => {
    const values = grouped.get(position) ?? [];
    const prior = DEFAULTS[position] ?? 8;
    const mean = (values.reduce((sum, value) => sum + value, 0) + prior * priorWeight) / (values.length + priorWeight);
    const variance = values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : 25;
    return { position, mean, standardDeviation: Math.max(2, Math.sqrt(variance)), samples: values.length };
  });
}

export function createHistoricalBaseline(history: readonly HistoricalPlayerStat[], modelVersion = "historical-baseline-v1"): ProbabilisticModel {
  const baselines = new Map(fitPositionBaselines(history).map((baseline) => [baseline.position, baseline]));
  return {
    name: "historical-baseline",
    predict(row) {
      const baseline = baselines.get(row.position) ?? { mean: DEFAULTS[row.position] ?? 8, standardDeviation: 8 };
      const recent = row.history?.filter(Number.isFinite) ?? [];
      const historyMean = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : undefined;
      const mean = row.sourceMean !== undefined && historyMean !== undefined
        ? meanOf([baseline.mean, historyMean, row.sourceMean])
        : historyMean ?? row.sourceMean ?? baseline.mean;
      const spread = recent.length > 1 ? sampleStdDev(recent) : baseline.standardDeviation;
      return projectionFromPoint(row.playerId, row.scoringPeriod, mean, Math.max(2, spread), [
        { source: "historical-stats", kind: "historical", note: `${recent.length} player observations` }
      ], modelVersion);
    }
  };
}

export function aggregateProbabilisticModels(
  row: PlayerFeatureRow,
  models: readonly ProbabilisticModel[],
  modelVersion = "ensemble-v1"
): ProbabilisticProjection {
  if (!models.length) throw new Error("At least one probabilistic model is required");
  const predictions = models.map((model) => model.predict(row));
  const mean = meanOf(predictions.map((prediction) => prediction.mean));
  const within = meanOf(predictions.map((prediction) => prediction.standardDeviation ** 2));
  const disagreement = meanOf(predictions.map((prediction) => (prediction.mean - mean) ** 2));
  const spread = Math.sqrt(within + disagreement);
  return projectionFromPoint(row.playerId, row.scoringPeriod, mean, spread, [
    ...predictions.flatMap((prediction) => prediction.provenance),
    { source: "probabilistic-ensemble", kind: "metamodel", modelVersion }
  ], modelVersion);
}

function meanOf(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = meanOf(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

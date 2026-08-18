import type { ProbabilisticProjection } from "./probabilistic.js";

export interface CalibrationObservation { readonly prediction: ProbabilisticProjection; readonly actual: number; }
export interface CalibrationMetrics { readonly samples: number; readonly meanAbsoluteError: number; readonly p10Coverage: number; readonly p90Coverage: number; readonly intervalCoverage: number; readonly averageSpread: number; }

export function calibrationMetrics(rows: readonly CalibrationObservation[]): CalibrationMetrics {
  if (!rows.length) return { samples: 0, meanAbsoluteError: 0, p10Coverage: 0, p90Coverage: 0, intervalCoverage: 0, averageSpread: 0 };
  const abs = rows.map(({ prediction, actual }) => Math.abs(prediction.mean - actual));
  return {
    samples: rows.length,
    meanAbsoluteError: average(abs),
    p10Coverage: rows.filter(({ prediction, actual }) => actual >= prediction.quantiles.p10).length / rows.length,
    p90Coverage: rows.filter(({ prediction, actual }) => actual <= prediction.quantiles.p90).length / rows.length,
    intervalCoverage: rows.filter(({ prediction, actual }) => actual >= prediction.quantiles.p10 && actual <= prediction.quantiles.p90).length / rows.length,
    averageSpread: average(rows.map(({ prediction }) => prediction.standardDeviation))
  };
}

function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

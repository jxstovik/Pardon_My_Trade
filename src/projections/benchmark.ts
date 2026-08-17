export interface PointObservation {
  readonly actual: number;
  readonly predicted: number;
}

export type QuantileForecast = Readonly<Record<string, number>> | ReadonlyMap<number, number>;

export interface PredictionInterval {
  readonly lower: number;
  readonly upper: number;
}

export interface BenchmarkObservation extends PointObservation {
  readonly playerId?: string;
  readonly scoringPeriod: string;
  readonly quantiles?: QuantileForecast;
  readonly interval?: PredictionInterval;
  readonly predictedRank?: number;
  readonly actualRank?: number;
}

export interface PointMetrics {
  readonly samples: number;
  readonly mae: number;
  readonly rmse: number;
  readonly bias: number;
}

export interface QuantileMetric {
  readonly quantile: number;
  readonly samples: number;
  readonly pinballLoss: number;
}

export interface QuantileMetrics {
  readonly samples: number;
  readonly byQuantile: readonly QuantileMetric[];
  readonly pinballLoss: Readonly<Record<string, number>>;
  readonly meanPinballLoss: number;
}

export interface IntervalObservation {
  readonly actual: number;
  readonly lower: number;
  readonly upper: number;
  readonly playerId?: string;
  readonly scoringPeriod?: string;
}

export interface IntervalMetrics {
  readonly samples: number;
  readonly coverage: number;
  readonly width: number;
  readonly intervalScore: number;
  readonly targetCoverage: number;
}

export interface RankMetricOptions {
  readonly topK?: readonly number[];
}

export interface RankMetrics {
  readonly samples: number;
  readonly mae: number;
  readonly rmse: number;
  readonly spearman: number;
  readonly topKHitRate: Readonly<Record<string, number>>;
  readonly ndcg: Readonly<Record<string, number>>;
}

export interface BenchmarkOptions {
  readonly quantiles?: readonly number[];
  readonly interval?: {
    readonly lowerQuantile?: number;
    readonly upperQuantile?: number;
    readonly alpha?: number;
  };
  readonly rank?: RankMetricOptions;
}

export interface BenchmarkMetrics {
  readonly samples: number;
  readonly point: PointMetrics;
  readonly quantile: QuantileMetrics;
  readonly interval: IntervalMetrics;
  readonly rank: RankMetrics;
}

export const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
export const DEFAULT_INTERVAL_ALPHA = 0.2;

export function pointMetrics(rows: readonly PointObservation[]): PointMetrics {
  for (const row of rows) {
    assertFinite(row.actual, "actual");
    assertFinite(row.predicted, "predicted");
  }
  const errors = rows.map((row) => row.predicted - row.actual);
  return {
    samples: errors.length,
    mae: average(errors.map(Math.abs)),
    rmse: Math.sqrt(average(errors.map((error) => error * error))),
    bias: average(errors)
  };
}

export function pinballLoss(actual: number, predicted: number, quantile: number): number {
  assertFinite(actual, "actual");
  assertFinite(predicted, "predicted");
  assertQuantile(quantile);
  const error = actual - predicted;
  return error >= 0 ? quantile * error : (quantile - 1) * error;
}

export function quantileMetrics(
  rows: readonly Pick<BenchmarkObservation, "actual" | "quantiles">[],
  levels: readonly number[] = inferQuantileLevels(rows)
): QuantileMetrics {
  const quantiles = normalizeQuantiles(levels);
  const byQuantile: QuantileMetric[] = [];
  const losses: Record<string, number> = {};
  const allLosses: number[] = [];

  for (const row of rows) {
    assertFinite(row.actual, "actual");
  }
  for (const quantile of quantiles) {
    const values: number[] = [];
    for (const row of rows) {
      const predicted = row.quantiles === undefined ? undefined : readQuantile(row.quantiles, quantile);
      if (predicted === undefined) continue;
      const loss = pinballLoss(row.actual, predicted, quantile);
      values.push(loss);
      allLosses.push(loss);
    }
    const loss = average(values);
    byQuantile.push({ quantile, samples: values.length, pinballLoss: loss });
    losses[quantileKey(quantile)] = loss;
  }

  return {
    samples: rows.length,
    byQuantile,
    pinballLoss: losses,
    meanPinballLoss: average(allLosses)
  };
}

export function intervalScore(actual: number, lower: number, upper: number, alpha: number): number {
  assertFinite(actual, "actual");
  assertFinite(lower, "lower");
  assertFinite(upper, "upper");
  assertAlpha(alpha);
  if (lower > upper) throw new Error("lower interval bound must not exceed upper interval bound");
  const penalty = actual < lower
    ? (2 / alpha) * (lower - actual)
    : actual > upper
      ? (2 / alpha) * (actual - upper)
      : 0;
  return upper - lower + penalty;
}

export function intervalMetrics(rows: readonly IntervalObservation[], alpha?: number): IntervalMetrics;
export function intervalMetrics(rows: readonly BenchmarkObservation[], alpha?: number): IntervalMetrics;
export function intervalMetrics(
  rows: readonly (IntervalObservation | BenchmarkObservation)[],
  alpha = DEFAULT_INTERVAL_ALPHA
): IntervalMetrics {
  assertAlpha(alpha);
  const usable: IntervalObservation[] = [];
  for (const row of rows) {
    const interval = "lower" in row && "upper" in row
      ? row
      : row.interval;
    if (interval === undefined) continue;
    usable.push({ actual: row.actual, lower: interval.lower, upper: interval.upper });
  }
  for (const row of usable) {
    assertFinite(row.actual, "actual");
    assertFinite(row.lower, "lower");
    assertFinite(row.upper, "upper");
    if (row.lower > row.upper) throw new Error("lower interval bound must not exceed upper interval bound");
  }
  const widths = usable.map((row) => row.upper - row.lower);
  const scores = usable.map((row) => intervalScore(row.actual, row.lower, row.upper, alpha));
  return {
    samples: usable.length,
    coverage: usable.length === 0 ? 0 : usable.filter((row) => row.actual >= row.lower && row.actual <= row.upper).length / usable.length,
    width: average(widths),
    intervalScore: average(scores),
    targetCoverage: 1 - alpha
  };
}

export function averageRanks(values: readonly number[], descending = true): number[] {
  values.forEach((value) => assertFinite(value, "rank value"));
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => descending ? right.value - left.value : left.value - right.value);
  const ranks = new Array<number>(values.length);
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].value === ordered[index].value) end += 1;
    const rank = (index + 1 + end) / 2;
    for (let offset = index; offset < end; offset += 1) ranks[ordered[offset].index] = rank;
    index = end;
  }
  return ranks;
}

export const tieSafeAverageRanks = averageRanks;

export function rankMetrics(rows: readonly BenchmarkObservation[], options: RankMetricOptions = {}): RankMetrics {
  const groups = groupByPeriod(rows);
  const rankErrors: number[] = [];
  const predictedRanks: number[] = [];
  const actualRanks: number[] = [];
  const topK = normalizeTopK(options.topK ?? [12, 24, 36]);
  const topHits = new Map<number, number[]>();
  const ndcgValues = new Map<number, number[]>();
  for (const value of topK) {
    topHits.set(value, []);
    ndcgValues.set(value, []);
  }

  for (const group of groups.values()) {
    const predicted = group.map((row) => row.predicted);
    const actual = group.map((row) => row.actual);
    const derivedPredictedRanks = averageRanks(predicted);
    const derivedActualRanks = averageRanks(actual);
    const groupPredictedRanks = group.map((row, index) => row.predictedRank ?? derivedPredictedRanks[index]);
    const groupActualRanks = group.map((row, index) => row.actualRank ?? derivedActualRanks[index]);
    for (let index = 0; index < group.length; index += 1) {
      assertFinite(groupPredictedRanks[index], "predicted rank");
      assertFinite(groupActualRanks[index], "actual rank");
      const error = groupPredictedRanks[index] - groupActualRanks[index];
      rankErrors.push(error);
      predictedRanks.push(groupPredictedRanks[index]);
      actualRanks.push(groupActualRanks[index]);
    }

    const predictedOrder = group
      .map((_, index) => index)
      .sort((left, right) => groupPredictedRanks[left] - groupPredictedRanks[right] || left - right);
    const actualOrder = group
      .map((_, index) => index)
      .sort((left, right) => groupActualRanks[left] - groupActualRanks[right] || left - right);
    for (const k of topK) {
      const predictedTop = new Set(predictedOrder.slice(0, k));
      const actualTop = new Set(actualOrder.slice(0, k));
      const hits = [...predictedTop].filter((index) => actualTop.has(index)).length;
      topHits.get(k)!.push(hits / Math.min(k, group.length));
      const gains = predictedOrder.slice(0, k).map((index) => Math.max(0, actual[index]));
      const ideal = actualOrder.slice(0, k).map((index) => Math.max(0, actual[index]));
      const dcg = discountedGain(gains);
      const idealDcg = discountedGain([...ideal].sort((left, right) => right - left));
      ndcgValues.get(k)!.push(idealDcg === 0 ? 0 : dcg / idealDcg);
    }
  }

  const topKHitRate: Record<string, number> = {};
  const ndcg: Record<string, number> = {};
  for (const k of topK) {
    topKHitRate[String(k)] = average(topHits.get(k)!);
    ndcg[String(k)] = average(ndcgValues.get(k)!);
  }
  return {
    samples: rankErrors.length,
    mae: average(rankErrors.map(Math.abs)),
    rmse: Math.sqrt(average(rankErrors.map((error) => error * error))),
    spearman: correlation(predictedRanks, actualRanks),
    topKHitRate,
    ndcg
  };
}

export function evaluateBenchmark(
  rows: readonly BenchmarkObservation[],
  options: BenchmarkOptions = {}
): BenchmarkMetrics {
  const point = pointMetrics(rows);
  const quantile = quantileMetrics(rows, options.quantiles ?? inferQuantileLevels(rows));
  const lowerQuantile = options.interval?.lowerQuantile ?? 0.1;
  const upperQuantile = options.interval?.upperQuantile ?? 0.9;
  assertQuantile(lowerQuantile);
  assertQuantile(upperQuantile);
  if (lowerQuantile >= upperQuantile) throw new Error("lower interval quantile must be below upper interval quantile");
  const intervalRows: IntervalObservation[] = [];
  for (const row of rows) {
    if (row.interval !== undefined) {
      intervalRows.push({ actual: row.actual, lower: row.interval.lower, upper: row.interval.upper });
      continue;
    }
    const lower = row.quantiles === undefined ? undefined : readQuantile(row.quantiles, lowerQuantile);
    const upper = row.quantiles === undefined ? undefined : readQuantile(row.quantiles, upperQuantile);
    if (lower !== undefined && upper !== undefined) intervalRows.push({ actual: row.actual, lower, upper });
  }
  const interval = intervalMetrics(intervalRows, options.interval?.alpha ?? DEFAULT_INTERVAL_ALPHA);
  const rank = rankMetrics(rows, options.rank);
  return { samples: rows.length, point, quantile, interval, rank };
}

function groupByPeriod(rows: readonly BenchmarkObservation[]): Map<string, BenchmarkObservation[]> {
  const groups = new Map<string, BenchmarkObservation[]>();
  for (const row of rows) {
    const group = groups.get(row.scoringPeriod) ?? [];
    group.push(row);
    groups.set(row.scoringPeriod, group);
  }
  return groups;
}

function inferQuantileLevels(rows: readonly Pick<BenchmarkObservation, "quantiles">[]): number[] {
  const levels = new Set<number>();
  for (const row of rows) {
    if (row.quantiles === undefined) continue;
    for (const level of quantileLevels(row.quantiles)) levels.add(level);
  }
  return levels.size ? [...levels].sort((left, right) => left - right) : [...DEFAULT_QUANTILES];
}

function quantileLevels(forecast: QuantileForecast): number[] {
  if (forecast instanceof Map) {
    return [...forecast.keys()].filter((level) => Number.isFinite(level));
  }
  return Object.keys(forecast).flatMap((key) => {
    const percent = /^p(\d+(?:\.\d+)?)$/i.exec(key);
    const level = percent ? Number(percent[1]) / 100 : Number(key);
    return Number.isFinite(level) ? [level] : [];
  });
}

function readQuantile(forecast: QuantileForecast, quantile: number): number | undefined {
  if (forecast instanceof Map) {
    const direct = forecast.get(quantile);
    if (direct !== undefined) return direct;
    const near = [...forecast.entries()].find(([level]) => Math.abs(level - quantile) < 1e-12);
    return near?.[1];
  }
  const objectForecast = forecast as Readonly<Record<string, number>>;
  const keys = [String(quantile), quantileKey(quantile), `p${trimNumber(quantile * 100)}`];
  for (const key of keys) {
    const value = objectForecast[key];
    if (value !== undefined) {
      assertFinite(value, `quantile ${quantile}`);
      return value;
    }
  }
  return undefined;
}

function normalizeQuantiles(levels: readonly number[]): number[] {
  return [...new Set(levels)].sort((left, right) => left - right).map((level) => {
    assertQuantile(level);
    return level;
  });
}

function normalizeTopK(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right).map((value) => {
    if (!Number.isInteger(value) || value <= 0) throw new Error("topK values must be positive integers");
    return value;
  });
}

function discountedGain(gains: readonly number[]): number {
  return gains.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
}

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length < 2 || left.length !== right.length) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0));
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  if (leftScale === 0 || rightScale === 0) return left.every((value, index) => value === right[index]) ? 1 : 0;
  return Math.max(-1, Math.min(1, numerator / (leftScale * rightScale)));
}

function quantileKey(quantile: number): string {
  return trimNumber(quantile);
}

function trimNumber(value: number): string {
  return Number(value.toFixed(12)).toString();
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertQuantile(value: number): void {
  assertFinite(value, "quantile");
  if (value <= 0 || value >= 1) throw new Error("quantile must be between 0 and 1");
}

function assertAlpha(value: number): void {
  assertFinite(value, "alpha");
  if (value <= 0 || value > 1) throw new Error("alpha must be greater than 0 and no greater than 1");
}

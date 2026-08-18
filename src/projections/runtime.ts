import { readFile, writeFile } from "node:fs/promises";
import type { PlayerPosition } from "../models/types.js";
import { resolveProjectionFallback, type ProjectionCandidateForFallback } from "./fallback.js";
import { aggregateProbabilisticModels, createHistoricalBaseline, type HistoricalPlayerStat, type PlayerFeatureRow } from "./modeling.js";
import type { ProbabilisticProjection } from "./probabilistic.js";

export interface HistoricalDataFile { readonly observations: readonly HistoricalPlayerStat[]; }

export async function loadHistoricalData(path: string): Promise<HistoricalPlayerStat[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as HistoricalDataFile | HistoricalPlayerStat[];
  return Array.isArray(parsed) ? [...parsed] : [...parsed.observations];
}

export function buildRuntimeProbabilisticProjections(
  rows: readonly PlayerFeatureRow[],
  external: readonly ProjectionCandidateForFallback[],
  razzball: readonly ProjectionCandidateForFallback[],
  history: readonly HistoricalPlayerStat[]
): ProbabilisticProjection[] {
  const baseline = createHistoricalBaseline(history);
  const byPlayerPeriod = (playerId: string, period: string) => `${playerId}:${period}`;
  return rows.flatMap((row) => {
    const candidate = aggregateProbabilisticModels(row, [baseline]);
    const source = external.find((item) => byPlayerPeriod(item.playerId, item.scoringPeriod) === byPlayerPeriod(row.playerId, row.scoringPeriod));
    const rz = razzball.find((item) => byPlayerPeriod(item.playerId, item.scoringPeriod) === byPlayerPeriod(row.playerId, row.scoringPeriod));
    const resolved = resolveProjectionFallback({ playerId: candidate.playerId, source: "historical-metamodel", projectedPoints: candidate.mean, standardDeviation: candidate.standardDeviation, scoringPeriod: candidate.scoringPeriod }, source ? [source] : [], rz);
    return resolved ? [resolved.projection] : [];
  });
}

export async function saveProbabilisticProjections(path: string, projections: readonly ProbabilisticProjection[]): Promise<void> {
  await writeFile(path, JSON.stringify({ generatedAt: new Date().toISOString(), projections }, null, 2), "utf8");
}

export function positionFromValue(value: string): PlayerPosition {
  const normalized = value.toUpperCase();
  if (["QB", "RB", "WR", "TE", "K", "DST"].includes(normalized)) return normalized as PlayerPosition;
  return "WR";
}

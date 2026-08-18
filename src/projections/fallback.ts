import type { ProbabilisticProjection } from "./probabilistic.js";
import { projectionFromPoint } from "./probabilistic.js";

export interface ProjectionCandidateForFallback {
  readonly playerId: string;
  readonly source: string;
  readonly projectedPoints: number;
  readonly standardDeviation?: number;
  readonly scoringPeriod: string;
}

export interface FallbackDecision {
  readonly projection: ProbabilisticProjection;
  readonly reason: "metamodel" | "external" | "razzball";
}

export function resolveProjectionFallback(
  metamodel: ProjectionCandidateForFallback | undefined,
  external: readonly ProjectionCandidateForFallback[],
  razzball: ProjectionCandidateForFallback | undefined,
  defaultStandardDeviation = 8
): FallbackDecision | undefined {
  const selected = metamodel ?? external[0] ?? razzball;
  if (!selected) return undefined;
  const reason = metamodel ? "metamodel" : external.length ? "external" : "razzball";
  const isRazzball = reason === "razzball";
  const projection = projectionFromPoint(
    selected.playerId,
    selected.scoringPeriod,
    selected.projectedPoints,
    selected.standardDeviation ?? (isRazzball ? defaultStandardDeviation * 1.15 : defaultStandardDeviation),
    [{ source: selected.source, kind: isRazzball ? "fallback" : reason, note: isRazzball ? "Razzball fallback" : undefined }],
    isRazzball ? "razzball-fallback-v1" : `${reason}-projection-v1`
  );
  return { projection: isRazzball ? { ...projection, fallback: "razzball" } : projection, reason };
}

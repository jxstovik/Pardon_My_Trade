export interface ProjectionProvenance {
  readonly source: string;
  readonly kind: "historical" | "external" | "metamodel" | "fallback";
  readonly modelVersion?: string;
  readonly observedAt?: string;
  readonly note?: string;
}

export interface ProbabilisticProjection {
  readonly playerId: string;
  readonly scoringPeriod: string;
  readonly mean: number;
  readonly standardDeviation: number;
  readonly quantiles: {
    readonly p10: number;
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
  };
  readonly modelVersion: string;
  readonly provenance: readonly ProjectionProvenance[];
  readonly fallback?: "razzball" | "position-baseline";
}

export function projectionFromPoint(
  playerId: string,
  scoringPeriod: string,
  mean: number,
  standardDeviation: number,
  provenance: readonly ProjectionProvenance[],
  modelVersion = "external-point-v1"
): ProbabilisticProjection {
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new Error("mean must be finite and standardDeviation must be non-negative");
  }
  const q = (z: number) => Math.max(0, mean + z * standardDeviation);
  return {
    playerId,
    scoringPeriod,
    mean,
    standardDeviation,
    quantiles: { p10: q(-1.282), p25: q(-0.674), p50: mean, p75: q(0.674), p90: q(1.282) },
    modelVersion,
    provenance
  };
}

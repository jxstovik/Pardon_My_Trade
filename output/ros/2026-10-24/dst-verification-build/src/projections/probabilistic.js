export function projectionFromPoint(playerId, scoringPeriod, mean, standardDeviation, provenance, modelVersion = "external-point-v1") {
    if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
        throw new Error("mean must be finite and standardDeviation must be non-negative");
    }
    const q = (z) => Math.max(0, mean + z * standardDeviation);
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

import { projectionFromPoint } from "./probabilistic.js";
export function resolveProjectionFallback(metamodel, external, razzball, defaultStandardDeviation = 8) {
    const selected = metamodel ?? external[0] ?? razzball;
    if (!selected)
        return undefined;
    const reason = metamodel ? "metamodel" : external.length ? "external" : "razzball";
    const isRazzball = reason === "razzball";
    const projection = projectionFromPoint(selected.playerId, selected.scoringPeriod, selected.projectedPoints, selected.standardDeviation ?? (isRazzball ? defaultStandardDeviation * 1.15 : defaultStandardDeviation), [{ source: selected.source, kind: isRazzball ? "fallback" : reason, note: isRazzball ? "Razzball fallback" : undefined }], isRazzball ? "razzball-fallback-v1" : `${reason}-projection-v1`);
    return { projection: isRazzball ? { ...projection, fallback: "razzball" } : projection, reason };
}

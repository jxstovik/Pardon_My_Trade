import { readFile, writeFile } from "node:fs/promises";
import { resolveProjectionFallback } from "./fallback.js";
import { aggregateProbabilisticModels, createHistoricalBaseline } from "./modeling.js";
export async function loadHistoricalData(path) {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed) ? [...parsed] : [...parsed.observations];
}
export function buildRuntimeProbabilisticProjections(rows, external, razzball, history) {
    const baseline = createHistoricalBaseline(history);
    const byPlayerPeriod = (playerId, period) => `${playerId}:${period}`;
    return rows.flatMap((row) => {
        const candidate = aggregateProbabilisticModels(row, [baseline]);
        const source = external.find((item) => byPlayerPeriod(item.playerId, item.scoringPeriod) === byPlayerPeriod(row.playerId, row.scoringPeriod));
        const rz = razzball.find((item) => byPlayerPeriod(item.playerId, item.scoringPeriod) === byPlayerPeriod(row.playerId, row.scoringPeriod));
        const resolved = resolveProjectionFallback({ playerId: candidate.playerId, source: "historical-metamodel", projectedPoints: candidate.mean, standardDeviation: candidate.standardDeviation, scoringPeriod: candidate.scoringPeriod }, source ? [source] : [], rz);
        return resolved ? [resolved.projection] : [];
    });
}
export async function saveProbabilisticProjections(path, projections) {
    await writeFile(path, JSON.stringify({ generatedAt: new Date().toISOString(), projections }, null, 2), "utf8");
}
export function positionFromValue(value) {
    const normalized = value.toUpperCase();
    if (["QB", "RB", "WR", "TE", "K", "DST"].includes(normalized))
        return normalized;
    return "WR";
}

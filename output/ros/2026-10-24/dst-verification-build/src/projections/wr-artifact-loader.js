import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectionFromPoint } from "./probabilistic.js";
/** Load only a replay whose explicit walk-forward promotion gate passed. */
export async function loadApprovedWrArtifact(directory) {
    const manifest = JSON.parse(await readFile(join(directory, "walkforward-manifest.json"), "utf8"));
    const promotion = JSON.parse(await readFile(join(directory, "promotion-decision.json"), "utf8"));
    if (promotion.approved !== true || promotion.status !== "pass") {
        throw new Error(`WR artifact ${manifest.replay_id} is not approved for runtime use.`);
    }
    const model = JSON.parse(await readFile(join(directory, "model.json"), "utf8"));
    const raw = JSON.parse(await readFile(join(directory, "preseason_predictions.json"), "utf8"));
    const predictions = new Map();
    for (const row of raw) {
        if (row.player_id && Number.isFinite(row.hard_stats_points))
            predictions.set(row.player_id, row);
    }
    return {
        directory,
        replayId: manifest.replay_id,
        season: manifest.season,
        modelVersion: model.model_version ?? "unknown",
        cutoff: manifest.preseason_cutoff,
        predictions
    };
}
export function projectionFromApprovedWrArtifact(artifact, playerId, scoringPeriod) {
    const prediction = artifact.predictions.get(playerId);
    if (!prediction)
        return undefined;
    const p10 = prediction.hard_stats_p10 ?? Math.max(0, prediction.hard_stats_points * 0.5);
    const p90 = prediction.hard_stats_p90 ?? prediction.hard_stats_points * 1.5;
    const standardDeviation = Math.max(2, (p90 - p10) / 2.564);
    return projectionFromPoint(playerId, scoringPeriod, prediction.hard_stats_points, standardDeviation, [
        { source: "chatpft-wr-artifact", kind: "metamodel", modelVersion: artifact.modelVersion, observedAt: artifact.cutoff, note: `approved replay ${artifact.replayId}` }
    ], artifact.modelVersion);
}

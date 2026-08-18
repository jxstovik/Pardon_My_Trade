import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectionFromPoint, type ProbabilisticProjection } from "./probabilistic.js";

export interface WrArtifactPrediction {
  readonly player_id: string;
  readonly player_name: string;
  readonly team?: string;
  readonly hard_stats_points: number;
  readonly hard_stats_p10?: number;
  readonly hard_stats_p90?: number;
}

export interface ApprovedWrArtifact {
  readonly directory: string;
  readonly replayId: string;
  readonly season: number;
  readonly modelVersion: string;
  readonly cutoff: string;
  readonly predictions: ReadonlyMap<string, WrArtifactPrediction>;
}

/** Load only a replay whose explicit walk-forward promotion gate passed. */
export async function loadApprovedWrArtifact(directory: string): Promise<ApprovedWrArtifact> {
  const manifest = JSON.parse(await readFile(join(directory, "walkforward-manifest.json"), "utf8")) as {
    replay_id: string;
    season: number;
    preseason_cutoff: string;
    data_status: string;
  };
  const promotion = JSON.parse(await readFile(join(directory, "promotion-decision.json"), "utf8")) as { approved?: boolean; status?: string };
  if (promotion.approved !== true || promotion.status !== "pass") {
    throw new Error(`WR artifact ${manifest.replay_id} is not approved for runtime use.`);
  }
  const model = JSON.parse(await readFile(join(directory, "model.json"), "utf8")) as { model_version?: string };
  const raw = JSON.parse(await readFile(join(directory, "preseason_predictions.json"), "utf8")) as WrArtifactPrediction[];
  const predictions = new Map<string, WrArtifactPrediction>();
  for (const row of raw) {
    if (row.player_id && Number.isFinite(row.hard_stats_points)) predictions.set(row.player_id, row);
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

export function projectionFromApprovedWrArtifact(
  artifact: ApprovedWrArtifact,
  playerId: string,
  scoringPeriod: string
): ProbabilisticProjection | undefined {
  const prediction = artifact.predictions.get(playerId);
  if (!prediction) return undefined;
  const p10 = prediction.hard_stats_p10 ?? Math.max(0, prediction.hard_stats_points * 0.5);
  const p90 = prediction.hard_stats_p90 ?? prediction.hard_stats_points * 1.5;
  const standardDeviation = Math.max(2, (p90 - p10) / 2.564);
  return projectionFromPoint(playerId, scoringPeriod, prediction.hard_stats_points, standardDeviation, [
    { source: "chatpft-wr-artifact", kind: "metamodel", modelVersion: artifact.modelVersion, observedAt: artifact.cutoff, note: `approved replay ${artifact.replayId}` }
  ], artifact.modelVersion);
}

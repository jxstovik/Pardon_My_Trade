import type { ConsensusProjection, ProjectionSourceInput } from "../models/v1.js";

export interface ProjectionEngine {
  buildConsensus(sources: ProjectionSourceInput[], scoringPeriod: string): ConsensusProjection[];
}

export class DefaultProjectionEngine implements ProjectionEngine {
  buildConsensus(sources: ProjectionSourceInput[], scoringPeriod: string): ConsensusProjection[] {
    const byPlayer = new Map<string, ConsensusProjection>();

    for (const source of sources) {
      for (const projection of source.projections) {
        const existing = byPlayer.get(projection.player_id);
        const points = projection.projected_points;
        const floor = projection.floor ?? points;
        const ceiling = projection.ceiling ?? points;

        if (!existing) {
          byPlayer.set(projection.player_id, {
            projection_id: `consensus-${projection.player_id}-${scoringPeriod}`,
            player_id: projection.player_id,
            scoring_period: scoringPeriod,
            projected_points: points,
            floor,
            ceiling,
            confidence: projection.confidence ?? 0.5,
            sources: 1
          });
          continue;
        }

        const count = existing.sources + 1;
        const blendedPoints = (existing.projected_points * existing.sources + points) / count;
        const blendedFloor = (existing.floor * existing.sources + floor) / count;
        const blendedCeiling = (existing.ceiling * existing.sources + ceiling) / count;
        const blendedConfidence = Math.min(0.95, (existing.confidence * existing.sources + (projection.confidence ?? 0.5)) / count + 0.05 * count);

        byPlayer.set(projection.player_id, {
          ...existing,
          projected_points: Math.round(blendedPoints * 100) / 100,
          floor: Math.round(blendedFloor * 100) / 100,
          ceiling: Math.round(blendedCeiling * 100) / 100,
          confidence: Math.round(blendedConfidence * 100) / 100,
          sources: count
        });
      }
    }

    return Array.from(byPlayer.values()).sort((a, b) => b.projected_points - a.projected_points);
  }
}

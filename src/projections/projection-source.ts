import type { PlayerPosition } from "../models/types.js";

export interface ProjectionCandidate {
  readonly name: string;
  readonly team: string;
  readonly positions: PlayerPosition[];
  readonly projected_stats: Record<string, number>;
  readonly projected_points: number;
  readonly floor: number;
  readonly ceiling: number;
  readonly confidence: number;
}

export interface ProjectionSource {
  readonly name: string;
  fetchProjections(sport: string, season: string, scoringPeriod: string): Promise<ProjectionCandidate[]>;
  /**
   * Set by "optional" sources when the last fetch was tolerated instead of
   * thrown (source 404, parse break, premium session missing). Callers use it
   * to report a degraded source without aborting the run.
   */
  readonly lastSkipReason?: string;
}

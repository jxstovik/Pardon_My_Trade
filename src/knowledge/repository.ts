import type { DecisionAudit, LeagueSnapshot, Projection, Recommendation } from "../models/types.js";

export interface KnowledgeRepository {
  saveLeagueSnapshot(snapshot: LeagueSnapshot): Promise<void>;
  getLeagueSnapshot(snapshotId: string): Promise<LeagueSnapshot | undefined>;
  saveRecommendation(recommendation: Recommendation): Promise<void>;
  getRecommendation(recommendationId: string): Promise<Recommendation | undefined>;
  saveDecisionAudit(audit: DecisionAudit): Promise<void>;
  getDecisionAudit(auditId: string): Promise<DecisionAudit | undefined>;
  listRecommendations(leagueId: string): Promise<Recommendation[]>;
  /** Persist (insert or update) projection rows; the snapshot itself stays immutable. */
  /** An omitted league ID preserves the legacy, unscoped projection store. */
  upsertProjections(projections: Projection[], leagueId?: string): Promise<void>;
  /** Return all stored projections for a scoring period (e.g. `2026-ROS`, `2026-W01`). */
  /** An omitted league ID returns projections across leagues for compatibility. */
  getProjections(scoringPeriod: string, leagueId?: string): Promise<Projection[]>;
}

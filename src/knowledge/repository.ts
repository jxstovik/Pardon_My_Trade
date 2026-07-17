import type { DecisionAudit, LeagueSnapshot, Recommendation } from "../models/types.js";

export interface KnowledgeRepository {
  saveLeagueSnapshot(snapshot: LeagueSnapshot): Promise<void>;
  getLeagueSnapshot(snapshotId: string): Promise<LeagueSnapshot | undefined>;
  saveRecommendation(recommendation: Recommendation): Promise<void>;
  getRecommendation(recommendationId: string): Promise<Recommendation | undefined>;
  saveDecisionAudit(audit: DecisionAudit): Promise<void>;
  getDecisionAudit(auditId: string): Promise<DecisionAudit | undefined>;
  listRecommendations(leagueId: string): Promise<Recommendation[]>;
}

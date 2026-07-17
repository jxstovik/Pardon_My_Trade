import { PmtError } from "../errors.js";
import type { DecisionAudit, LeagueSnapshot, Recommendation } from "../models/types.js";
import type { KnowledgeRepository } from "./repository.js";

export interface InMemoryKnowledgeOptions {
  readonly snapshots?: LeagueSnapshot[];
  readonly recommendations?: Recommendation[];
  readonly audits?: DecisionAudit[];
}

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly snapshots = new Map<string, LeagueSnapshot>();
  private readonly recommendations = new Map<string, Recommendation>();
  private readonly audits = new Map<string, DecisionAudit>();

  constructor(options: InMemoryKnowledgeOptions = {}) {
    for (const snapshot of options.snapshots ?? []) {
      this.snapshots.set(snapshot.snapshot_id, snapshot);
    }
    for (const recommendation of options.recommendations ?? []) {
      this.recommendations.set(recommendation.recommendation_id, recommendation);
    }
    for (const audit of options.audits ?? []) {
      this.audits.set(audit.audit_id, audit);
    }
  }

  async saveLeagueSnapshot(snapshot: LeagueSnapshot): Promise<void> {
    if (this.snapshots.has(snapshot.snapshot_id)) {
      throw new PmtError({
        code: "SNAPSHOT_ALREADY_EXISTS",
        message: `League snapshot ${snapshot.snapshot_id} already exists and is immutable.`,
        source: "knowledge",
        retryable: false
      });
    }
    this.snapshots.set(snapshot.snapshot_id, snapshot);
  }

  async getLeagueSnapshot(snapshotId: string): Promise<LeagueSnapshot | undefined> {
    return this.snapshots.get(snapshotId);
  }

  async saveRecommendation(recommendation: Recommendation): Promise<void> {
    this.recommendations.set(recommendation.recommendation_id, recommendation);
  }

  async getRecommendation(recommendationId: string): Promise<Recommendation | undefined> {
    return this.recommendations.get(recommendationId);
  }

  async saveDecisionAudit(audit: DecisionAudit): Promise<void> {
    this.audits.set(audit.audit_id, audit);
  }

  async getDecisionAudit(auditId: string): Promise<DecisionAudit | undefined> {
    return this.audits.get(auditId);
  }

  async listRecommendations(leagueId: string): Promise<Recommendation[]> {
    return Array.from(this.recommendations.values()).filter(
      (recommendation) => recommendation.league_id === leagueId
    );
  }
}

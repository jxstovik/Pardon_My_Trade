import { PmtError } from "../errors.js";
import type { DecisionAudit, LeagueSnapshot, Projection, Recommendation } from "../models/types.js";
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
  private readonly projections = new Map<string, { projection: Projection; leagueId?: string }>();

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
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return undefined;
    const season = snapshot.league.season;
    const stored = this.storedForSeason(season, snapshot.league.league_id);
    if (stored.length > 0) {
      const merged = [...snapshot.projections];
      for (const p of stored) {
        const key = `${p.player_id}|${p.source}|${p.scoring_period}`;
        const idx = merged.findIndex((x) => `${x.player_id}|${x.source}|${x.scoring_period}` === key);
        if (idx >= 0) merged[idx] = p; else merged.push(p);
      }
      return { ...snapshot, projections: merged };
    }
    return snapshot;
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

  async upsertProjections(projections: Projection[], leagueId?: string): Promise<void> {
    for (const p of projections) {
      this.projections.set(`${leagueId ?? ""}|${p.projection_id}`, { projection: p, leagueId });
    }
  }

  async getProjections(scoringPeriod: string, leagueId?: string): Promise<Projection[]> {
    return Array.from(this.projections.values())
      .filter((entry) => entry.projection.scoring_period === scoringPeriod && (leagueId === undefined || entry.leagueId === leagueId))
      .map((entry) => entry.projection);
  }

  private storedForSeason(season: string, leagueId: string): Projection[] {
    return Array.from(this.projections.values())
      .filter((entry) => entry.projection.scoring_period.startsWith(`${season}-`) && (entry.leagueId === leagueId || entry.leagueId === undefined))
      .map((entry) => entry.projection);
  }
}

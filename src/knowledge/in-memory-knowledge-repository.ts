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
  private readonly latestByLeague = new Map<string, string>();
  private readonly recommendations = new Map<string, Recommendation>();
  private readonly audits = new Map<string, DecisionAudit>();
  private readonly projections = new Map<string, Projection>();
  private readonly scopedProjections = new Map<string, Projection>();

  constructor(options: InMemoryKnowledgeOptions = {}) {
    for (const snapshot of options.snapshots ?? []) {
      this.snapshots.set(snapshot.snapshot_id, snapshot);
      this.latestByLeague.set(snapshot.league.league_id, snapshot.snapshot_id);
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
    if (snapshot.league.platform !== "fixture") {
      const conflict = [...this.snapshots.values()].find((existing) => existing.league.platform !== "fixture"
        && (existing.league.platform !== snapshot.league.platform || existing.league.external_id !== snapshot.league.external_id));
      if (conflict) {
        throw new PmtError({
          code: "MULTIPLE_LIVE_LEAGUES_UNSUPPORTED",
          message: `This store already contains live ${conflict.league.platform} league ${conflict.league.external_id}; refusing a second live league.`,
          source: "knowledge",
          retryable: false
        });
      }
    }
    this.snapshots.set(snapshot.snapshot_id, snapshot);
    this.latestByLeague.set(snapshot.league.league_id, snapshot.snapshot_id);
  }

  async getLatestLeagueSnapshot(leagueId?: string): Promise<LeagueSnapshot | undefined> {
    const snapshotId = leagueId
      ? this.latestByLeague.get(leagueId)
      : [...this.latestByLeague.values()].reverse().find((id) => this.snapshots.get(id)?.league.platform !== "fixture")
        ?? [...this.latestByLeague.values()].at(-1);
    return snapshotId ? this.getLeagueSnapshot(snapshotId) : undefined;
  }

  async getLeagueSnapshot(snapshotId: string): Promise<LeagueSnapshot | undefined> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return undefined;
    const season = snapshot.league.season;
    const stored = this.storedForSeason(season, snapshot.league.external_id);
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

  async upsertProjections(projections: Projection[], leagueExternalId?: string): Promise<void> {
    for (const p of projections) {
      if (leagueExternalId) this.scopedProjections.set(`${leagueExternalId}|${p.projection_id}`, p);
      else this.projections.set(p.projection_id, p);
    }
  }

  async getProjections(scoringPeriod: string, leagueExternalId?: string): Promise<Projection[]> {
    if (leagueExternalId) {
      const scoped = [...this.scopedProjections.entries()].filter(([key, p]) => key.startsWith(`${leagueExternalId}|`) && p.scoring_period === scoringPeriod).map(([, p]) => p);
      if (scoped.length || !this.canUseLegacyProjections(leagueExternalId)) return scoped;
      return Array.from(this.projections.values()).filter((p) => p.scoring_period === scoringPeriod);
    }
    return [...Array.from(this.projections.values()).filter((p) => p.scoring_period === scoringPeriod),
      ...Array.from(this.scopedProjections.values()).filter((p) => p.scoring_period === scoringPeriod)];
  }

  private storedForSeason(season: string, leagueExternalId: string): Projection[] {
    const scoped = [...this.scopedProjections.entries()].filter(([key, p]) => key.startsWith(`${leagueExternalId}|`) && p.scoring_period.startsWith(`${season}-`)).map(([, p]) => p);
    if (scoped.length || !this.canUseLegacyProjections(leagueExternalId)) return scoped;
    return Array.from(this.projections.values()).filter((p) => p.scoring_period.startsWith(`${season}-`));
  }

  private canUseLegacyProjections(leagueExternalId: string): boolean {
    const live = [...this.snapshots.values()].filter((snapshot) => snapshot.league.platform !== "fixture");
    const hasFixture = [...this.snapshots.values()].some((snapshot) => snapshot.league.platform === "fixture");
    return live.length <= 1 && (!hasFixture || live.length === 0)
      && (live.length === 0 || live[0]?.league.external_id === leagueExternalId);
  }
}

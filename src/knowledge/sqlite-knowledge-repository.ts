import Database from "better-sqlite3";
import { PmtError } from "../errors.js";
import type { DecisionAudit, LeagueSnapshot, Recommendation } from "../models/types.js";
import type { KnowledgeRepository } from "./repository.js";

export interface SqliteKnowledgeOptions {
  readonly filePath?: string;
  readonly memory?: boolean;
}

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  private readonly db: Database.Database;

  constructor(options: SqliteKnowledgeOptions = {}) {
    const filePath = options.memory ? ":memory:" : (options.filePath ?? ":memory:");
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  async saveLeagueSnapshot(snapshot: LeagueSnapshot): Promise<void> {
    const existing = this.db
      .prepare("SELECT snapshot_id FROM league_snapshots WHERE snapshot_id = ?")
      .get(snapshot.snapshot_id);
    if (existing) {
      throw new PmtError({
        code: "SNAPSHOT_ALREADY_EXISTS",
        message: `League snapshot ${snapshot.snapshot_id} already exists and is immutable.`,
        source: "knowledge",
        retryable: false
      });
    }
    this.db
      .prepare(
        "INSERT INTO league_snapshots (snapshot_id, league_id, data, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        snapshot.snapshot_id,
        snapshot.league.league_id,
        JSON.stringify(snapshot),
        new Date().toISOString()
      );
  }

  async getLeagueSnapshot(snapshotId: string): Promise<LeagueSnapshot | undefined> {
    const row = this.db
      .prepare("SELECT data FROM league_snapshots WHERE snapshot_id = ?")
      .get(snapshotId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as LeagueSnapshot) : undefined;
  }

  async saveRecommendation(recommendation: Recommendation): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO recommendations (recommendation_id, league_id, team_id, type, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(recommendation_id) DO UPDATE SET data = excluded.data, updated_at = excluded.created_at`
      )
      .run(
        recommendation.recommendation_id,
        recommendation.league_id,
        recommendation.team_id,
        recommendation.type,
        JSON.stringify(recommendation),
        new Date().toISOString()
      );
  }

  async getRecommendation(recommendationId: string): Promise<Recommendation | undefined> {
    const row = this.db
      .prepare("SELECT data FROM recommendations WHERE recommendation_id = ?")
      .get(recommendationId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Recommendation) : undefined;
  }

  async saveDecisionAudit(audit: DecisionAudit): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO decision_audits (audit_id, recommendation_id, data, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        audit.audit_id,
        audit.recommendation_id,
        JSON.stringify(audit),
        new Date().toISOString()
      );
  }

  async getDecisionAudit(auditId: string): Promise<DecisionAudit | undefined> {
    const row = this.db
      .prepare("SELECT data FROM decision_audits WHERE audit_id = ?")
      .get(auditId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as DecisionAudit) : undefined;
  }

  async listRecommendations(leagueId: string): Promise<Recommendation[]> {
    const rows = this.db
      .prepare("SELECT data FROM recommendations WHERE league_id = ? ORDER BY created_at DESC")
      .all(leagueId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Recommendation);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS league_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendations (
        recommendation_id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS decision_audits (
        audit_id TEXT PRIMARY KEY,
        recommendation_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recommendations_league ON recommendations(league_id);
    `);
  }
}

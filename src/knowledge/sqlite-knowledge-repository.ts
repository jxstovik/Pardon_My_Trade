import Database from "better-sqlite3";
import { PmtError } from "../errors.js";
import type { DecisionAudit, LeagueSnapshot, Projection, Recommendation } from "../models/types.js";
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
    if (!row) return undefined;
    const snapshot = JSON.parse(row.data) as LeagueSnapshot;

    // Attach the latest stored projections for this league's season so the
    // snapshot reflects fresh pulls without mutating the immutable snapshot row.
    const season = snapshot.league.season;
    const stored = await this.getProjectionsBySeason(season, snapshot.league.league_id);
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

  async upsertProjections(projections: Projection[], leagueId?: string): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO projections (projection_id, player_id, source, scoring_period, league_id, data, created_at, updated_at)
       VALUES (@projection_id, @player_id, @source, @scoring_period, @league_id, @data, @ts, @ts)
       ON CONFLICT(league_id, projection_id) DO UPDATE SET
         player_id = excluded.player_id,
         source = excluded.source,
         scoring_period = excluded.scoring_period,
         league_id = excluded.league_id,
         data = excluded.data,
         updated_at = excluded.updated_at`
    );
    const ts = new Date().toISOString();
    const tx = this.db.transaction((items: Projection[]) => {
      for (const p of items) {
        stmt.run({
          projection_id: p.projection_id,
          player_id: p.player_id,
          source: p.source,
          scoring_period: p.scoring_period,
          league_id: leagueId ?? "",
          data: JSON.stringify(p),
          ts
        });
      }
    });
    tx(projections);
  }

  async getProjections(scoringPeriod: string, leagueId?: string): Promise<Projection[]> {
    const rows = (leagueId === undefined
      ? this.db.prepare("SELECT data FROM projections WHERE scoring_period = ?").all(scoringPeriod)
      : this.db.prepare("SELECT data FROM projections WHERE scoring_period = ? AND league_id = ?").all(scoringPeriod, leagueId)) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Projection);
  }

  private async getProjectionsBySeason(season: string, leagueId: string): Promise<Projection[]> {
    const rows = this.db
      .prepare("SELECT data FROM projections WHERE scoring_period LIKE ? AND (league_id = ? OR league_id = '')")
      .all(`${season}-%`, leagueId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Projection);
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
      CREATE TABLE IF NOT EXISTS projections (
        projection_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        source TEXT NOT NULL,
        scoring_period TEXT NOT NULL,
        league_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (league_id, projection_id)
      );
      CREATE INDEX IF NOT EXISTS idx_projections_period ON projections(scoring_period);
      CREATE INDEX IF NOT EXISTS idx_projections_player ON projections(player_id);
    `);
    const primaryKey = this.db.prepare("PRAGMA table_info(projections)").all() as Array<{ pk: number }>;
    if (primaryKey.filter((column) => column.pk > 0).length === 1) {
      this.db.exec(`
        CREATE TABLE projections_scoped (
          projection_id TEXT NOT NULL, player_id TEXT NOT NULL, source TEXT NOT NULL,
          scoring_period TEXT NOT NULL, league_id TEXT NOT NULL, data TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT, PRIMARY KEY (league_id, projection_id)
        );
        INSERT INTO projections_scoped SELECT projection_id, player_id, source, scoring_period, league_id, data, created_at, updated_at FROM projections;
        DROP TABLE projections;
        ALTER TABLE projections_scoped RENAME TO projections;
        CREATE INDEX IF NOT EXISTS idx_projections_period ON projections(scoring_period);
        CREATE INDEX IF NOT EXISTS idx_projections_player ON projections(player_id);
      `);
    }
  }
}

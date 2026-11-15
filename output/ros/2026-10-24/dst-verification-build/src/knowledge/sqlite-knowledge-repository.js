import Database from "better-sqlite3";
import { PmtError } from "../errors.js";
import { configureReliabilityDatabase } from "../storage/sqlite-reliability.js";
export class SqliteKnowledgeRepository {
    db;
    constructor(options = {}) {
        const filePath = options.memory ? ":memory:" : (options.filePath ?? ":memory:");
        this.db = new Database(filePath);
        configureReliabilityDatabase(this.db);
        this.migrate();
    }
    async saveLeagueSnapshot(snapshot) {
        const now = new Date().toISOString();
        const incomingExternalId = snapshot.league.external_id;
        if (snapshot.league.platform !== "fixture") {
            const existingLive = this.db.prepare("SELECT data FROM league_snapshots").all();
            for (const row of existingLive) {
                const existing = JSON.parse(row.data);
                if (existing.league.platform !== "fixture"
                    && (existing.league.platform !== snapshot.league.platform || existing.league.external_id !== incomingExternalId)) {
                    throw new PmtError({
                        code: "MULTIPLE_LIVE_LEAGUES_UNSUPPORTED",
                        message: `This SQLite store already contains live ${existing.league.platform} league ${existing.league.external_id}; refusing to add ${snapshot.league.platform} league ${incomingExternalId} to the same runtime database.`,
                        source: "knowledge",
                        retryable: false
                    });
                }
            }
        }
        try {
            this.db.transaction(() => {
                this.db.prepare("INSERT INTO league_snapshots (snapshot_id, league_id, data, created_at) VALUES (?, ?, ?, ?)").run(snapshot.snapshot_id, snapshot.league.league_id, JSON.stringify(snapshot), now);
                const liveExists = snapshot.league.platform === "fixture"
                    && this.db.prepare(`SELECT 1 FROM league_snapshots WHERE json_extract(data, '$.league.platform') <> 'fixture' LIMIT 1`).get();
                if (!liveExists)
                    this.db.prepare(`
            INSERT INTO latest_snapshots(league_id,snapshot_id,updated_at) VALUES(?,?,?)
            ON CONFLICT(league_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,updated_at=excluded.updated_at
          `).run(snapshot.league.league_id, snapshot.snapshot_id, now);
            })();
        }
        catch (error) {
            if (error instanceof Error && /unique|primary key/i.test(error.message)) {
                throw new PmtError({
                    code: "SNAPSHOT_ALREADY_EXISTS",
                    message: `League snapshot ${snapshot.snapshot_id} already exists and is immutable.`,
                    source: "knowledge",
                    retryable: false
                });
            }
            throw error;
        }
    }
    async getLatestLeagueSnapshot(leagueId) {
        const row = leagueId
            ? this.db.prepare("SELECT snapshot_id FROM latest_snapshots WHERE league_id = ?").get(leagueId)
            : this.db.prepare(`SELECT latest.snapshot_id FROM latest_snapshots AS latest
          JOIN league_snapshots AS snapshot ON snapshot.snapshot_id=latest.snapshot_id
          ORDER BY CASE WHEN json_extract(snapshot.data, '$.league.platform')='fixture' THEN 1 ELSE 0 END,
            latest.updated_at DESC LIMIT 1`).get();
        return row ? this.getLeagueSnapshot(row.snapshot_id) : undefined;
    }
    async getLeagueSnapshot(snapshotId) {
        const row = this.db
            .prepare("SELECT data FROM league_snapshots WHERE snapshot_id = ?")
            .get(snapshotId);
        if (!row)
            return undefined;
        const snapshot = JSON.parse(row.data);
        // Attach the latest stored projections for this league's season so the
        // snapshot reflects fresh pulls without mutating the immutable snapshot row.
        const season = snapshot.league.season;
        const stored = await this.getProjectionsBySeason(season, snapshot.league.external_id);
        if (stored.length > 0) {
            const merged = [...snapshot.projections];
            for (const p of stored) {
                const key = `${p.player_id}|${p.source}|${p.scoring_period}`;
                const idx = merged.findIndex((x) => `${x.player_id}|${x.source}|${x.scoring_period}` === key);
                if (idx >= 0)
                    merged[idx] = p;
                else
                    merged.push(p);
            }
            return { ...snapshot, projections: merged };
        }
        return snapshot;
    }
    async saveRecommendation(recommendation) {
        this.db
            .prepare(`INSERT INTO recommendations (recommendation_id, league_id, team_id, type, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(recommendation_id) DO UPDATE SET data = excluded.data, updated_at = excluded.created_at`)
            .run(recommendation.recommendation_id, recommendation.league_id, recommendation.team_id, recommendation.type, JSON.stringify(recommendation), new Date().toISOString());
    }
    async getRecommendation(recommendationId) {
        const row = this.db
            .prepare("SELECT data FROM recommendations WHERE recommendation_id = ?")
            .get(recommendationId);
        return row ? JSON.parse(row.data) : undefined;
    }
    async saveDecisionAudit(audit) {
        this.db
            .prepare("INSERT INTO decision_audits (audit_id, recommendation_id, data, created_at) VALUES (?, ?, ?, ?)")
            .run(audit.audit_id, audit.recommendation_id, JSON.stringify(audit), new Date().toISOString());
    }
    async getDecisionAudit(auditId) {
        const row = this.db
            .prepare("SELECT data FROM decision_audits WHERE audit_id = ?")
            .get(auditId);
        return row ? JSON.parse(row.data) : undefined;
    }
    async listRecommendations(leagueId) {
        const rows = this.db
            .prepare("SELECT data FROM recommendations WHERE league_id = ? ORDER BY created_at DESC")
            .all(leagueId);
        return rows.map((row) => JSON.parse(row.data));
    }
    async upsertProjections(projections, leagueExternalId) {
        if (leagueExternalId) {
            const stmt = this.db.prepare(`INSERT INTO scoped_projections
        (scoped_projection_id,projection_id,league_external_id,scoring_period,data,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(scoped_projection_id) DO UPDATE SET
          data=excluded.data,updated_at=excluded.updated_at`);
            const ts = new Date().toISOString();
            const tx = this.db.transaction((items) => {
                for (const projection of items)
                    stmt.run(`${leagueExternalId}|${projection.projection_id}`, projection.projection_id, leagueExternalId, projection.scoring_period, JSON.stringify(projection), ts);
            });
            tx(projections);
            return;
        }
        const stmt = this.db.prepare(`INSERT INTO projections (projection_id, player_id, source, scoring_period, league_id, data, created_at, updated_at)
       VALUES (@projection_id, @player_id, @source, @scoring_period, @league_id, @data, @ts, @ts)
       ON CONFLICT(projection_id) DO UPDATE SET
         player_id = excluded.player_id,
         source = excluded.source,
         scoring_period = excluded.scoring_period,
         league_id = excluded.league_id,
         data = excluded.data,
         updated_at = excluded.updated_at`);
        const ts = new Date().toISOString();
        const tx = this.db.transaction((items) => {
            for (const p of items) {
                stmt.run({
                    projection_id: p.projection_id,
                    player_id: p.player_id,
                    source: p.source,
                    scoring_period: p.scoring_period,
                    league_id: "",
                    data: JSON.stringify(p),
                    ts
                });
            }
        });
        tx(projections);
    }
    async getProjections(scoringPeriod, leagueExternalId) {
        if (leagueExternalId) {
            const scoped = this.db.prepare("SELECT data FROM scoped_projections WHERE league_external_id=? AND scoring_period=?")
                .all(leagueExternalId, scoringPeriod);
            if (scoped.length || !this.canUseLegacyProjections(leagueExternalId)) {
                return scoped.map((row) => JSON.parse(row.data));
            }
        }
        const rows = this.db
            .prepare("SELECT data FROM projections WHERE scoring_period = ?")
            .all(scoringPeriod);
        const legacy = rows.map((row) => JSON.parse(row.data));
        if (leagueExternalId)
            return legacy;
        const scoped = this.db.prepare("SELECT data FROM scoped_projections WHERE scoring_period=?").all(scoringPeriod);
        return [...legacy, ...scoped.map((row) => JSON.parse(row.data))];
    }
    async getProjectionsBySeason(season, leagueExternalId) {
        const period = `${season}-%`;
        const scoped = this.db.prepare("SELECT data FROM scoped_projections WHERE league_external_id=? AND scoring_period LIKE ?")
            .all(leagueExternalId, period);
        if (scoped.length || !this.canUseLegacyProjections(leagueExternalId)) {
            return scoped.map((row) => JSON.parse(row.data));
        }
        const rows = this.db.prepare("SELECT data FROM projections WHERE scoring_period LIKE ?").all(period);
        return rows.map((row) => JSON.parse(row.data));
    }
    canUseLegacyProjections(leagueExternalId) {
        const liveIds = this.db.prepare(`SELECT DISTINCT json_extract(data,'$.league.external_id') AS external_id
      FROM league_snapshots WHERE json_extract(data,'$.league.platform') <> 'fixture'`).all();
        const hasFixture = this.db.prepare("SELECT 1 FROM league_snapshots WHERE json_extract(data,'$.league.platform')='fixture' LIMIT 1").get();
        return liveIds.length <= 1 && (!hasFixture || liveIds.length === 0) && (liveIds.length === 0 || liveIds[0]?.external_id === leagueExternalId);
    }
    close() {
        this.db.close();
    }
    migrate() {
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
        projection_id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        source TEXT NOT NULL,
        scoring_period TEXT NOT NULL,
        league_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_projections_period ON projections(scoring_period);
      CREATE INDEX IF NOT EXISTS idx_projections_player ON projections(player_id);
    `);
    }
}

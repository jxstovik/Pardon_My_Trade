import Database from "better-sqlite3";

/** Configure SQLite for the single-host, multi-process PMT deployment. */
export function configureReliabilityDatabase(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmt_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      action_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_actions_status_created ON actions(status, created_at);
    CREATE TABLE IF NOT EXISTS action_receipts (
      action_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      audit_id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_events(action_id, recorded_at);
    CREATE TABLE IF NOT EXISTS job_runs (
      job_id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      dedupe_key TEXT,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      result TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_type, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_claim ON job_runs(status, available_at, lease_expires_at);
    CREATE TABLE IF NOT EXISTS latest_snapshots (
      league_id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES league_snapshots(snapshot_id)
    );
    CREATE TABLE IF NOT EXISTS scoped_projections (
      scoped_projection_id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      league_external_id TEXT NOT NULL,
      scoring_period TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_projections_league_period
      ON scoped_projections(league_external_id, scoring_period);
  `);
  const jobColumns = db.prepare("PRAGMA table_info(job_runs)").all() as Array<{ name: string }>;
  if (!jobColumns.some((column) => column.name === "result")) db.exec("ALTER TABLE job_runs ADD COLUMN result TEXT");
  db.prepare("INSERT OR IGNORE INTO pmt_schema_migrations(version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
}

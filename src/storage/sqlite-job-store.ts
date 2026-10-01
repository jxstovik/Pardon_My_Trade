import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { configureReliabilityDatabase } from "./sqlite-reliability.js";

export type DurableJobStatus = "queued" | "running" | "succeeded" | "failed";
export interface DurableJob<T = unknown> {
  readonly jobId: string;
  readonly type: string;
  readonly dedupeKey?: string;
  readonly status: DurableJobStatus;
  readonly payload: T;
  readonly result?: unknown;
  readonly attempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly lastError?: string;
}

/** Durable SQLite job queue with atomic multi-process claims and expiring leases. */
export class SqliteJobStore {
  private readonly db: Database.Database;
  private readonly ownsDatabase: boolean;
  constructor(options: { readonly filePath?: string; readonly database?: Database.Database } = {}) {
    this.ownsDatabase = !options.database;
    this.db = options.database ?? new Database(options.filePath ?? ":memory:");
    configureReliabilityDatabase(this.db);
  }

  enqueue<T>(type: string, payload: T, options: { jobId?: string; dedupeKey?: string; availableAt?: Date } = {}): DurableJob<T> {
    const now = new Date().toISOString();
    const jobId = options.jobId ?? `job-${randomUUID()}`;
    const availableAt = (options.availableAt ?? new Date()).toISOString();
    this.db.prepare(`
      INSERT INTO job_runs(job_id,job_type,dedupe_key,status,available_at,attempts,data,created_at,updated_at)
      VALUES(?,?,?,'queued',?,0,?,?,?)
      ON CONFLICT(job_type,dedupe_key) DO NOTHING
    `).run(jobId, type, options.dedupeKey ?? null, availableAt, JSON.stringify(payload), now, now);
    const row = options.dedupeKey
      ? this.db.prepare("SELECT * FROM job_runs WHERE job_type=? AND dedupe_key=?").get(type, options.dedupeKey) as JobRow
      : this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(jobId) as JobRow;
    return fromRow<T>(row);
  }

  claimNext<T = unknown>(workerId: string, options: { leaseMs?: number; now?: Date } = {}): DurableJob<T> | undefined {
    return this.claim(undefined, workerId, options);
  }

  claimJob<T = unknown>(jobId: string, workerId: string, options: { leaseMs?: number; now?: Date } = {}): DurableJob<T> | undefined {
    return this.claim(jobId, workerId, options);
  }

  private claim<T>(jobId: string | undefined, workerId: string, options: { leaseMs?: number; now?: Date }): DurableJob<T> | undefined {
    if (!workerId.trim()) throw new Error("A job lease owner is required.");
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const expires = new Date(now.getTime() + (options.leaseMs ?? 60_000)).toISOString();
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM job_runs
        WHERE (? IS NULL OR job_id=?)
          AND ((status='queued' AND available_at<=?)
           OR (status='running' AND lease_expires_at<=?))
        ORDER BY available_at, created_at LIMIT 1
      `).get(jobId ?? null, jobId ?? null, nowIso, nowIso) as JobRow | undefined;
      if (!row) return undefined;
      const result = this.db.prepare(`
        UPDATE job_runs SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
        WHERE job_id=? AND ((status='queued' AND available_at<=?) OR (status='running' AND lease_expires_at<=?))
      `).run(workerId, expires, nowIso, row.job_id, nowIso, nowIso);
      if (result.changes !== 1) return undefined;
      const claimed = this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(row.job_id) as JobRow;
      return fromRow<T>(claimed);
    })();
  }

  complete(jobId: string, workerId: string, resultValue?: unknown, now = new Date()): boolean {
    const result = this.db.prepare(`UPDATE job_runs SET status='succeeded',result=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE job_id=? AND status='running' AND lease_owner=?`).run(resultValue === undefined ? null : JSON.stringify(resultValue), now.toISOString(), jobId, workerId);
    return result.changes === 1;
  }

  fail(jobId: string, workerId: string, error: unknown, options: { retryAt?: Date; now?: Date } = {}): boolean {
    const now = options.now ?? new Date();
    const row = this.db.prepare("SELECT attempts FROM job_runs WHERE job_id=? AND status='running' AND lease_owner=?")
      .get(jobId, workerId) as { attempts: number } | undefined;
    if (!row) return false;
    const status: DurableJobStatus = options.retryAt && row.attempts < 5 ? "queued" : "failed";
    const result = this.db.prepare(`UPDATE job_runs SET status=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=?
      WHERE job_id=? AND status='running' AND lease_owner=?`).run(status, (options.retryAt ?? now).toISOString(),
      error instanceof Error ? error.message : String(error), now.toISOString(), jobId, workerId);
    return result.changes === 1;
  }

  get<T = unknown>(jobId: string): DurableJob<T> | undefined {
    const row = this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(jobId) as JobRow | undefined;
    return row ? fromRow<T>(row) : undefined;
  }

  list<T = unknown>(status?: DurableJobStatus): DurableJob<T>[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM job_runs WHERE status=? ORDER BY created_at").all(status)
      : this.db.prepare("SELECT * FROM job_runs ORDER BY created_at").all()) as JobRow[];
    return rows.map(fromRow<T>);
  }

  close(): void { if (this.ownsDatabase) this.db.close(); }
}

interface JobRow {
  job_id: string; job_type: string; dedupe_key: string | null; status: DurableJobStatus;
  available_at: string; lease_owner: string | null; lease_expires_at: string | null;
  attempts: number; data: string; last_error: string | null;
  result: string | null;
}
function fromRow<T>(row: JobRow): DurableJob<T> {
  return { jobId: row.job_id, type: row.job_type, dedupeKey: row.dedupe_key ?? undefined,
    status: row.status, payload: JSON.parse(row.data) as T, result: row.result ? JSON.parse(row.result) as unknown : undefined, attempts: row.attempts,
    availableAt: row.available_at, leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined, lastError: row.last_error ?? undefined };
}

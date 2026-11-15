import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { configureReliabilityDatabase } from "./sqlite-reliability.js";
/** Durable SQLite job queue with atomic multi-process claims and expiring leases. */
export class SqliteJobStore {
    db;
    ownsDatabase;
    constructor(options = {}) {
        this.ownsDatabase = !options.database;
        this.db = options.database ?? new Database(options.filePath ?? ":memory:");
        configureReliabilityDatabase(this.db);
    }
    enqueue(type, payload, options = {}) {
        const now = new Date().toISOString();
        const jobId = options.jobId ?? `job-${randomUUID()}`;
        const availableAt = (options.availableAt ?? new Date()).toISOString();
        this.db.prepare(`
      INSERT INTO job_runs(job_id,job_type,dedupe_key,status,available_at,attempts,data,created_at,updated_at)
      VALUES(?,?,?,'queued',?,0,?,?,?)
      ON CONFLICT(job_type,dedupe_key) DO NOTHING
    `).run(jobId, type, options.dedupeKey ?? null, availableAt, JSON.stringify(payload), now, now);
        const row = options.dedupeKey
            ? this.db.prepare("SELECT * FROM job_runs WHERE job_type=? AND dedupe_key=?").get(type, options.dedupeKey)
            : this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(jobId);
        return fromRow(row);
    }
    claimNext(workerId, options = {}) {
        return this.claim(undefined, workerId, options);
    }
    claimJob(jobId, workerId, options = {}) {
        return this.claim(jobId, workerId, options);
    }
    claim(jobId, workerId, options) {
        if (!workerId.trim())
            throw new Error("A job lease owner is required.");
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
      `).get(jobId ?? null, jobId ?? null, nowIso, nowIso);
            if (!row)
                return undefined;
            const result = this.db.prepare(`
        UPDATE job_runs SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
        WHERE job_id=? AND ((status='queued' AND available_at<=?) OR (status='running' AND lease_expires_at<=?))
      `).run(workerId, expires, nowIso, row.job_id, nowIso, nowIso);
            if (result.changes !== 1)
                return undefined;
            const claimed = this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(row.job_id);
            return fromRow(claimed);
        })();
    }
    complete(jobId, workerId, resultValue, now = new Date()) {
        const result = this.db.prepare(`UPDATE job_runs SET status='succeeded',result=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE job_id=? AND status='running' AND lease_owner=?`).run(resultValue === undefined ? null : JSON.stringify(resultValue), now.toISOString(), jobId, workerId);
        return result.changes === 1;
    }
    fail(jobId, workerId, error, options = {}) {
        const now = options.now ?? new Date();
        const row = this.db.prepare("SELECT attempts FROM job_runs WHERE job_id=? AND status='running' AND lease_owner=?")
            .get(jobId, workerId);
        if (!row)
            return false;
        const status = options.retryAt && row.attempts < 5 ? "queued" : "failed";
        const result = this.db.prepare(`UPDATE job_runs SET status=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=?
      WHERE job_id=? AND status='running' AND lease_owner=?`).run(status, (options.retryAt ?? now).toISOString(), error instanceof Error ? error.message : String(error), now.toISOString(), jobId, workerId);
        return result.changes === 1;
    }
    get(jobId) {
        const row = this.db.prepare("SELECT * FROM job_runs WHERE job_id=?").get(jobId);
        return row ? fromRow(row) : undefined;
    }
    list(status) {
        const rows = (status
            ? this.db.prepare("SELECT * FROM job_runs WHERE status=? ORDER BY created_at").all(status)
            : this.db.prepare("SELECT * FROM job_runs ORDER BY created_at").all());
        return rows.map((fromRow));
    }
    close() { if (this.ownsDatabase)
        this.db.close(); }
}
function fromRow(row) {
    return { jobId: row.job_id, type: row.job_type, dedupeKey: row.dedupe_key ?? undefined,
        status: row.status, payload: JSON.parse(row.data), result: row.result ? JSON.parse(row.result) : undefined, attempts: row.attempts,
        availableAt: row.available_at, leaseOwner: row.lease_owner ?? undefined,
        leaseExpiresAt: row.lease_expires_at ?? undefined, lastError: row.last_error ?? undefined };
}

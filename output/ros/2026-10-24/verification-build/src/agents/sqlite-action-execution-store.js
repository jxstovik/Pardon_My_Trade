import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { configureReliabilityDatabase } from "../storage/sqlite-reliability.js";
/** SQL receipts and audit records; receipt reservation is an atomic execution gate. */
export class SqliteActionExecutionStore {
    db;
    ownsDatabase;
    constructor(options = {}) {
        const normalized = typeof options === "string" ? { filePath: options } : options;
        this.ownsDatabase = !normalized.database;
        this.db = normalized.database ?? new Database(normalized.filePath ?? ":memory:");
        configureReliabilityDatabase(this.db);
        this.importLegacy(normalized.legacyFilePath ?? (normalized.filePath ? join(dirname(normalized.filePath), "action-execution.json") : undefined));
    }
    async getReceipt(actionId) {
        const row = this.db.prepare("SELECT data FROM action_receipts WHERE action_id = ?").get(actionId);
        return row ? JSON.parse(row.data) : undefined;
    }
    async getReceiptByIdempotencyKey(idempotencyKey) {
        const row = this.db.prepare("SELECT data FROM action_receipts WHERE idempotency_key = ?").get(idempotencyKey);
        return row ? JSON.parse(row.data) : undefined;
    }
    async reserveReceipt(receipt) {
        const now = new Date().toISOString();
        try {
            const result = this.db.prepare(`
        INSERT INTO action_receipts(action_id,receipt_id,idempotency_key,payload_hash,status,data,recorded_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT DO NOTHING
      `).run(receipt.actionId, receipt.receiptId, receipt.idempotencyKey, receipt.payloadHash, receipt.status, JSON.stringify(receipt), receipt.recordedAt, now);
            return result.changes === 1;
        }
        catch (error) {
            if (isConstraintError(error))
                return false;
            throw error;
        }
    }
    async saveReceipt(receipt) {
        const existing = await this.getReceipt(receipt.actionId);
        if (!existing) {
            const inserted = await this.reserveReceipt(receipt);
            if (!inserted) {
                const keyCollision = await this.getReceiptByIdempotencyKey(receipt.idempotencyKey);
                if (keyCollision && (keyCollision.payloadHash !== receipt.payloadHash || keyCollision.actionId !== receipt.actionId)) {
                    throw new Error(`Idempotency key ${receipt.idempotencyKey} is already bound to another action or payload.`);
                }
                throw new Error(`Receipt ${receipt.actionId} was concurrently reserved.`);
            }
            return;
        }
        if (existing.idempotencyKey !== receipt.idempotencyKey || existing.payloadHash !== receipt.payloadHash) {
            throw new Error(`Receipt ${receipt.actionId} cannot change its idempotency key or payload hash.`);
        }
        this.db.prepare(`
      UPDATE action_receipts SET status = ?, data = ?, updated_at = ? WHERE action_id = ?
    `).run(receipt.status, JSON.stringify(receipt), new Date().toISOString(), receipt.actionId);
    }
    async appendAudit(record) {
        this.db.prepare("INSERT OR IGNORE INTO audit_events(audit_id,action_id,recorded_at,data) VALUES(?,?,?,?)")
            .run(record.auditId, record.actionId, record.recordedAt, JSON.stringify(record));
    }
    async listReceipts() {
        const rows = this.db.prepare("SELECT data FROM action_receipts ORDER BY recorded_at, action_id").all();
        return rows.map((row) => JSON.parse(row.data));
    }
    async listAudit() {
        const rows = this.db.prepare("SELECT data FROM audit_events ORDER BY recorded_at, audit_id").all();
        return rows.map((row) => JSON.parse(row.data));
    }
    close() {
        if (this.ownsDatabase)
            this.db.close();
    }
    importLegacy(filePath) {
        if (!filePath || !existsSync(filePath))
            return;
        try {
            const parsed = JSON.parse(readFileSync(filePath, "utf8"));
            const tx = this.db.transaction(() => {
                for (const receipt of parsed.receipts ?? []) {
                    const existing = this.db.prepare("SELECT data FROM action_receipts WHERE action_id=? OR idempotency_key=? LIMIT 1")
                        .get(receipt.actionId, receipt.idempotencyKey);
                    if (existing) {
                        const stored = JSON.parse(existing.data);
                        if (stored.actionId !== receipt.actionId || stored.payloadHash !== receipt.payloadHash || stored.idempotencyKey !== receipt.idempotencyKey) {
                            throw new Error(`legacy receipt ${receipt.actionId} conflicts with the SQL record`);
                        }
                        continue;
                    }
                    this.db.prepare(`INSERT OR IGNORE INTO action_receipts(action_id,receipt_id,idempotency_key,payload_hash,status,data,recorded_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(receipt.actionId, receipt.receiptId, receipt.idempotencyKey, receipt.payloadHash, receipt.status, JSON.stringify(receipt), receipt.recordedAt, receipt.completedAt ?? receipt.recordedAt);
                }
                for (const record of parsed.audit ?? []) {
                    this.db.prepare("INSERT OR IGNORE INTO audit_events(audit_id,action_id,recorded_at,data) VALUES(?,?,?,?)")
                        .run(record.auditId, record.actionId, record.recordedAt, JSON.stringify(record));
                }
            });
            tx();
        }
        catch (error) {
            throw new Error(`Could not migrate legacy action receipts ${basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
function isConstraintError(error) {
    return error instanceof Error && /constraint|unique/i.test(error.message);
}

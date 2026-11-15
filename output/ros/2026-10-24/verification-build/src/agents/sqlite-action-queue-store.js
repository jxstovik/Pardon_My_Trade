import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { normalizeQueuedAction } from "./action-queue.js";
import { configureReliabilityDatabase } from "../storage/sqlite-reliability.js";
/** Transactional queue storage shared by CLI, MCP, API, and executor processes. */
export class SqliteActionQueueStore {
    db;
    ownsDatabase;
    constructor(options = {}) {
        const normalized = typeof options === "string" ? { filePath: options } : options;
        this.ownsDatabase = !normalized.database;
        this.db = normalized.database ?? new Database(normalized.filePath ?? ":memory:");
        configureReliabilityDatabase(this.db);
        this.importLegacy(normalized.legacyFilePath ?? (normalized.filePath ? join(dirname(normalized.filePath), "action-queue.json") : undefined));
    }
    async list() {
        const rows = this.db.prepare("SELECT data FROM actions ORDER BY created_at, action_id").all();
        return rows.map((row) => normalizeQueuedAction(JSON.parse(row.data)));
    }
    async get(actionId) {
        const row = this.db.prepare("SELECT data FROM actions WHERE action_id = ?").get(actionId);
        return row ? normalizeQueuedAction(JSON.parse(row.data)) : undefined;
    }
    async save(action) {
        const normalized = normalizeQueuedAction(action);
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO actions(action_id, status, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(action_id) DO UPDATE SET
        status = excluded.status, data = excluded.data, updated_at = excluded.updated_at
    `).run(normalized.actionId, normalized.status, JSON.stringify(normalized), normalized.createdAt, now);
    }
    async enqueueIfAbsent(action) {
        const normalized = normalizeQueuedAction(action);
        const now = new Date().toISOString();
        return this.db.transaction(() => {
            const existing = this.db.prepare(`
        SELECT data FROM actions
        WHERE status IN ('pending','approved')
          AND json_extract(data,'$.payloadHash') = ?
          AND COALESCE(json_extract(data,'$.preconditions.leagueExternalId'),'') = ?
          AND COALESCE(json_extract(data,'$.preconditions.scoringPeriod'),'') = ?
          AND json_extract(data,'$.expiresAt') > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(normalized.payloadHash, normalized.preconditions?.leagueExternalId ?? "", normalized.preconditions?.scoringPeriod ?? "", now);
            if (existing)
                return normalizeQueuedAction(JSON.parse(existing.data));
            this.db.prepare("INSERT INTO actions(action_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?)")
                .run(normalized.actionId, normalized.status, JSON.stringify(normalized), normalized.createdAt, now);
            return normalized;
        })();
    }
    async compareAndSwap(actionId, expectedStatus, action) {
        const normalized = normalizeQueuedAction(action);
        const result = this.db.prepare(`
      UPDATE actions SET status = ?, data = ?, updated_at = ?
      WHERE action_id = ? AND status = ?
    `).run(normalized.status, JSON.stringify(normalized), new Date().toISOString(), actionId, expectedStatus);
        return result.changes === 1;
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
            const insert = this.db.prepare("INSERT OR IGNORE INTO actions(action_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?)");
            const tx = this.db.transaction((actions) => {
                for (const raw of actions) {
                    const action = normalizeQueuedAction(raw);
                    const existing = this.db.prepare("SELECT data FROM actions WHERE action_id=?").get(action.actionId);
                    if (existing) {
                        const stored = normalizeQueuedAction(JSON.parse(existing.data));
                        if (stored.payloadHash !== action.payloadHash)
                            throw new Error(`legacy action ${action.actionId} conflicts with the SQL record`);
                        continue;
                    }
                    insert.run(action.actionId, action.status, JSON.stringify(action), action.createdAt, new Date().toISOString());
                }
            });
            tx(parsed.actions ?? []);
        }
        catch (error) {
            throw new Error(`Could not migrate legacy action queue ${basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** Serialize JSON values without allowing object insertion order to affect hashes. */
export function canonicalJson(value) {
    const normalized = canonicalize(value);
    return JSON.stringify(normalized) ?? "null";
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map((item) => canonicalize(item));
    if (typeof value !== "object" || value === null)
        return value;
    const record = value;
    return Object.fromEntries(Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]));
}
export function actionPayloadHash(action) {
    return createHash("sha256").update(canonicalJson(action), "utf8").digest("hex");
}
export function buildIdempotencyKey(actionId, payloadHash) {
    return `pmt-action:${actionId}:${payloadHash}`;
}
export function normalizeQueuedAction(action) {
    const payloadHash = action.payloadHash ?? actionPayloadHash(action.action);
    return {
        ...action,
        payloadHash,
        idempotencyKey: action.idempotencyKey ?? buildIdempotencyKey(action.actionId, payloadHash)
    };
}
export class InMemoryActionQueueStore {
    items = new Map();
    async list() {
        return [...this.items.values()];
    }
    async get(actionId) {
        return this.items.get(actionId);
    }
    async save(action) {
        this.items.set(action.actionId, action);
    }
    async compareAndSwap(actionId, expectedStatus, action) {
        const current = this.items.get(actionId);
        if (!current || current.status !== expectedStatus)
            return false;
        this.items.set(actionId, action);
        return true;
    }
}
export class JsonActionQueueStore {
    filePath;
    cache = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        if (this.cache)
            return this.cache;
        const map = new Map();
        try {
            const raw = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            for (const action of parsed.actions ?? [])
                map.set(action.actionId, normalizeQueuedAction(action));
        }
        catch {
            // No persisted queue yet.
        }
        this.cache = map;
        return map;
    }
    async list() {
        return [...(await this.load()).values()];
    }
    async get(actionId) {
        return (await this.load()).get(actionId);
    }
    async save(action) {
        const map = await this.load();
        map.set(action.actionId, action);
        const payload = {
            schema_version: "1.0.0",
            saved_at: new Date().toISOString(),
            actions: [...map.values()]
        };
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
        this.cache = map;
    }
}
export class ActionQueue {
    store;
    constructor(store) {
        this.store = store;
    }
    async enqueue(action, risk, rationale, ttlMsOrOptions = DEFAULT_TTL_MS, options = {}) {
        const enqueueOptions = typeof ttlMsOrOptions === "number"
            ? options
            : ttlMsOrOptions;
        const ttlMs = typeof ttlMsOrOptions === "number"
            ? ttlMsOrOptions
            : enqueueOptions.ttlMs ?? DEFAULT_TTL_MS;
        const now = new Date();
        const actionId = `act-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
        const payloadHash = actionPayloadHash(action);
        const queued = {
            actionId,
            action,
            risk,
            rationale,
            status: "pending",
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
            payloadHash,
            idempotencyKey: enqueueOptions.idempotencyKey ?? buildIdempotencyKey(actionId, payloadHash),
            preconditions: enqueueOptions.preconditions
        };
        if (this.store.enqueueIfAbsent)
            return this.store.enqueueIfAbsent(queued);
        await this.store.save(queued);
        return queued;
    }
    async list() {
        return (await this.store.list()).map(normalizeQueuedAction);
    }
    async pending() {
        return (await this.list()).filter((a) => a.status === "pending");
    }
    async get(actionId) {
        const action = await this.store.get(actionId);
        return action ? normalizeQueuedAction(action) : undefined;
    }
    async approve(actionId, actor = "unknown") {
        const existing = await this.require(actionId);
        if (new Date(existing.expiresAt).getTime() <= Date.now()) {
            const resolvedAt = new Date().toISOString();
            const expired = {
                ...existing,
                status: "expired",
                resolvedAt,
                resolvedBy: "system"
            };
            await this.replaceStatus(existing, "pending", expired);
            throw new Error(`Action ${actionId} has expired and cannot be approved.`);
        }
        const approvedAt = new Date().toISOString();
        const updated = {
            ...existing,
            status: "approved",
            resolvedAt: approvedAt,
            approvedAt,
            approvedBy: actor,
            resolvedBy: actor
        };
        await this.replaceStatus(existing, "pending", updated);
        return updated;
    }
    async reject(actionId, actor = "unknown") {
        const existing = await this.require(actionId);
        const resolvedAt = new Date().toISOString();
        const updated = {
            ...existing,
            status: "rejected",
            resolvedAt,
            resolvedBy: actor
        };
        await this.replaceStatus(existing, "pending", updated);
        return updated;
    }
    async expire(actionId) {
        const existing = await this.require(actionId);
        const updated = {
            ...existing,
            status: "expired",
            resolvedAt: new Date().toISOString()
        };
        await this.replaceStatus(existing, "pending", updated);
        return updated;
    }
    async markExecuted(actionId) {
        return this.markExecutionStatus(actionId, "executed");
    }
    async markUnknown(actionId) {
        return this.markExecutionStatus(actionId, "unknown");
    }
    async markBlocked(actionId) {
        return this.markExecutionStatus(actionId, "blocked");
    }
    /**
     * Auto-expire any pending action whose TTL has elapsed (plan §8 safety:
     * approval timeout = cancel).
     */
    async expireOverdue() {
        const now = Date.now();
        let count = 0;
        for (const action of await this.pending()) {
            if (new Date(action.expiresAt).getTime() <= now) {
                await this.expire(action.actionId);
                count += 1;
            }
        }
        return count;
    }
    async require(actionId) {
        const existing = await this.get(actionId);
        if (!existing) {
            throw new Error(`Action ${actionId} not found in queue.`);
        }
        if (existing.status !== "pending") {
            throw new Error(`Action ${actionId} is already ${existing.status} and cannot be modified.`);
        }
        return existing;
    }
    async replaceStatus(existing, expected, updated) {
        if (this.store.compareAndSwap) {
            if (!await this.store.compareAndSwap(existing.actionId, expected, updated)) {
                throw new Error(`Action ${existing.actionId} changed before it could be updated.`);
            }
            return;
        }
        await this.store.save(updated);
    }
    async markExecutionStatus(actionId, status) {
        const existing = await this.get(actionId);
        if (!existing) {
            throw new Error(`Action ${actionId} not found in queue.`);
        }
        const expectedStatus = existing.status;
        if (expectedStatus === status)
            return existing;
        if (expectedStatus !== "approved" && !(expectedStatus === "unknown" && status === "executed")) {
            throw new Error(`Action ${actionId} is ${existing.status}; only approved actions can be executed.`);
        }
        const updated = {
            ...existing,
            status,
            resolvedAt: new Date().toISOString()
        };
        await this.replaceStatus(existing, expectedStatus, updated);
        return updated;
    }
}
export function classifyRisk(action) {
    switch (action.type) {
        case "set_roster":
            return "low";
        case "add_drop":
            return "high";
        case "waiver_claim":
            return "high";
        case "propose_trade":
            return "high";
    }
}
export function isTerminal(status) {
    return status !== "pending";
}
export { SqliteActionQueueStore } from "./sqlite-action-queue-store.js";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type {
  ActionEnqueueOptions,
  AgentAction,
  ActionStatus,
  QueuedAction,
  RiskLevel
} from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Serialize JSON values without allowing object insertion order to affect hashes. */
export function canonicalJson(value: unknown): string {
  const normalized = canonicalize(value);
  return JSON.stringify(normalized) ?? "null";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])])
  );
}

export function actionPayloadHash(action: AgentAction): string {
  return createHash("sha256").update(canonicalJson(action), "utf8").digest("hex");
}

export function buildIdempotencyKey(actionId: string, payloadHash: string): string {
  return `pmt-action:${actionId}:${payloadHash}`;
}

export function normalizeQueuedAction(action: QueuedAction): QueuedAction {
  const payloadHash = action.payloadHash ?? actionPayloadHash(action.action);
  return {
    ...action,
    payloadHash,
    idempotencyKey: action.idempotencyKey ?? buildIdempotencyKey(action.actionId, payloadHash)
  };
}

export interface ActionQueueStore {
  list(): Promise<QueuedAction[]>;
  get(actionId: string): Promise<QueuedAction | undefined>;
  save(action: QueuedAction): Promise<void>;
}

export class InMemoryActionQueueStore implements ActionQueueStore {
  private readonly items = new Map<string, QueuedAction>();
  async list(): Promise<QueuedAction[]> {
    return [...this.items.values()];
  }
  async get(actionId: string): Promise<QueuedAction | undefined> {
    return this.items.get(actionId);
  }
  async save(action: QueuedAction): Promise<void> {
    this.items.set(action.actionId, action);
  }
}

interface QueueFile {
  schema_version: string;
  saved_at: string;
  actions: QueuedAction[];
}

export class JsonActionQueueStore implements ActionQueueStore {
  private cache: Map<string, QueuedAction> | null = null;
  constructor(private readonly filePath: string) {}

  private async load(): Promise<Map<string, QueuedAction>> {
    if (this.cache) return this.cache;
    const map = new Map<string, QueuedAction>();
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as QueueFile;
      for (const action of parsed.actions ?? []) map.set(action.actionId, normalizeQueuedAction(action));
    } catch {
      // No persisted queue yet.
    }
    this.cache = map;
    return map;
  }

  async list(): Promise<QueuedAction[]> {
    return [...(await this.load()).values()];
  }
  async get(actionId: string): Promise<QueuedAction | undefined> {
    return (await this.load()).get(actionId);
  }
  async save(action: QueuedAction): Promise<void> {
    const map = await this.load();
    map.set(action.actionId, action);
    const payload: QueueFile = {
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
  constructor(private readonly store: ActionQueueStore) {}

  async enqueue(
    action: AgentAction,
    risk: RiskLevel,
    rationale: string,
    ttlMsOrOptions: number | ActionEnqueueOptions = DEFAULT_TTL_MS,
    options: ActionEnqueueOptions = {}
  ): Promise<QueuedAction> {
    const enqueueOptions = typeof ttlMsOrOptions === "number"
      ? options
      : ttlMsOrOptions;
    const ttlMs = typeof ttlMsOrOptions === "number"
      ? ttlMsOrOptions
      : enqueueOptions.ttlMs ?? DEFAULT_TTL_MS;
    const now = new Date();
    const actionId = `act-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const payloadHash = actionPayloadHash(action);
    const queued: QueuedAction = {
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
    await this.store.save(queued);
    return queued;
  }

  async list(): Promise<QueuedAction[]> {
    return (await this.store.list()).map(normalizeQueuedAction);
  }

  async pending(): Promise<QueuedAction[]> {
    return (await this.list()).filter((a) => a.status === "pending");
  }

  async get(actionId: string): Promise<QueuedAction | undefined> {
    const action = await this.store.get(actionId);
    return action ? normalizeQueuedAction(action) : undefined;
  }

  async approve(actionId: string, actor = "unknown"): Promise<QueuedAction> {
    const existing = await this.require(actionId);
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      const resolvedAt = new Date().toISOString();
      const expired: QueuedAction = {
        ...existing,
        status: "expired",
        resolvedAt,
        resolvedBy: "system"
      };
      await this.store.save(expired);
      throw new Error(`Action ${actionId} has expired and cannot be approved.`);
    }
    const approvedAt = new Date().toISOString();
    const updated: QueuedAction = {
      ...existing,
      status: "approved",
      resolvedAt: approvedAt,
      approvedAt,
      approvedBy: actor,
      resolvedBy: actor
    };
    await this.store.save(updated);
    return updated;
  }

  async reject(actionId: string, actor = "unknown"): Promise<QueuedAction> {
    const existing = await this.require(actionId);
    const resolvedAt = new Date().toISOString();
    const updated: QueuedAction = {
      ...existing,
      status: "rejected",
      resolvedAt,
      resolvedBy: actor
    };
    await this.store.save(updated);
    return updated;
  }

  async expire(actionId: string): Promise<QueuedAction> {
    const existing = await this.require(actionId);
    const updated: QueuedAction = {
      ...existing,
      status: "expired",
      resolvedAt: new Date().toISOString()
    };
    await this.store.save(updated);
    return updated;
  }

  async markExecuted(actionId: string): Promise<QueuedAction> {
    return this.markExecutionStatus(actionId, "executed");
  }

  async markUnknown(actionId: string): Promise<QueuedAction> {
    return this.markExecutionStatus(actionId, "unknown");
  }

  async markBlocked(actionId: string): Promise<QueuedAction> {
    return this.markExecutionStatus(actionId, "blocked");
  }

  /**
   * Auto-expire any pending action whose TTL has elapsed (plan §8 safety:
   * approval timeout = cancel).
   */
  async expireOverdue(): Promise<number> {
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

  private async require(actionId: string): Promise<QueuedAction> {
    const existing = await this.get(actionId);
    if (!existing) {
      throw new Error(`Action ${actionId} not found in queue.`);
    }
    if (existing.status !== "pending") {
      throw new Error(`Action ${actionId} is already ${existing.status} and cannot be modified.`);
    }
    return existing;
  }

  private async markExecutionStatus(
    actionId: string,
    status: Extract<ActionStatus, "executed" | "unknown" | "blocked">
  ): Promise<QueuedAction> {
    const existing = await this.get(actionId);
    if (!existing) {
      throw new Error(`Action ${actionId} not found in queue.`);
    }
    if (existing.status !== "approved") {
      throw new Error(`Action ${actionId} is ${existing.status}; only approved actions can be executed.`);
    }
    const updated: QueuedAction = {
      ...existing,
      status,
      resolvedAt: new Date().toISOString()
    };
    await this.store.save(updated);
    return updated;
  }
}

export function classifyRisk(action: AgentAction): RiskLevel {
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

export function isTerminal(status: ActionStatus): boolean {
  return status !== "pending";
}

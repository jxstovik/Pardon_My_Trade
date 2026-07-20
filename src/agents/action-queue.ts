import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentAction, ActionStatus, QueuedAction, RiskLevel } from "./types.js";

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
      for (const action of parsed.actions ?? []) map.set(action.actionId, action);
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
    ttlMs = 24 * 60 * 60 * 1000
  ): Promise<QueuedAction> {
    const now = new Date();
    const queued: QueuedAction = {
      actionId: `act-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      risk,
      rationale,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    await this.store.save(queued);
    return queued;
  }

  async list(): Promise<QueuedAction[]> {
    return this.store.list();
  }

  async pending(): Promise<QueuedAction[]> {
    return (await this.store.list()).filter((a) => a.status === "pending");
  }

  async get(actionId: string): Promise<QueuedAction | undefined> {
    return this.store.get(actionId);
  }

  async approve(actionId: string): Promise<QueuedAction> {
    const existing = await this.require(actionId);
    const updated: QueuedAction = {
      ...existing,
      status: "approved",
      resolvedAt: new Date().toISOString()
    };
    await this.store.save(updated);
    return updated;
  }

  async reject(actionId: string): Promise<QueuedAction> {
    const existing = await this.require(actionId);
    const updated: QueuedAction = {
      ...existing,
      status: "rejected",
      resolvedAt: new Date().toISOString()
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
    const existing = await this.store.get(actionId);
    if (!existing) {
      throw new Error(`Action ${actionId} not found in queue.`);
    }
    if (existing.status !== "pending") {
      throw new Error(`Action ${actionId} is already ${existing.status} and cannot be modified.`);
    }
    return existing;
  }
}

export function classifyRisk(action: AgentAction): RiskLevel {
  switch (action.type) {
    case "set_roster":
      return "low";
    case "add_drop":
      return "high";
    case "propose_trade":
      return "high";
  }
}

export function isTerminal(status: ActionStatus): boolean {
  return status !== "pending";
}

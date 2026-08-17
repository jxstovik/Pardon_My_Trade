import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ActionExecution,
  ActionExecutionError,
  AgentAction,
  ActionStatus,
  QueuedAction,
  RiskLevel
} from "./types.js";
import { withFileLock } from "../concurrency/file-lock.js";

export type ActionProvider<TAction extends AgentAction, TResponse> = (
  action: TAction,
  context: { readonly actionId: string; readonly idempotencyKey: string }
) => Promise<TResponse>;

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
  private readonly executing = new Set<string>();

  constructor(private readonly store: ActionQueueStore, private readonly lockPath?: string) {}

  async enqueue<TAction extends AgentAction>(
    action: TAction,
    risk: RiskLevel,
    rationale: string,
    ttlMs = 24 * 60 * 60 * 1000
  ): Promise<QueuedAction<TAction>> {
    const now = new Date();
    const queued: QueuedAction<TAction> = {
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

  /**
   * Execute an approved action through a provider. Approval is deliberately a
   * prerequisite: enqueueing or approving never calls the provider.
   * A successful execution is idempotent and returns the recorded response.
   */
  async execute<TAction extends AgentAction, TResponse>(
    actionId: string,
    provider: ActionProvider<TAction, TResponse>
  ): Promise<QueuedAction<TAction, TResponse>> {
    if (this.lockPath) {
      const locked = await withFileLock(this.lockPath, () => this.executeUnlocked(actionId, provider));
      if (!locked.acquired) throw new Error(`Action queue is already executing another action.`);
      return locked.value;
    }
    return this.executeUnlocked(actionId, provider);
  }

  private async executeUnlocked<TAction extends AgentAction, TResponse>(
    actionId: string,
    provider: ActionProvider<TAction, TResponse>
  ): Promise<QueuedAction<TAction, TResponse>> {
    const existing = await this.store.get(actionId) as QueuedAction<TAction, TResponse> | undefined;
    if (!existing) throw new Error(`Action ${actionId} not found in queue.`);
    if (existing.status === "executed" && existing.execution?.status === "succeeded") return existing;
    if (existing.status !== "approved") {
      throw new Error(`Action ${actionId} must be approved before it can be executed.`);
    }
    if (existing.execution?.status === "running" || this.executing.has(actionId)) {
      throw new Error(`Action ${actionId} is already executing.`);
    }

    const prior = existing.execution;
    const idempotencyKey = prior?.idempotencyKey ?? actionId;
    const running: ActionExecution<TResponse> = {
      status: "running",
      idempotencyKey,
      attempts: (prior?.attempts ?? 0) + 1,
      startedAt: new Date().toISOString()
    };
    this.executing.add(actionId);
    try {
      await this.store.save({ ...existing, execution: running });
    } catch (error) {
      this.executing.delete(actionId);
      throw error;
    }

    try {
      const providerResponse = await provider(existing.action, { actionId, idempotencyKey });
      const execution: ActionExecution<TResponse> = {
        ...running,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        providerResponse
      };
      const executed: QueuedAction<TAction, TResponse> = { ...existing, status: "executed", execution };
      await this.store.save(executed);
      return executed;
    } catch (error) {
      const execution: ActionExecution<TResponse> = {
        ...running,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: toActionExecutionError(error)
      };
      const failed: QueuedAction<TAction, TResponse> = { ...existing, execution };
      await this.store.save(failed);
      throw error;
    } finally {
      this.executing.delete(actionId);
    }
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

function toActionExecutionError(error: unknown): ActionExecutionError {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return code ? { name: error.name, message: error.message, code } : { name: error.name, message: error.message };
  }
  return { name: "ProviderError", message: String(error) };
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
  return status === "rejected" || status === "expired" || status === "executed";
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlatformReader } from "../adapters/platform-reader.js";
import type { PlatformWriter } from "../adapters/platform-writer.js";
import type { Roster, RosterSlot, WaiverState } from "../models/types.js";
import {
  actionPayloadHash,
  canonicalJson,
  type ActionQueue
} from "./action-queue.js";
import type {
  ActionPreconditions,
  AgentAction,
  QueuedAction
} from "./types.js";

export type ActionExecutionStatus = "executed" | "already_executed" | "blocked" | "unknown";
export type ActionReceiptStatus = "executed" | "blocked" | "unknown";
export type ActionAuditEvent =
  | "blocked"
  | "revalidation_failed"
  | "submission_started"
  | "executed"
  | "unknown"
  | "idempotent_replay";

export interface ActionReceipt {
  readonly receiptId: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly approvedBy?: string;
  readonly status: ActionReceiptStatus;
  readonly recordedAt: string;
  readonly completedAt?: string;
  readonly response?: unknown;
  readonly error?: string;
}

export interface ActionAuditRecord {
  readonly auditId: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly event: ActionAuditEvent;
  readonly recordedAt: string;
  readonly actor?: string;
  readonly details?: Record<string, unknown>;
}

export interface ActionExecutionStore {
  getReceipt(actionId: string): Promise<ActionReceipt | undefined>;
  getReceiptByIdempotencyKey(idempotencyKey: string): Promise<ActionReceipt | undefined>;
  saveReceipt(receipt: ActionReceipt): Promise<void>;
  appendAudit(record: ActionAuditRecord): Promise<void>;
  listReceipts(): Promise<ActionReceipt[]>;
  listAudit(): Promise<ActionAuditRecord[]>;
}

export class InMemoryActionExecutionStore implements ActionExecutionStore {
  private readonly receipts = new Map<string, ActionReceipt>();
  private readonly audit: ActionAuditRecord[] = [];

  async getReceipt(actionId: string): Promise<ActionReceipt | undefined> {
    return this.receipts.get(actionId);
  }

  async getReceiptByIdempotencyKey(idempotencyKey: string): Promise<ActionReceipt | undefined> {
    return [...this.receipts.values()].find((receipt) => receipt.idempotencyKey === idempotencyKey);
  }

  async saveReceipt(receipt: ActionReceipt): Promise<void> {
    const collision = await this.getReceiptByIdempotencyKey(receipt.idempotencyKey);
    if (collision && collision.payloadHash !== receipt.payloadHash) {
      throw new Error(`Idempotency key ${receipt.idempotencyKey} is already bound to another payload.`);
    }
    this.receipts.set(receipt.actionId, receipt);
  }

  async appendAudit(record: ActionAuditRecord): Promise<void> {
    this.audit.push(record);
  }

  async listReceipts(): Promise<ActionReceipt[]> {
    return [...this.receipts.values()];
  }

  async listAudit(): Promise<ActionAuditRecord[]> {
    return [...this.audit];
  }
}

interface ActionExecutionFile {
  readonly schema_version: "1.0.0";
  readonly receipts: ActionReceipt[];
  readonly audit: ActionAuditRecord[];
}

/** Durable local receipt/audit store. Unknown receipts survive process restarts. */
export class JsonActionExecutionStore implements ActionExecutionStore {
  private cache: { receipts: Map<string, ActionReceipt>; audit: ActionAuditRecord[] } | null = null;

  constructor(private readonly filePath: string) {}

  async getReceipt(actionId: string): Promise<ActionReceipt | undefined> {
    return (await this.load()).receipts.get(actionId);
  }

  async getReceiptByIdempotencyKey(idempotencyKey: string): Promise<ActionReceipt | undefined> {
    return [...(await this.load()).receipts.values()].find((receipt) => receipt.idempotencyKey === idempotencyKey);
  }

  async saveReceipt(receipt: ActionReceipt): Promise<void> {
    const state = await this.load();
    const collision = [...state.receipts.values()].find((existing) =>
      existing.idempotencyKey === receipt.idempotencyKey && existing.actionId !== receipt.actionId
    );
    if (collision && collision.payloadHash !== receipt.payloadHash) {
      throw new Error(`Idempotency key ${receipt.idempotencyKey} is already bound to another payload.`);
    }
    state.receipts.set(receipt.actionId, receipt);
    await this.persist(state);
  }

  async appendAudit(record: ActionAuditRecord): Promise<void> {
    const state = await this.load();
    state.audit.push(record);
    await this.persist(state);
  }

  async listReceipts(): Promise<ActionReceipt[]> {
    return [...(await this.load()).receipts.values()];
  }

  async listAudit(): Promise<ActionAuditRecord[]> {
    return [...(await this.load()).audit];
  }

  private async load(): Promise<{ receipts: Map<string, ActionReceipt>; audit: ActionAuditRecord[] }> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as ActionExecutionFile;
      this.cache = {
        receipts: new Map((parsed.receipts ?? []).map((receipt) => [receipt.actionId, receipt])),
        audit: [...(parsed.audit ?? [])]
      };
    } catch {
      this.cache = { receipts: new Map(), audit: [] };
    }
    return this.cache;
  }

  private async persist(state: { receipts: Map<string, ActionReceipt>; audit: ActionAuditRecord[] }): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: ActionExecutionFile = {
      schema_version: "1.0.0",
      receipts: [...state.receipts.values()],
      audit: state.audit
    };
    await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
    this.cache = state;
  }
}

export interface ActionExecutorOptions {
  readonly queue: ActionQueue;
  readonly reader: PlatformReader;
  readonly writer: PlatformWriter;
  readonly store?: ActionExecutionStore;
  readonly leagueExternalId?: string;
  readonly actor?: string;
  readonly now?: () => Date;
}

export interface ActionExecutionResult {
  readonly actionId: string;
  readonly status: ActionExecutionStatus;
  readonly receipt?: ActionReceipt;
  readonly reason?: string;
}

interface RevalidatedState {
  readonly rosters: ReadonlyMap<string, Roster>;
  readonly freeAgentIds?: ReadonlySet<string>;
  readonly waiverState?: WaiverState;
}

interface ValidationFailure {
  readonly reason: string;
  readonly details?: Record<string, unknown>;
}

type ValidationResult = RevalidatedState | ValidationFailure;

/**
 * Executes only an approved queue entry. A receipt is written as `unknown`
 * before POST so a process crash or transport error cannot cause an automatic
 * second submission.
 */
export class ActionExecutor {
  private readonly queue: ActionQueue;
  private readonly reader: PlatformReader;
  private readonly writer: PlatformWriter;
  private readonly store: ActionExecutionStore;
  private readonly defaultLeagueExternalId?: string;
  private readonly actor: string;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<ActionExecutionResult>>();

  constructor(options: ActionExecutorOptions);
  constructor(
    queue: ActionQueue,
    reader: PlatformReader,
    writer: PlatformWriter,
    store?: ActionExecutionStore,
    leagueExternalId?: string
  );
  constructor(
    optionsOrQueue: ActionExecutorOptions | ActionQueue,
    reader?: PlatformReader,
    writer?: PlatformWriter,
    store?: ActionExecutionStore,
    leagueExternalId?: string
  ) {
    if (isOptions(optionsOrQueue)) {
      this.queue = optionsOrQueue.queue;
      this.reader = optionsOrQueue.reader;
      this.writer = optionsOrQueue.writer;
      this.store = optionsOrQueue.store ?? new InMemoryActionExecutionStore();
      this.defaultLeagueExternalId = optionsOrQueue.leagueExternalId;
      this.actor = optionsOrQueue.actor ?? "pmt-executor";
      this.now = optionsOrQueue.now ?? (() => new Date());
      return;
    }
    if (!reader || !writer) throw new Error("ActionExecutor requires a reader and writer.");
    this.queue = optionsOrQueue;
    this.reader = reader;
    this.writer = writer;
    this.store = store ?? new InMemoryActionExecutionStore();
    this.defaultLeagueExternalId = leagueExternalId;
    this.actor = "pmt-executor";
    this.now = () => new Date();
  }

  async execute(
    actionId: string,
    options: { readonly leagueExternalId?: string } = {}
  ): Promise<ActionExecutionResult> {
    const existingLock = this.locks.get(actionId);
    if (existingLock) return existingLock;
    const execution = this.executeOnce(actionId, options);
    this.locks.set(actionId, execution);
    try {
      return await execution;
    } finally {
      this.locks.delete(actionId);
    }
  }

  private async executeOnce(
    actionId: string,
    options: { readonly leagueExternalId?: string }
  ): Promise<ActionExecutionResult> {
    const queued = await this.queue.get(actionId);
    if (!queued) throw new Error(`Action ${actionId} not found in queue.`);

    const leagueExternalId = options.leagueExternalId
      ?? queued.preconditions?.leagueExternalId
      ?? this.defaultLeagueExternalId;
    const payloadHash = queued.payloadHash ?? actionPayloadHash(queued.action);
    const idempotencyKey = queued.idempotencyKey ?? `pmt-action:${queued.actionId}:${payloadHash}`;

    if (queued.status !== "approved") {
      if (queued.status === "pending" && this.isExpired(queued)) {
        await this.queue.expire(actionId);
      }
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", {
        reason: `action_status_${queued.status}`
      });
      if (queued.status === "unknown") {
        return { actionId, status: "unknown", reason: "Submission outcome is unknown; no retry was attempted." };
      }
      if (queued.status === "executed") {
        return { actionId, status: "already_executed", reason: "Action was already executed." };
      }
      return { actionId, status: "blocked", reason: `Action is ${queued.status}; approval is required.` };
    }

    if (this.isExpired(queued)) {
      await this.queue.markBlocked(actionId);
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "expired" });
      return { actionId, status: "blocked", reason: "Approved action has expired." };
    }

    const recorded = await this.store.getReceipt(actionId);
    if (recorded) {
      if (recorded.payloadHash !== payloadHash || recorded.idempotencyKey !== idempotencyKey) {
        await this.queue.markBlocked(actionId);
        await this.audit(queued, payloadHash, idempotencyKey, "blocked", {
          reason: "receipt_payload_or_idempotency_mismatch"
        });
        return { actionId, status: "blocked", receipt: recorded, reason: "Receipt does not match the queued payload." };
      }
      await this.syncQueueToReceipt(actionId, recorded);
      await this.audit(queued, payloadHash, idempotencyKey, "idempotent_replay", { receiptStatus: recorded.status });
      return {
        actionId,
        status: recorded.status === "executed" ? "already_executed" : recorded.status,
        receipt: recorded,
        reason: recorded.status === "unknown" ? "Submission outcome is unknown; no retry was attempted." : undefined
      };
    }

    const sameKey = await this.store.getReceiptByIdempotencyKey(idempotencyKey);
    if (sameKey) {
      if (sameKey.payloadHash !== payloadHash) {
        await this.queue.markBlocked(actionId);
        await this.audit(queued, payloadHash, idempotencyKey, "blocked", {
          reason: "idempotency_key_payload_collision"
        });
        return { actionId, status: "blocked", receipt: sameKey, reason: "Idempotency key is bound to another payload." };
      }
      await this.syncQueueToReceipt(actionId, sameKey);
      await this.audit(queued, payloadHash, idempotencyKey, "idempotent_replay", {
        receiptActionId: sameKey.actionId,
        receiptStatus: sameKey.status
      });
      return {
        actionId,
        status: sameKey.status === "executed" ? "already_executed" : sameKey.status,
        receipt: sameKey,
        reason: sameKey.status === "unknown" ? "Submission outcome is unknown; no retry was attempted." : undefined
      };
    }

    if (queued.payloadHash !== undefined && queued.payloadHash !== actionPayloadHash(queued.action)) {
      await this.queue.markBlocked(actionId);
      const receipt = await this.saveReceipt(queued, payloadHash, idempotencyKey, "blocked", "payload_hash_mismatch");
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "payload_hash_mismatch" });
      return { actionId, status: "blocked", receipt, reason: "Queued action payload hash does not match its action." };
    }

    if (!leagueExternalId) {
      await this.queue.markBlocked(actionId);
      const receipt = await this.saveReceipt(queued, payloadHash, idempotencyKey, "blocked", "league_external_id_missing");
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "league_external_id_missing" });
      return { actionId, status: "blocked", receipt, reason: "A league external id is required for revalidation." };
    }

    const validation = await this.revalidate(queued.action, leagueExternalId, queued.preconditions);
    if (!isRevalidatedState(validation)) {
      await this.queue.markBlocked(actionId);
      const receipt = await this.saveReceipt(queued, payloadHash, idempotencyKey, "blocked", validation.reason);
      await this.audit(queued, payloadHash, idempotencyKey, "revalidation_failed", {
        reason: validation.reason,
        ...validation.details
      });
      return { actionId, status: "blocked", receipt, reason: validation.reason };
    }

    // Re-read the queue after potentially slow platform reads. Approval and
    // expiry are checked immediately before the side effect as well.
    const current = await this.queue.get(actionId);
    if (!current || current.status !== "approved" || this.isExpired(current)) {
      if (current?.status === "approved") await this.queue.markBlocked(actionId);
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "approval_or_expiry_changed" });
      return { actionId, status: "blocked", reason: "Approval was lost or the action expired before submission." };
    }
    if ((current.payloadHash ?? actionPayloadHash(current.action)) !== payloadHash) {
      await this.queue.markBlocked(actionId);
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "payload_changed_before_submission" });
      return { actionId, status: "blocked", reason: "Queued action changed before submission." };
    }
    if ((current.idempotencyKey ?? `pmt-action:${current.actionId}:${payloadHash}`) !== idempotencyKey) {
      await this.queue.markBlocked(actionId);
      await this.audit(queued, payloadHash, idempotencyKey, "blocked", { reason: "idempotency_key_changed_before_submission" });
      return { actionId, status: "blocked", reason: "Queued action idempotency key changed before submission." };
    }

    // Write this before the network call. Unknown is intentionally not retryable.
    const started = await this.saveReceipt(queued, payloadHash, idempotencyKey, "unknown");
    await this.audit(queued, payloadHash, idempotencyKey, "submission_started");

    let response: unknown;
    try {
      response = await this.write(leagueExternalId, queued.action);
    } catch (error) {
      const receipt: ActionReceipt = {
        ...started,
        status: "unknown",
        completedAt: this.now().toISOString(),
        error: errorMessage(error)
      };
      await this.store.saveReceipt(receipt);
      await this.queue.markUnknown(actionId);
      await this.audit(queued, payloadHash, idempotencyKey, "unknown", { error: receipt.error });
      return {
        actionId,
        status: "unknown",
        receipt,
        reason: "Network outcome is unknown; no retry was attempted."
      };
    }

    const receipt: ActionReceipt = {
      ...started,
      status: "executed",
      completedAt: this.now().toISOString(),
      response
    };
    await this.store.saveReceipt(receipt);
    try {
      await this.queue.markExecuted(actionId);
    } catch (error) {
      // The receipt is authoritative once the platform returned success. A
      // later call still cannot submit again even if queue persistence failed.
      await this.audit(queued, payloadHash, idempotencyKey, "executed", {
        queueUpdateError: errorMessage(error)
      });
      return { actionId, status: "executed", receipt };
    }
    await this.audit(queued, payloadHash, idempotencyKey, "executed");
    return { actionId, status: "executed", receipt };
  }

  private async revalidate(
    action: AgentAction,
    leagueExternalId: string,
    preconditions?: ActionPreconditions
  ): Promise<ValidationResult> {
    if (preconditions?.leagueExternalId && preconditions.leagueExternalId !== leagueExternalId) {
      return { reason: "league_precondition_mismatch" };
    }

    const teamIds = actionTeams(action);
    for (const teamId of Object.keys(preconditions?.expectedRosterHashes ?? {})) teamIds.add(teamId);
    const rosters = new Map<string, Roster>();
    try {
      for (const teamId of teamIds) {
        rosters.set(teamId, await this.reader.getRoster(leagueExternalId, teamId));
      }
    } catch (error) {
      return { reason: "roster_revalidation_failed", details: { error: errorMessage(error) } };
    }

    for (const [teamId, expectedHash] of Object.entries(preconditions?.expectedRosterHashes ?? {})) {
      const current = rosters.get(teamId);
      if (!current || rosterFingerprint(current) !== expectedHash) {
        return { reason: `roster_precondition_mismatch:${teamId}` };
      }
    }

    const needsFreeAgents = action.type === "add_drop" || action.type === "waiver_claim" || preconditions?.expectedFreeAgentIds;
    let freeAgentIds: ReadonlySet<string> | undefined;
    if (needsFreeAgents) {
      try {
        freeAgentIds = new Set((await this.reader.getFreeAgents(leagueExternalId)).map((player) => player.player_id));
      } catch (error) {
        return { reason: "free_agent_revalidation_failed", details: { error: errorMessage(error) } };
      }
      if (preconditions?.expectedFreeAgentIds && !sameIds(freeAgentIds, preconditions.expectedFreeAgentIds)) {
        return { reason: "free_agent_precondition_mismatch" };
      }
    }

    const needsWaiverState = action.type === "waiver_claim" || preconditions?.expectedFaabBudgets;
    let waiverState: WaiverState | undefined;
    if (needsWaiverState) {
      try {
        waiverState = await this.reader.getWaiverState(leagueExternalId);
      } catch (error) {
        return { reason: "waiver_state_revalidation_failed", details: { error: errorMessage(error) } };
      }
      for (const [teamId, expectedBudget] of Object.entries(preconditions?.expectedFaabBudgets ?? {})) {
        if (waiverState.faab_budgets[teamId] !== expectedBudget) {
          return { reason: `faab_precondition_mismatch:${teamId}` };
        }
      }
    }

    const state: RevalidatedState = { rosters, freeAgentIds, waiverState };
    const semanticFailure = validateAction(action, state);
    return semanticFailure ?? state;
  }

  private async write(leagueExternalId: string, action: AgentAction): Promise<unknown> {
    switch (action.type) {
      case "set_roster":
        return this.writer.setRoster(leagueExternalId, action);
      case "add_drop":
        return this.writer.addDrop(leagueExternalId, action);
      case "waiver_claim":
        return this.writer.submitWaiverClaim(leagueExternalId, action);
      case "propose_trade":
        return this.writer.proposeTrade(leagueExternalId, action);
    }
  }

  private async saveReceipt(
    queued: QueuedAction,
    payloadHash: string,
    idempotencyKey: string,
    status: ActionReceiptStatus,
    error?: string
  ): Promise<ActionReceipt> {
    const receipt: ActionReceipt = {
      receiptId: `rcpt-${queued.actionId}`,
      actionId: queued.actionId,
      idempotencyKey,
      payloadHash,
      approvedBy: queued.approvedBy,
      status,
      recordedAt: this.now().toISOString(),
      error
    };
    await this.store.saveReceipt(receipt);
    return receipt;
  }

  private async syncQueueToReceipt(actionId: string, receipt: ActionReceipt): Promise<void> {
    if (receipt.status === "executed") await this.queue.markExecuted(actionId);
    if (receipt.status === "unknown") await this.queue.markUnknown(actionId);
    if (receipt.status === "blocked") await this.queue.markBlocked(actionId);
  }

  private async audit(
    queued: QueuedAction,
    payloadHash: string,
    idempotencyKey: string,
    event: ActionAuditEvent,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendAudit({
      auditId: `audit-${queued.actionId}-${this.now().getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      actionId: queued.actionId,
      idempotencyKey,
      payloadHash,
      event,
      recordedAt: this.now().toISOString(),
      actor: this.actor,
      details: { approvedBy: queued.approvedBy, ...details }
    });
  }

  private isExpired(action: QueuedAction): boolean {
    const expiresAt = new Date(action.expiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= this.now().getTime();
  }
}

export function rosterFingerprint(roster: Roster): string {
  const normalized = (slots: ReadonlyArray<RosterSlot>) => slots.map((slot) => ({
    slot_type: slot.slot_type,
    allowed_positions: [...slot.allowed_positions].sort(),
    locked: slot.locked,
    player_id: slot.player_id
  }));
  return createHash("sha256").update(canonicalJson({
    team_id: roster.team_id,
    starters: normalized(roster.starters),
    bench: normalized(roster.bench),
    injured_reserve: normalized(roster.injured_reserve),
    taxi: normalized(roster.taxi)
  }), "utf8").digest("hex");
}

function actionTeams(action: AgentAction): Set<string> {
  switch (action.type) {
    case "set_roster":
    case "add_drop":
    case "waiver_claim":
      return new Set([action.teamId]);
    case "propose_trade":
      return new Set([action.fromTeamId, action.toTeamId]);
  }
}

function validateAction(action: AgentAction, state: RevalidatedState): ValidationFailure | undefined {
  switch (action.type) {
    case "set_roster": {
      const roster = state.rosters.get(action.teamId);
      if (!roster) return { reason: `team_roster_missing:${action.teamId}` };
      const currentSlots = allSlots(roster);
      const currentPlayers = new Set(currentSlots.flatMap((slot) => slot.player_id ? [slot.player_id] : []));
      const starterIds = action.starters.map((starter) => starter.playerId);
      if (new Set(starterIds).size !== starterIds.length) return { reason: "duplicate_starter_player" };
      if (starterIds.some((playerId) => !currentPlayers.has(playerId))) return { reason: "starter_not_on_current_roster" };
      for (const slot of currentSlots.filter((item) => item.locked && item.player_id)) {
        const assignment = action.starters.find((starter) => starter.playerId === slot.player_id);
        if (assignment && assignment.slot !== slot.slot_type) return { reason: `locked_player_change:${slot.player_id}` };
        if (slot.slot_type !== "BN" && slot.slot_type !== "IR" && !assignment) {
          return { reason: `locked_player_removed:${slot.player_id}` };
        }
      }
      return undefined;
    }
    case "add_drop": {
      const roster = state.rosters.get(action.teamId);
      if (!roster || !state.freeAgentIds) return { reason: "add_drop_state_missing" };
      if (hasDuplicates(action.addPlayerIds) || hasDuplicates(action.dropPlayerIds)) {
        return { reason: "duplicate_add_drop_player" };
      }
      if (action.addPlayerIds.some((playerId) => action.dropPlayerIds.includes(playerId))) {
        return { reason: "player_both_added_and_dropped" };
      }
      const owned = new Set(allSlots(roster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
      if (action.addPlayerIds.some((playerId) => !state.freeAgentIds?.has(playerId))) return { reason: "add_player_not_free" };
      if (action.dropPlayerIds.some((playerId) => !owned.has(playerId))) return { reason: "drop_player_not_owned" };
      if (action.dropPlayerIds.some((playerId) => allSlots(roster).some((slot) => slot.player_id === playerId && slot.locked))) {
        return { reason: "locked_drop_player" };
      }
      return undefined;
    }
    case "waiver_claim": {
      const roster = state.rosters.get(action.teamId);
      if (!roster || !state.freeAgentIds || !state.waiverState) return { reason: "waiver_state_missing" };
      if (!action.addPlayerId) return { reason: "waiver_add_player_missing" };
      if (action.dropPlayerId === action.addPlayerId) return { reason: "waiver_player_both_added_and_dropped" };
      if (!state.freeAgentIds.has(action.addPlayerId)) return { reason: "waiver_add_player_not_free" };
      const owned = new Set(allSlots(roster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
      if (action.dropPlayerId && !owned.has(action.dropPlayerId)) return { reason: "waiver_drop_player_not_owned" };
      if (action.dropPlayerId && allSlots(roster).some((slot) => slot.player_id === action.dropPlayerId && slot.locked)) {
        return { reason: "locked_waiver_drop_player" };
      }
      if (action.faabBid !== undefined) {
        if (!Number.isInteger(action.faabBid) || action.faabBid < 0) return { reason: "invalid_faab_bid" };
        const budget = state.waiverState.faab_budgets[action.teamId];
        if (budget === undefined) return { reason: "faab_budget_unavailable" };
        if (action.faabBid > budget) return { reason: "faab_bid_exceeds_budget" };
      }
      return undefined;
    }
    case "propose_trade": {
      if (action.fromTeamId === action.toTeamId) return { reason: "trade_teams_must_differ" };
      const fromRoster = state.rosters.get(action.fromTeamId);
      const toRoster = state.rosters.get(action.toTeamId);
      if (!fromRoster || !toRoster) return { reason: "trade_roster_missing" };
      if (hasDuplicates(action.givePlayerIds) || hasDuplicates(action.receivePlayerIds)) {
        return { reason: "duplicate_trade_player" };
      }
      const give = new Set(allSlots(fromRoster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
      const receive = new Set(allSlots(toRoster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
      if (action.givePlayerIds.some((playerId) => !give.has(playerId))) return { reason: "trade_give_player_not_owned" };
      if (action.receivePlayerIds.some((playerId) => !receive.has(playerId))) return { reason: "trade_receive_player_not_owned" };
      if ([...action.givePlayerIds, ...action.receivePlayerIds].some((playerId) =>
        allSlots(fromRoster).some((slot) => slot.player_id === playerId && slot.locked)
        || allSlots(toRoster).some((slot) => slot.player_id === playerId && slot.locked)
      )) return { reason: "locked_trade_player" };
      return undefined;
    }
  }
}

function allSlots(roster: Roster): RosterSlot[] {
  return [...roster.starters, ...roster.bench, ...roster.injured_reserve, ...roster.taxi];
}

function hasDuplicates(values: ReadonlyArray<string>): boolean {
  return new Set(values).size !== values.length;
}

function sameIds(current: ReadonlySet<string>, expected: ReadonlyArray<string>): boolean {
  return current.size === new Set(expected).size && [...current].every((id) => expected.includes(id));
}

function isRevalidatedState(value: ValidationResult): value is RevalidatedState {
  return "rosters" in value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOptions(value: ActionExecutorOptions | ActionQueue): value is ActionExecutorOptions {
  return "queue" in value && "reader" in value && "writer" in value;
}

import { sameScoringPeriod } from "../models/scoring-period.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { actionPayloadHash, canonicalJson } from "./action-queue.js";
export class InMemoryActionExecutionStore {
    receipts = new Map();
    audit = [];
    async getReceipt(actionId) {
        return this.receipts.get(actionId);
    }
    async getReceiptByIdempotencyKey(idempotencyKey) {
        return [...this.receipts.values()].find((receipt) => receipt.idempotencyKey === idempotencyKey);
    }
    async saveReceipt(receipt) {
        const collision = await this.getReceiptByIdempotencyKey(receipt.idempotencyKey);
        if (collision && collision.payloadHash !== receipt.payloadHash) {
            throw new Error(`Idempotency key ${receipt.idempotencyKey} is already bound to another payload.`);
        }
        this.receipts.set(receipt.actionId, receipt);
    }
    async reserveReceipt(receipt) {
        if (this.receipts.has(receipt.actionId))
            return false;
        const collision = await this.getReceiptByIdempotencyKey(receipt.idempotencyKey);
        if (collision)
            return false;
        this.receipts.set(receipt.actionId, receipt);
        return true;
    }
    async appendAudit(record) {
        this.audit.push(record);
    }
    async listReceipts() {
        return [...this.receipts.values()];
    }
    async listAudit() {
        return [...this.audit];
    }
}
/** Durable local receipt/audit store. Unknown receipts survive process restarts. */
export class JsonActionExecutionStore {
    filePath;
    cache = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async getReceipt(actionId) {
        return (await this.load()).receipts.get(actionId);
    }
    async getReceiptByIdempotencyKey(idempotencyKey) {
        return [...(await this.load()).receipts.values()].find((receipt) => receipt.idempotencyKey === idempotencyKey);
    }
    async saveReceipt(receipt) {
        const state = await this.load();
        const collision = [...state.receipts.values()].find((existing) => existing.idempotencyKey === receipt.idempotencyKey && existing.actionId !== receipt.actionId);
        if (collision && collision.payloadHash !== receipt.payloadHash) {
            throw new Error(`Idempotency key ${receipt.idempotencyKey} is already bound to another payload.`);
        }
        state.receipts.set(receipt.actionId, receipt);
        await this.persist(state);
    }
    async appendAudit(record) {
        const state = await this.load();
        state.audit.push(record);
        await this.persist(state);
    }
    async listReceipts() {
        return [...(await this.load()).receipts.values()];
    }
    async listAudit() {
        return [...(await this.load()).audit];
    }
    async load() {
        if (this.cache)
            return this.cache;
        try {
            const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
            this.cache = {
                receipts: new Map((parsed.receipts ?? []).map((receipt) => [receipt.actionId, receipt])),
                audit: [...(parsed.audit ?? [])]
            };
        }
        catch {
            this.cache = { receipts: new Map(), audit: [] };
        }
        return this.cache;
    }
    async persist(state) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
            schema_version: "1.0.0",
            receipts: [...state.receipts.values()],
            audit: state.audit
        };
        await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
        await rename(temporaryPath, this.filePath);
        this.cache = state;
    }
}
/**
 * Executes only an approved queue entry. A receipt is written as `unknown`
 * before POST so a process crash or transport error cannot cause an automatic
 * second submission.
 */
export class ActionExecutor {
    queue;
    reader;
    writer;
    store;
    defaultLeagueExternalId;
    actor;
    now;
    locks = new Map();
    constructor(optionsOrQueue, reader, writer, store, leagueExternalId) {
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
        if (!reader || !writer)
            throw new Error("ActionExecutor requires a reader and writer.");
        this.queue = optionsOrQueue;
        this.reader = reader;
        this.writer = writer;
        this.store = store ?? new InMemoryActionExecutionStore();
        this.defaultLeagueExternalId = leagueExternalId;
        this.actor = "pmt-executor";
        this.now = () => new Date();
    }
    async execute(actionId, options = {}) {
        const existingLock = this.locks.get(actionId);
        if (existingLock)
            return existingLock;
        const execution = this.executeOnce(actionId, options);
        this.locks.set(actionId, execution);
        try {
            return await execution;
        }
        finally {
            this.locks.delete(actionId);
        }
    }
    async executeOnce(actionId, options) {
        const queued = await this.queue.get(actionId);
        if (!queued)
            throw new Error(`Action ${actionId} not found in queue.`);
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
            const existingReceipt = await this.store.getReceipt(actionId);
            if (existingReceipt && existingReceipt.payloadHash === payloadHash && existingReceipt.idempotencyKey === idempotencyKey) {
                await this.syncQueueToReceipt(actionId, existingReceipt);
                return {
                    actionId,
                    status: existingReceipt.status === "executed" ? "already_executed" : existingReceipt.status,
                    receipt: existingReceipt,
                    reason: existingReceipt.status === "unknown" ? "Submission outcome is unknown; no retry was attempted." : undefined
                };
            }
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
            if (current?.status === "approved")
                await this.queue.markBlocked(actionId);
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
        const startedReceipt = {
            receiptId: `rcpt-${queued.actionId}`,
            actionId: queued.actionId,
            idempotencyKey,
            payloadHash,
            approvedBy: queued.approvedBy,
            status: "unknown",
            recordedAt: this.now().toISOString()
        };
        if (this.store.reserveReceipt) {
            if (!await this.store.reserveReceipt(startedReceipt)) {
                const winner = await this.store.getReceipt(actionId);
                if (winner) {
                    await this.syncQueueToReceipt(actionId, winner);
                    return {
                        actionId,
                        status: winner.status === "executed" ? "already_executed" : winner.status,
                        receipt: winner,
                        reason: "Another executor reserved this action; no retry was attempted."
                    };
                }
                return { actionId, status: "unknown", reason: "Another executor reserved this action; no retry was attempted." };
            }
        }
        else {
            await this.store.saveReceipt(startedReceipt);
        }
        const started = startedReceipt;
        await this.audit(queued, payloadHash, idempotencyKey, "submission_started");
        let response;
        try {
            response = await this.write(leagueExternalId, queued.action);
        }
        catch (error) {
            const receipt = {
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
        const receipt = {
            ...started,
            status: "executed",
            completedAt: this.now().toISOString(),
            response
        };
        await this.store.saveReceipt(receipt);
        try {
            await this.queue.markExecuted(actionId);
        }
        catch (error) {
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
    async revalidate(action, leagueExternalId, preconditions) {
        if (preconditions?.leagueExternalId && preconditions.leagueExternalId !== leagueExternalId) {
            return { reason: "league_precondition_mismatch" };
        }
        const teamIds = actionTeams(action);
        for (const teamId of Object.keys(preconditions?.expectedRosterHashes ?? {}))
            teamIds.add(teamId);
        const rosters = new Map();
        try {
            const freshReader = this.reader;
            if (freshReader.getLeagueFresh) {
                const fresh = await freshReader.getLeagueFresh();
                if (preconditions?.scoringPeriod && fresh.scoringPeriodId !== undefined) {
                    const season = fresh.seasonId ?? preconditions.scoringPeriod.slice(0, 4);
                    if (!sameScoringPeriod(`${season}-W${fresh.scoringPeriodId}`, preconditions.scoringPeriod))
                        return { reason: "scoring_period_precondition_mismatch" };
                }
            }
            for (const teamId of teamIds) {
                rosters.set(teamId, await this.reader.getRoster(leagueExternalId, teamId));
            }
        }
        catch (error) {
            return { reason: "roster_revalidation_failed", details: { error: errorMessage(error) } };
        }
        for (const [teamId, expectedHash] of Object.entries(preconditions?.expectedRosterHashes ?? {})) {
            const current = rosters.get(teamId);
            if (!current || rosterFingerprint(current) !== expectedHash) {
                return { reason: `roster_precondition_mismatch:${teamId}` };
            }
        }
        const needsFreeAgents = action.type === "add_drop" || action.type === "waiver_claim" || preconditions?.expectedFreeAgentIds;
        let freeAgentIds;
        if (needsFreeAgents) {
            try {
                freeAgentIds = new Set((await this.reader.getFreeAgents(leagueExternalId)).map((player) => player.player_id));
            }
            catch (error) {
                return { reason: "free_agent_revalidation_failed", details: { error: errorMessage(error) } };
            }
            if (preconditions?.expectedFreeAgentIds && !sameIds(freeAgentIds, preconditions.expectedFreeAgentIds)) {
                return { reason: "free_agent_precondition_mismatch" };
            }
        }
        const needsWaiverState = action.type === "waiver_claim" || preconditions?.expectedFaabBudgets;
        let waiverState;
        if (needsWaiverState) {
            try {
                waiverState = await this.reader.getWaiverState(leagueExternalId);
            }
            catch (error) {
                return { reason: "waiver_state_revalidation_failed", details: { error: errorMessage(error) } };
            }
            for (const [teamId, expectedBudget] of Object.entries(preconditions?.expectedFaabBudgets ?? {})) {
                if (waiverState.faab_budgets[teamId] !== expectedBudget) {
                    return { reason: `faab_precondition_mismatch:${teamId}` };
                }
            }
        }
        const state = { rosters, freeAgentIds, waiverState };
        const semanticFailure = validateAction(action, state);
        return semanticFailure ?? state;
    }
    async write(leagueExternalId, action) {
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
    async saveReceipt(queued, payloadHash, idempotencyKey, status, error) {
        const receipt = {
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
    async syncQueueToReceipt(actionId, receipt) {
        if (receipt.status === "executed")
            await this.queue.markExecuted(actionId);
        if (receipt.status === "unknown")
            await this.queue.markUnknown(actionId);
        if (receipt.status === "blocked")
            await this.queue.markBlocked(actionId);
    }
    async audit(queued, payloadHash, idempotencyKey, event, details) {
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
    isExpired(action) {
        const expiresAt = new Date(action.expiresAt).getTime();
        return !Number.isFinite(expiresAt) || expiresAt <= this.now().getTime();
    }
}
export function rosterFingerprint(roster) {
    const normalized = (slots) => slots.map((slot) => ({
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
function actionTeams(action) {
    switch (action.type) {
        case "set_roster":
        case "add_drop":
        case "waiver_claim":
            return new Set([action.teamId]);
        case "propose_trade":
            return new Set([action.fromTeamId, action.toTeamId]);
    }
}
function validateAction(action, state) {
    switch (action.type) {
        case "set_roster": {
            const roster = state.rosters.get(action.teamId);
            if (!roster)
                return { reason: `team_roster_missing:${action.teamId}` };
            const currentSlots = allSlots(roster);
            const currentPlayers = new Set(currentSlots.flatMap((slot) => slot.player_id ? [slot.player_id] : []));
            const starterIds = action.starters.map((starter) => starter.playerId);
            if (new Set(starterIds).size !== starterIds.length)
                return { reason: "duplicate_starter_player" };
            if (starterIds.some((playerId) => !currentPlayers.has(playerId)))
                return { reason: "starter_not_on_current_roster" };
            for (const slot of currentSlots.filter((item) => item.locked && item.player_id)) {
                const assignment = action.starters.find((starter) => starter.playerId === slot.player_id);
                if (assignment && assignment.slot !== slot.slot_type)
                    return { reason: `locked_player_change:${slot.player_id}` };
                if (slot.slot_type !== "BN" && slot.slot_type !== "IR" && !assignment) {
                    return { reason: `locked_player_removed:${slot.player_id}` };
                }
            }
            return undefined;
        }
        case "add_drop": {
            const roster = state.rosters.get(action.teamId);
            if (!roster || !state.freeAgentIds)
                return { reason: "add_drop_state_missing" };
            if (hasDuplicates(action.addPlayerIds) || hasDuplicates(action.dropPlayerIds)) {
                return { reason: "duplicate_add_drop_player" };
            }
            if (action.addPlayerIds.some((playerId) => action.dropPlayerIds.includes(playerId))) {
                return { reason: "player_both_added_and_dropped" };
            }
            const owned = new Set(allSlots(roster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
            if (action.addPlayerIds.some((playerId) => !state.freeAgentIds?.has(playerId)))
                return { reason: "add_player_not_free" };
            if (action.dropPlayerIds.some((playerId) => !owned.has(playerId)))
                return { reason: "drop_player_not_owned" };
            if (action.dropPlayerIds.some((playerId) => allSlots(roster).some((slot) => slot.player_id === playerId && slot.locked))) {
                return { reason: "locked_drop_player" };
            }
            return undefined;
        }
        case "waiver_claim": {
            const roster = state.rosters.get(action.teamId);
            if (!roster || !state.freeAgentIds || !state.waiverState)
                return { reason: "waiver_state_missing" };
            if (!action.addPlayerId)
                return { reason: "waiver_add_player_missing" };
            if (action.dropPlayerId === action.addPlayerId)
                return { reason: "waiver_player_both_added_and_dropped" };
            if (!state.freeAgentIds.has(action.addPlayerId))
                return { reason: "waiver_add_player_not_free" };
            const owned = new Set(allSlots(roster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
            if (action.dropPlayerId && !owned.has(action.dropPlayerId))
                return { reason: "waiver_drop_player_not_owned" };
            if (action.dropPlayerId && allSlots(roster).some((slot) => slot.player_id === action.dropPlayerId && slot.locked)) {
                return { reason: "locked_waiver_drop_player" };
            }
            if (action.faabBid !== undefined) {
                if (!Number.isInteger(action.faabBid) || action.faabBid < 0)
                    return { reason: "invalid_faab_bid" };
                const budget = state.waiverState.faab_budgets[action.teamId];
                if (budget === undefined)
                    return { reason: "faab_budget_unavailable" };
                if (action.faabBid > budget)
                    return { reason: "faab_bid_exceeds_budget" };
            }
            return undefined;
        }
        case "propose_trade": {
            if (action.fromTeamId === action.toTeamId)
                return { reason: "trade_teams_must_differ" };
            const fromRoster = state.rosters.get(action.fromTeamId);
            const toRoster = state.rosters.get(action.toTeamId);
            if (!fromRoster || !toRoster)
                return { reason: "trade_roster_missing" };
            if (hasDuplicates(action.givePlayerIds) || hasDuplicates(action.receivePlayerIds)) {
                return { reason: "duplicate_trade_player" };
            }
            const give = new Set(allSlots(fromRoster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
            const receive = new Set(allSlots(toRoster).flatMap((slot) => slot.player_id ? [slot.player_id] : []));
            if (action.givePlayerIds.some((playerId) => !give.has(playerId)))
                return { reason: "trade_give_player_not_owned" };
            if (action.receivePlayerIds.some((playerId) => !receive.has(playerId)))
                return { reason: "trade_receive_player_not_owned" };
            if ([...action.givePlayerIds, ...action.receivePlayerIds].some((playerId) => allSlots(fromRoster).some((slot) => slot.player_id === playerId && slot.locked)
                || allSlots(toRoster).some((slot) => slot.player_id === playerId && slot.locked)))
                return { reason: "locked_trade_player" };
            return undefined;
        }
    }
}
function allSlots(roster) {
    return [...roster.starters, ...roster.bench, ...roster.injured_reserve, ...roster.taxi];
}
function hasDuplicates(values) {
    return new Set(values).size !== values.length;
}
function sameIds(current, expected) {
    return current.size === new Set(expected).size && [...current].every((id) => expected.includes(id));
}
function isRevalidatedState(value) {
    return "rosters" in value;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isOptions(value) {
    return "queue" in value && "reader" in value && "writer" in value;
}
export { SqliteActionExecutionStore } from "./sqlite-action-execution-store.js";

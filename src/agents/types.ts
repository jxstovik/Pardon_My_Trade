import type { PlayerPosition } from "../models/types.js";

export type AgentActionType = "set_roster" | "add_drop" | "waiver_claim" | "propose_trade";
export type RiskLevel = "low" | "medium" | "high";
export type ActionStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "blocked" | "unknown";

export interface RosterSlotInput {
  readonly playerId: string;
  readonly slot: PlayerPosition;
}

export interface FreeAgentInput {
  readonly playerId: string;
  readonly position: PlayerPosition;
  readonly projectedPoints: number;
}

export interface OpponentInput {
  readonly teamId: string;
  readonly players: ReadonlyArray<{ readonly playerId: string; readonly position: PlayerPosition }>;
}

export interface OrchestratorInput {
  readonly teamId: string;
  readonly rosterSlots: ReadonlyArray<RosterSlotInput>;
  readonly starterCounts: ReadonlyArray<{ readonly slot: PlayerPosition; readonly count: number }>;
  readonly freeAgents: ReadonlyArray<FreeAgentInput>;
  readonly opponents?: ReadonlyArray<OpponentInput>;
  readonly autoApproveLowRisk?: boolean;
}

export interface SetRosterAction {
  readonly type: "set_roster";
  readonly teamId: string;
  readonly starters: RosterSlotInput[];
}

export interface AddDropAction {
  readonly type: "add_drop";
  readonly teamId: string;
  readonly addPlayerIds: string[];
  readonly dropPlayerIds: string[];
}

/**
 * A waiver claim is deliberately distinct from an immediate free-agent add.
 * `faabBid` is omitted for priority/rolling waivers and is the bid amount for
 * FAAB leagues. A claim has one add and an optional drop to keep the platform
 * writer contract unambiguous.
 */
export interface WaiverClaimAction {
  readonly type: "waiver_claim";
  readonly teamId: string;
  readonly addPlayerId: string;
  readonly dropPlayerId?: string;
  readonly faabBid?: number;
}

export interface ProposeTradeAction {
  readonly type: "propose_trade";
  readonly fromTeamId: string;
  readonly toTeamId: string;
  readonly givePlayerIds: string[];
  readonly receivePlayerIds: string[];
}

export type AgentAction = SetRosterAction | AddDropAction | WaiverClaimAction | ProposeTradeAction;

export interface ActionPreconditions {
  /** The league the approval was created for. */
  readonly leagueExternalId?: string;
  /** Hashes produced from the current canonical roster at proposal time. */
  readonly expectedRosterHashes?: Readonly<Record<string, string>>;
  /** Optional exact free-agent universe captured at proposal time. */
  readonly expectedFreeAgentIds?: ReadonlyArray<string>;
  /** Optional FAAB balances captured at proposal time. */
  readonly expectedFaabBudgets?: Readonly<Record<string, number>>;
}

export interface ActionEnqueueOptions {
  readonly ttlMs?: number;
  readonly idempotencyKey?: string;
  readonly preconditions?: ActionPreconditions;
}

export interface QueuedAction {
  readonly actionId: string;
  readonly action: AgentAction;
  readonly risk: RiskLevel;
  readonly rationale: string;
  readonly status: ActionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly resolvedAt?: string;
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly resolvedBy?: string;
  /** SHA-256 of the canonical action payload. */
  readonly payloadHash?: string;
  /** Stable key used by the executor to prevent duplicate submissions. */
  readonly idempotencyKey?: string;
  readonly preconditions?: ActionPreconditions;
}

export interface OrchestratorResult {
  readonly teamId: string;
  readonly lineup: RosterSlotInput[];
  readonly lineupExpectedPoints: number;
  readonly waiverCandidates: AddDropAction[];
  readonly tradeCandidates: ProposeTradeAction[];
  readonly queued: QueuedAction[];
  readonly executed: AgentAction[];
  readonly executedAt: string;
}

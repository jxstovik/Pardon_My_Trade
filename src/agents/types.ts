import type { PlayerPosition } from "../models/types.js";

export type AgentActionType = "set_roster" | "add_drop" | "propose_trade";
export type RiskLevel = "low" | "medium" | "high";
export type ActionStatus = "pending" | "approved" | "rejected" | "expired" | "executed";
export type ActionExecutionStatus = "running" | "succeeded" | "failed";

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

export interface ProposeTradeAction {
  readonly type: "propose_trade";
  readonly fromTeamId: string;
  readonly toTeamId: string;
  readonly givePlayerIds: string[];
  readonly receivePlayerIds: string[];
}

export type AgentAction = SetRosterAction | AddDropAction | ProposeTradeAction;

export interface ActionExecutionError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export interface ActionExecution<TProviderResponse = unknown> {
  readonly status: ActionExecutionStatus;
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly providerResponse?: TProviderResponse;
  readonly error?: ActionExecutionError;
}

export interface QueuedAction<TAction extends AgentAction = AgentAction, TProviderResponse = unknown> {
  readonly actionId: string;
  readonly action: TAction;
  readonly risk: RiskLevel;
  readonly rationale: string;
  readonly status: ActionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly resolvedAt?: string;
  readonly execution?: ActionExecution<TProviderResponse>;
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

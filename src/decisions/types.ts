import type { LeagueSnapshot, Player, PlayerPosition, Projection, RosterSlot } from "../models/types.js";

export interface LineupSwap {
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly playerInId: string;
  readonly playerOutId: string;
  readonly projectedDelta: number;
}

export interface LineupCandidate {
  readonly candidateId: string;
  readonly teamId: string;
  readonly proposedStarters: RosterSlot[];
  readonly projectedPoints: number;
  readonly swaps: LineupSwap[];
  readonly confidence: number;
  readonly rationale: string;
}

export interface WaiverCandidate {
  readonly candidateId: string;
  readonly teamId: string;
  readonly addPlayerId: string;
  readonly dropPlayerId?: string;
  readonly projectedDelta: number;
  readonly bidGuidance?: number;
  readonly confidence: number;
  readonly rationale: string;
}

export interface DropCandidate {
  readonly candidateId: string;
  readonly teamId: string;
  readonly dropPlayerId: string;
  readonly reason: string;
  readonly confidence: number;
}

export interface TradeCandidate {
  readonly candidateId: string;
  readonly teamId: string;
  readonly partnerTeamId: string;
  readonly incomingPlayerId: string;
  readonly outgoingPlayerId: string;
  readonly projectedDelta: number;
  readonly confidence: number;
  readonly rationale: string;
}

export interface WeeklyReportInputs {
  readonly leagueId: string;
  readonly teamId: string;
  readonly currentProjectedPoints: number;
  readonly lineupCandidates: LineupCandidate[];
  readonly waiverCandidates: WaiverCandidate[];
  readonly dropCandidates: DropCandidate[];
  readonly tradeCandidates: TradeCandidate[];
  readonly notes: string[];
}

import { actionPayloadHash, type ActionQueue } from "./action-queue.js";
import type { ActionExecutionResult } from "./action-executor.js";
import type { QueuedAction } from "./types.js";

export interface LineupAuthorization {
  readonly enabled: boolean;
  readonly leagueId: string;
  readonly teamId: string;
  readonly season: string;
  readonly authorizedBy: string;
}

/** Standing permission covers owned-player lineup assignments only. */
export function validateLineupAuthorization(
  authorization: LineupAuthorization,
  queued: QueuedAction,
  now = new Date()
): void {
  if (authorization.enabled !== true || !authorization.authorizedBy?.trim()) throw new Error("Automatic lineups are disabled or unauthorized.");
  if (queued.action.type !== "set_roster" || queued.risk !== "low") throw new Error("Automatic authorization covers low-risk set_roster only.");
  if (queued.action.teamId !== authorization.teamId || queued.preconditions?.leagueExternalId !== authorization.leagueId) throw new Error("Lineup authorization scope mismatch.");
  const period = /^(\d{4})-W(\d{1,2})$/.exec(queued.preconditions.scoringPeriod ?? "");
  if (!period || period[1] !== authorization.season || Number(period[2]) < 1 || Number(period[2]) > 18) throw new Error("Lineup authorization season or period mismatch.");
  if (!queued.preconditions.expectedRosterHashes?.[authorization.teamId]) throw new Error("A fresh roster fingerprint is required.");
  if (queued.payloadHash !== actionPayloadHash(queued.action)) throw new Error("Lineup payload hash mismatch.");
  if (!Number.isFinite(Date.parse(queued.expiresAt)) || Date.parse(queued.expiresAt) <= now.getTime()) throw new Error("Lineup proposal expired.");
  if (!["pending", "approved"].includes(queued.status)) throw new Error(`Lineup is ${queued.status}; reconcile existing receipts before preparing another action.`);
}

export async function executeAutomaticLineup(options: {
  authorization: LineupAuthorization;
  actionId: string;
  queue: ActionQueue;
  /** Must perform fresh platform scope, period, roster, eligibility and lock checks. */
  preview: (queued: QueuedAction) => Promise<void>;
  executor: { execute: (actionId: string, options: { leagueExternalId: string }) => Promise<ActionExecutionResult> };
}): Promise<ActionExecutionResult> {
  const queued = await options.queue.get(options.actionId);
  if (!queued) throw new Error("Lineup action not found.");
  validateLineupAuthorization(options.authorization, queued);
  await options.preview(queued);
  // Recheck after I/O. Queue CAS and executor receipt reservation handle races.
  const current = await options.queue.get(options.actionId);
  if (!current || current.payloadHash !== queued.payloadHash) throw new Error("Lineup changed during preview.");
  validateLineupAuthorization(options.authorization, current);
  if (current.status === "pending") await options.queue.approve(current.actionId, `standing-lineup:${options.authorization.authorizedBy}`);
  return options.executor.execute(current.actionId, { leagueExternalId: options.authorization.leagueId });
}

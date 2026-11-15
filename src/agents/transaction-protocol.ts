import type { ActionReceipt } from "./action-executor.js";
import type { QueuedAction } from "./types.js";
import type { HorizonPlayer } from "./waiver-lineup-probability.js";
import { sameScoringPeriod } from "../models/scoring-period.js";

/** Count durable submissions plus external pending reservations, never a plan. */
export function acquisitionCapacity(actions: QueuedAction[], receipts: ActionReceipt[], pendingAddIds: string[], scope: { leagueId: string; teamId: string; period: string }, limit = 5) {
  const relevant = actions.filter(q => q.preconditions?.leagueExternalId === scope.leagueId && q.action.type !== "propose_trade" && q.action.teamId === scope.teamId && ["add_drop", "waiver_claim"].includes(q.action.type));
  const byId = new Map(relevant.map(q => [q.actionId, q]));
  if (receipts.some(r => r.status === "unknown" && byId.has(r.actionId))) throw new Error("Unresolved acquisition receipt; reconcile before any further submission.");
  const executed = receipts.filter(r => r.status === "executed" && sameScoringPeriod(byId.get(r.actionId)?.preconditions?.scoringPeriod ?? "", scope.period));
  const reservedAdds = new Set(executed.flatMap(r => {
    const a = byId.get(r.actionId)!.action;
    return a.type === "waiver_claim" ? [a.addPlayerId] : [];
  }));
  const externalPending = new Set(pendingAddIds.filter(id => !reservedAdds.has(id)));
  const used = executed.length + externalPending.size;
  // Submitted claims conservatively consume capacity until their award/failure
  // is reconciled. Never infer a failed claim from one missing platform view.
  return { used, remaining: Math.max(0, limit - used), limit };
}

export interface RecoveryEvidence {
  playerId: string;
  sourceUrl: string;
  publishedAt: string;
  quote: string;
  /** Inclusive bounds inferred from a sourced report, not a recovery probability. */
  earliestReturnWeek?: number;
  latestReturnWeek?: number;
}

/** Conservative comparison: owned player returns early; acquisition returns late.
 * With no reliable date, assume the owned player can return immediately. An
 * active replacement must beat that healthy-return baseline to justify a drop.
 */
export function injuryScenario(healthy: HorizonPlayer, evidence: RecoveryEvidence | undefined, owned: boolean, targetWeek: number, now = new Date()): HorizonPlayer {
  if (evidence) {
    const time = Date.parse(evidence.publishedAt);
    if (evidence.playerId !== healthy.playerId || !/^https:\/\//.test(evidence.sourceUrl) || !evidence.quote?.trim() || !Number.isFinite(time) || time > now.getTime() || now.getTime() - time > 7 * 86400000) throw new Error("Injury evidence is missing provenance or stale.");
    const low = evidence.earliestReturnWeek, high = evidence.latestReturnWeek;
    if ((low !== undefined && (!Number.isInteger(low) || low < targetWeek || low > 19)) ||
        (high !== undefined && (!Number.isInteger(high) || high < targetWeek || high > 19)) ||
        (low !== undefined && high !== undefined && low > high)) throw new Error("Invalid sourced injury return window.");
  }
  const returnWeek = owned ? evidence?.earliestReturnWeek ?? targetWeek : evidence?.latestReturnWeek ?? 19;
  return { ...healthy, weeks: healthy.weeks.map(w => w.week >= returnWeek ? w : { ...w, mean: 0, playing: false, quantiles: Object.fromEntries(Object.keys(w.quantiles ?? {}).map(k => [k, 0])) }) };
}

import type { PlatformReader } from "../adapters/platform-reader.js";
import { parseEspnWaiverSettings } from "../adapters/espn/espn-waiver-settings.js";
import { rosterFingerprint } from "../agents/action-executor.js";
import type { ActionQueue } from "../agents/action-queue.js";
import type { WaiverClaimAction } from "../agents/types.js";

export interface WaiverReader extends PlatformReader {
  getLeagueFresh?: () => Promise<{
    id?: number; seasonId?: number; scoringPeriodId?: number;
    settings?: { acquisitionSettings?: Record<string, unknown> };
    teams?: Array<{ id: number; name?: string; waiverRank?: number }>;
  }>;
  getAcquisitionStatus?: (leagueId: string, playerId: string) => Promise<string | undefined>;
}

export async function readWaiverContext(reader: WaiverReader, leagueId: string, teamId: string) {
  if (!reader.getLeagueFresh) throw new Error("Fresh ESPN waiver settings unavailable.");
  const fresh = await reader.getLeagueFresh();
  if (String(fresh.id) !== leagueId || !fresh.seasonId || !fresh.scoringPeriodId) throw new Error("ESPN waiver scope or period mismatch.");
  const team = fresh.teams?.find(team => String(team.id) === teamId);
  if (!team) throw new Error("Waiver team missing from live league.");
  if (!fresh.settings?.acquisitionSettings) throw new Error("Live acquisition settings unavailable.");
  const settings = parseEspnWaiverSettings(fresh.settings.acquisitionSettings);
  const state = await reader.getWaiverState(leagueId);
  return { leagueId, teamId, teamName: team.name, season: fresh.seasonId, scoringPeriod: `${fresh.seasonId}-W${fresh.scoringPeriodId}`,
    settings, teamWaiverRank: team.waiverRank ?? null, waiverOrder: state.waiver_order,
    faabBalance: settings.type === "faab" ? state.faab_budgets[teamId] ?? null : null,
    readAt: new Date().toISOString(),
    note: "Claim priority is your preference among claims, not your league waiver rank. Successful claims move a team to the back; weekly resets follow league settings. ESPN controls processing time and awards." };
}

/** Prepare one exact preference at a time; changing a preference requires a new approval. */
export async function prepareWaiverClaim(reader: WaiverReader, queue: ActionQueue, leagueId: string, action: WaiverClaimAction, options: { idempotencyKey?: string; rationale?: string } = {}) {
  const context = await readWaiverContext(reader, leagueId, action.teamId);
  if (context.settings.type === "none") throw new Error("League does not use waivers.");
  if (!Number.isSafeInteger(action.priority) || action.priority! < 1) throw new Error("An explicit positive claim priority is required.");
  if (context.settings.type === "rolling" && action.faabBid !== undefined) throw new Error("Traditional waiver leagues do not accept FAAB bids.");
  if (context.settings.type === "faab" && (action.faabBid === undefined || !Number.isSafeInteger(action.faabBid) || action.faabBid < (context.settings.minimum_bid ?? 0) || context.faabBalance === null || action.faabBid > context.faabBalance)) throw new Error("A valid bid within the current FAAB balance is required.");
  if (!reader.getAcquisitionStatus || await reader.getAcquisitionStatus(leagueId, action.addPlayerId) !== "WAIVERS") throw new Error("Requested player is not currently on waivers.");
  const roster = await reader.getRoster(leagueId, action.teamId);
  const slots = [...roster.starters, ...roster.bench, ...roster.injured_reserve, ...roster.taxi];
  if (slots.some(slot => slot.player_id === action.addPlayerId)) throw new Error("Add player already owned.");
  if (action.dropPlayerId) {
    const drop = slots.find(slot => slot.player_id === action.dropPlayerId);
    if (!drop || drop.locked || action.addPlayerId === action.dropPlayerId) throw new Error("Drop must be a distinct, owned, unlocked player.");
  } else {
    // Reserve/IR slots do not create an active-roster vacancy.
    if (![...roster.starters, ...roster.bench].some(slot => !slot.player_id)) throw new Error("No active roster vacancy; supply an exact conditional drop.");
  }
  const pending = (await queue.pending()).filter(row => Date.parse(row.expiresAt) > Date.now() && row.preconditions?.leagueExternalId === leagueId && row.action.type === "waiver_claim" && row.action.teamId === action.teamId);
  const existing = pending.find(row => row.payloadHash && row.action.type === "waiver_claim" && row.action.priority === action.priority && row.action.addPlayerId === action.addPlayerId && row.action.dropPlayerId === action.dropPlayerId && row.action.faabBid === action.faabBid);
  if (existing && (!options.idempotencyKey || existing.idempotencyKey === options.idempotencyKey) && existing.preconditions?.scoringPeriod === context.scoringPeriod && existing.preconditions?.expectedRosterHashes?.[action.teamId] === rosterFingerprint(roster)) return { action: existing, context, execution_allowed: false };
  if (pending.some(row => row.action.type === "waiver_claim" && (row.action.priority === action.priority || row.action.addPlayerId === action.addPlayerId))) throw new Error("A pending PMT claim already uses this priority or player; reject it before preparing a replacement.");
  const queued = await queue.enqueue(action, "high", options.rationale ?? `Waiver preference ${action.priority}: add ${action.addPlayerId}${action.dropPlayerId ? `; conditional drop ${action.dropPlayerId}` : ""}. League waiver rank ${context.teamWaiverRank ?? "unknown"}.`, {
    ttlMs: 30 * 60 * 1000, idempotencyKey: options.idempotencyKey,
    preconditions: { leagueExternalId: leagueId, scoringPeriod: context.scoringPeriod, expectedRosterHashes: { [action.teamId]: rosterFingerprint(roster) }, ...(context.faabBalance === null ? {} : { expectedFaabBudgets: { [action.teamId]: context.faabBalance } }) }
  });
  return { action: queued, context, execution_allowed: false, note: "Review, approve, then execute this exact claim. Submission is not an award. Existing ESPN claims are not reordered or canceled; inspect Pending Moves before execution." };
}

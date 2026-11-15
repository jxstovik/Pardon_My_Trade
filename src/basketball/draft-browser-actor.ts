import { canCompleteRoster, snakeTeam } from "./draft.js";
import type { DraftBoard, PlayerForecast } from "./forecast.js";
import type { CopilotState, MockPickIntent } from "./copilot-contracts.js";

const MAX_RECEIPT_AGE_MS = 5_000;
const MAX_INTENT_TTL_MS = 60_000;
const MIN_CLOCK_BUFFER_SECONDS = 15;

function loopbackPage(state: CopilotState): boolean {
  try {
    const url = new URL(state.observation.pageUrl);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) &&
      !url.username && !url.password;
  } catch { return false; }
}

function samePick(a: {overall:number;teamId:string;playerId:string}, b: {overall:number;teamId:string;playerId:string}): boolean {
  return a.overall === b.overall && a.teamId === b.teamId && a.playerId === b.playerId;
}

function playerFor(board: DraftBoard, id: string): PlayerForecast | undefined {
  return board.rows.find(player => player.fantraxId === id);
}

/** A narrow gate for the local simulator. It never grants a Fantrax capability. */
export function guardMockPick(board: DraftBoard, state: CopilotState, intent: MockPickIntent, asOf: Date): {allowed:boolean;reasons:string[]} {
  const reasons: string[] = [];
  const now = asOf.getTime();
  const received = Date.parse(state.observation.receivedAt);
  const observed = Date.parse(state.session.observedAt);
  const expires = Date.parse(intent.expiresAt);
  const session = state.session;

  if (state.status !== "ready" || state.issues.length > 0) reasons.push("Reconciled draft state is not ready");
  if (state.paused) reasons.push("Mock draft is paused");
  if (state.observation.venue !== "local-mock" || session.sourceKind !== "local-simulator" || !loopbackPage(state)) {
    reasons.push("Pick actions are restricted to the isolated local mock");
  }
  if (!state.observation.completeHistory || !state.observation.identityVerified) reasons.push("Mock state lacks complete stable-ID history");
  if (!Number.isInteger(state.observation.sequence) || state.observation.sequence < 1) reasons.push("Mock observation sequence is invalid");
  if (session.leagueId !== board.leagueId || session.teamId !== board.teamId || session.boardRevision !== board.revision) {
    reasons.push("Mock state does not match the configured board scope");
  }
  if (intent.sessionId !== state.observation.sessionId) reasons.push("Intent belongs to a different mock session");
  if (intent.stateRevision !== state.revision) reasons.push("Intent was invalidated by a newer draft revision");
  if (!Number.isFinite(now) || !Number.isFinite(received) || !Number.isFinite(observed) || received > now || observed > received ||
      now - received > MAX_RECEIPT_AGE_MS || now - observed > MAX_RECEIPT_AGE_MS || received - observed > 20_000) {
    reasons.push("Mock observation is stale or has inconsistent acquisition times");
  }
  if (!Number.isFinite(expires) || expires <= now || expires - now > MAX_INTENT_TTL_MS) {
    reasons.push("Mock pick intent is expired or has an invalid expiry");
  }

  const picks = session.picks;
  const nextOverall = picks.length + 1;
  if (session.phase !== "live") reasons.push("Draft is not in the live phase");
  if (picks.length >= 112 || intent.overall !== nextOverall) reasons.push("Intent does not target the next overall pick");
  if (intent.teamId !== session.teamId || intent.teamId !== board.teamId) reasons.push("Intent does not target the configured team");
  let expectedTeam: string | null = null;
  try { expectedTeam = snakeTeam(session.teamOrder, nextOverall); }
  catch { reasons.push("Mock team order is invalid"); }
  if (expectedTeam !== session.teamId || state.observation.currentTeamId !== session.teamId) {
    reasons.push("It is not the configured team's observed turn");
  }
  const effectiveClock = state.observation.clockSeconds === null ? null : state.observation.clockSeconds - Math.max(0,(now-observed)/1000);
  if (effectiveClock === null || effectiveClock < MIN_CLOCK_BUFFER_SECONDS) {
    reasons.push("Mock clock is missing or inside the safety buffer");
  }

  if (new Set(picks.map(pick => pick.playerId)).size !== picks.length || picks.some(pick => pick.playerId === intent.playerId)) {
    reasons.push("Player is already selected or the mock history has duplicate identities");
  }
  const player = playerFor(board, intent.playerId);
  if (!player) reasons.push("Player is not in the forecasted available pool");
  else if (board.statusObservations.some(status => status.fantraxId === player.fantraxId)) {
    reasons.push("Player has a blocking status observation");
  }
  if (session.unavailablePlayerIds.includes(intent.playerId)) reasons.push("Player is marked unavailable in the reconciled session");
  if (!(intent.slot === "G" || intent.slot === "F/C" || intent.slot === "Flx" || intent.slot === "Res")) {
    reasons.push("Requested mock roster slot is invalid");
  } else if (player && intent.slot !== "Flx" && intent.slot !== "Res" && !player.eligibleGroups.includes(intent.slot)) {
    reasons.push("Player is not eligible for the requested mock roster slot");
  }

  if (player && session.picks.filter(pick => pick.teamId === session.teamId).length >= 14) {
    reasons.push("Configured team roster is already full");
  }
  if (player) {
    const owned = session.picks.filter(pick => pick.teamId === session.teamId).map(pick => playerFor(board, pick.playerId));
    const ownedPlayers = owned.filter((item): item is PlayerForecast => item !== undefined);
    if (ownedPlayers.length !== owned.length || !canCompleteRoster([...ownedPlayers, player])) {
      reasons.push("Pick would make the configured roster impossible to complete legally");
    }
  }

  return {allowed: reasons.length === 0, reasons};
}

/** Accept only an authoritative full-history receipt for exactly the intended mock pick. */
export function verifyMockPickReceipt(before: CopilotState, after: CopilotState, intent: MockPickIntent): boolean {
  if (before.status !== "ready" || after.status !== "ready" || before.issues.length > 0 || after.issues.length > 0 || before.paused ||
      before.observation.venue !== "local-mock" || after.observation.venue !== "local-mock" ||
      before.session.sourceKind !== "local-simulator" || after.session.sourceKind !== "local-simulator" ||
      !loopbackPage(before) || !loopbackPage(after) ||
      !before.observation.completeHistory || !after.observation.completeHistory ||
      !before.observation.identityVerified || !after.observation.identityVerified) return false;
  if (intent.sessionId !== before.observation.sessionId || intent.sessionId !== after.observation.sessionId ||
      intent.stateRevision !== before.revision || before.revision === after.revision) return false;
  if (before.session.leagueId !== after.session.leagueId || before.session.teamId !== after.session.teamId ||
      before.session.boardRevision !== after.session.boardRevision || before.session.teamId !== intent.teamId ||
      JSON.stringify(before.session.teamOrder) !== JSON.stringify(after.session.teamOrder) ||
      before.session.phase !== "live" || before.observation.currentTeamId !== intent.teamId ||
      intent.overall !== before.session.picks.length + 1 || intent.overall > 112) return false;
  let expected: string;
  try { expected = snakeTeam(before.session.teamOrder, intent.overall); }
  catch { return false; }
  const beforeReceived = Date.parse(before.observation.receivedAt), afterReceived = Date.parse(after.observation.receivedAt);
  const afterObserved = Date.parse(after.session.observedAt);
  if (expected !== intent.teamId || !Number.isInteger(intent.overall) || !Number.isInteger(before.observation.sequence) ||
      !Number.isInteger(after.observation.sequence) || after.observation.sequence <= before.observation.sequence ||
      !Number.isFinite(beforeReceived) || !Number.isFinite(afterReceived) || afterReceived < beforeReceived ||
      !Number.isFinite(afterObserved) || afterObserved > afterReceived || after.session.picks.length !== before.session.picks.length + 1) return false;
  if (!before.session.picks.every((pick, index) => samePick(pick, after.session.picks[index]!))) return false;
  const receipt = after.session.picks.at(-1);
  if (!receipt || !samePick(receipt, {overall:intent.overall,teamId:intent.teamId,playerId:intent.playerId})) return false;

  if (intent.overall === 112) {
    return after.session.phase === "complete" && after.observation.currentTeamId === null && after.observation.clockSeconds === null;
  }
  const nextPicker = snakeTeam(after.session.teamOrder, intent.overall + 1);
  return after.session.phase === "live" && after.observation.currentTeamId === nextPicker && after.observation.clockSeconds !== null;
}


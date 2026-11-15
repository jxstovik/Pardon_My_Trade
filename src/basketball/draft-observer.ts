import { contentHash } from "./store.js";
import { DraftSessionSchema, snakeTeam, type DraftSession } from "./draft.js";
import { DraftObservationSchema, type CopilotState, type DraftObservation } from "./copilot-contracts.js";
import type { DraftBoard } from "./forecast.js";

const MAX_OBSERVATION_AGE_MS = 20_000;
const MAX_OBSERVED_TO_RECEIVED_MS = 20_000;

function validPage(board: DraftBoard, observation: DraftObservation): void {
  let url: URL;
  try { url = new URL(observation.pageUrl); }
  catch { throw new Error("Observation page URL is invalid"); }
  if (url.username || url.password || url.hash) throw new Error("Observation page URL contains untrusted scope data");

  if (observation.venue === "local-mock") {
    if (!(url.protocol === "http:" || url.protocol === "https:") ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
        url.hostname.toLowerCase() === "www.fantrax.com") {
      throw new Error("Local mock observations must come from a loopback page");
    }
    return;
  }

  if (url.protocol !== "https:" || url.hostname !== "www.fantrax.com") {
    throw new Error("Fantrax observation page host does not match its venue");
  }
  if (observation.venue === "fantrax-league") {
    const allowedQuery=new Set(["groupId","sortKey","sortDir","bottomSheetView"]);
    if (url.pathname !== `/fantasy/league/${board.leagueId}/draft` ||
        [...url.searchParams.keys()].some(key=>!allowedQuery.has(key)||url.searchParams.getAll(key).length!==1)||
        [...url.searchParams.values()].some(value=>value.length>160)) {
      throw new Error("Fantrax draft page does not match the configured league");
    }
  } else if (!/^\/game\/mock-draft\/(?:ncaab|nba|wnba|[a-z0-9-]+)\/?$/i.test(url.pathname) || url.search) {
    throw new Error("Fantrax mock observation is outside a mock-draft page");
  }
}

function knownPlayerIds(board: DraftBoard): Set<string> {
  return new Set([...board.rows.map(row => row.fantraxId), ...board.excluded.map(row => row.fantraxId)]);
}

function validateSession(board: DraftBoard, observation: DraftObservation, session: DraftSession, asOf: Date): void {
  if (session.leagueId !== board.leagueId || session.teamId !== board.teamId || session.boardRevision !== board.revision) {
    throw new Error("Draft observation league/team/board scope mismatch");
  }
  if (new Set(session.teamOrder).size !== 8 || !session.teamOrder.includes(session.teamId) ||
      session.teamOrder.some(id => !/^[a-zA-Z0-9_-]{1,160}$/.test(id))) {
    throw new Error("Draft observation has an invalid or duplicate team order");
  }

  const observedMs = Date.parse(session.observedAt);
  const receivedMs = Date.parse(observation.receivedAt);
  const nowMs = asOf.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) || !Number.isFinite(receivedMs)) {
    throw new Error("Draft observation has an invalid acquisition time");
  }
  if (observedMs > receivedMs || receivedMs > nowMs) throw new Error("Draft observation times are future or out of order");
  if (receivedMs - observedMs > MAX_OBSERVED_TO_RECEIVED_MS) throw new Error("Draft observation receipt is too far from source observation time");
  if (nowMs - receivedMs > MAX_OBSERVATION_AGE_MS || nowMs - observedMs > MAX_OBSERVATION_AGE_MS) {
    throw new Error("Draft observation is stale");
  }

  const known = knownPlayerIds(board);
  const selected = new Set<string>();
  session.picks.forEach((pick, index) => {
    const expected = index + 1;
    if (pick.overall !== expected || pick.teamId !== snakeTeam(session.teamOrder, expected)) {
      throw new Error("Draft history is not contiguous or its pick owner violates snake order");
    }
    if (!known.has(pick.playerId) || selected.has(pick.playerId)) {
      throw new Error("Draft history contains an unknown or duplicate stable player ID");
    }
    selected.add(pick.playerId);
  });
  if (session.unavailablePlayerIds.some(id => !known.has(id)) ||
      new Set(session.unavailablePlayerIds).size !== session.unavailablePlayerIds.length) {
    throw new Error("Draft observation contains an unknown or duplicate unavailable player ID");
  }

  if (session.sourceKind === "local-simulator" && observation.venue !== "local-mock") {
    throw new Error("Local simulator state cannot be sourced from Fantrax");
  }
  if (observation.venue === "local-mock" && session.sourceKind !== "local-simulator") {
    throw new Error("Local mock state must use the local simulator source kind");
  }
  if (observation.venue !== "local-mock" && session.sourceKind !== "browser-dom") {
    throw new Error("Fantrax observations require browser DOM evidence");
  }

  if (session.phase === "pre-draft") {
    if (session.picks.length !== 0 || observation.currentTeamId !== null || observation.clockSeconds !== null) {
      throw new Error("Pre-draft observation cannot contain picks, an active team or a running clock");
    }
  } else if (session.phase === "live") {
    if (session.picks.length >= 112 || Date.parse(session.draftStart) > observedMs) {
      throw new Error("Live draft phase is inconsistent with its start time or history");
    }
    const nextTeam = snakeTeam(session.teamOrder, session.picks.length + 1);
    if (observation.currentTeamId !== nextTeam || observation.clockSeconds === null || observation.clockSeconds > 600) {
      throw new Error("Live draft clock or current picker does not match the next snake turn");
    }
  } else {
    if (session.picks.length !== 112 || observation.currentTeamId !== null || observation.clockSeconds !== null ||
        Date.parse(session.draftStart) > observedMs) {
      throw new Error("Completed draft must contain all 112 picks and no active clock");
    }
  }
}

function historyShape(observation: DraftObservation) {
  return {
    sessionId: observation.sessionId,
    venue: observation.venue,
    leagueId: observation.session.leagueId,
    teamId: observation.session.teamId,
    boardRevision: observation.session.boardRevision,
    sourceKind: observation.session.sourceKind,
    draftStart: observation.session.draftStart,
    phase: observation.session.phase,
    teamOrder: observation.session.teamOrder,
    unavailablePlayerIds: observation.session.unavailablePlayerIds,
    picks: observation.session.picks,
    currentTeamId: observation.currentTeamId
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return contentHash(a) === contentHash(b);
}

function revisionGeneration(revision: string): number {
  const match = /^g(\d+)-[a-f0-9]{64}$/.exec(revision);
  return match ? Number(match[1]) : 0;
}

function acceptedState(observation: DraftObservation, previous: CopilotState | null): CopilotState {
  const fingerprint = historyShape(observation);
  const previousFingerprint = previous ? historyShape(previous.observation) : null;
  const changed = !previous || !sameJson(fingerprint, previousFingerprint);
  const correction = observation.correction;
  const generation = previous ? revisionGeneration(previous.revision) + Number(changed || correction) : 1;
  const revision = changed || correction || !previous
    ? `g${generation}-${contentHash({generation, fingerprint, correctionSequence: correction ? observation.sequence : null})}`
    : previous.revision;
  return {
    revision,
    observation,
    session: observation.session,
    status: "ready",
    paused: previous?.paused ?? false,
    issues: []
  };
}

function samePicks(a: DraftSession, b: DraftSession): boolean {
  return sameJson(a.picks, b.picks);
}

function sameSequenceSnapshot(a: DraftObservation, b: DraftObservation): boolean {
  return sameJson({
    state:historyShape(a),
    observedAt:a.session.observedAt,
    clockSeconds:a.clockSeconds
  },{
    state:historyShape(b),
    observedAt:b.session.observedAt,
    clockSeconds:b.clockSeconds
  });
}

function validateProgress(previous: CopilotState | null, observation: DraftObservation): void {
  if (!previous) return;
  const oldObservation = previous.observation;
  const oldSession = previous.session;
  if (observation.sessionId !== oldObservation.sessionId) {
    const newLocalSession = oldObservation.venue === "local-mock" && observation.venue === "local-mock" &&
      observation.session.phase === "pre-draft" && observation.session.picks.length === 0;
    if (!newLocalSession) throw new Error("Draft session identity changed without an isolated local mock reset");
    return;
  }
  if (observation.venue !== oldObservation.venue ||
      observation.session.leagueId !== oldSession.leagueId ||
      observation.session.teamId !== oldSession.teamId ||
      observation.session.boardRevision !== oldSession.boardRevision ||
      !sameJson(observation.session.teamOrder, oldSession.teamOrder)) {
    throw new Error("Draft observation scope or order changed within a session");
  }
  if (observation.session.phase === "pre-draft" && oldSession.phase !== "pre-draft") {
    throw new Error("A live or completed draft cannot reset to pre-draft without a new local mock session identity");
  }
  if (oldSession.phase === "complete" && observation.session.phase === "live" && !observation.correction) {
    throw new Error("A completed draft can resume only through an explicit correction");
  }
  if (observation.sequence < oldObservation.sequence) throw new Error("Draft observation sequence moved backwards");
  if (Date.parse(observation.receivedAt) < Date.parse(oldObservation.receivedAt) ||
      Date.parse(observation.session.observedAt) < Date.parse(oldSession.observedAt)) {
    throw new Error("Draft observation source or receipt time moved backwards");
  }

  const oldShape = historyShape(oldObservation);
  const newShape = historyShape(observation);
  const sameState = sameJson(oldShape, newShape);
  if (observation.sequence === oldObservation.sequence) {
    if (sameState && sameSequenceSnapshot(oldObservation,observation) && !observation.correction) return;
    throw new Error("Duplicate observation sequence conflicts with the last accepted state");
  }

  if (!samePicks(oldSession, observation.session) && !observation.correction) {
    const appendOnly = observation.session.picks.length >= oldSession.picks.length &&
      oldSession.picks.every((pick, index) => sameJson(pick, observation.session.picks[index]));
    if (!appendOnly) throw new Error("Historical picks changed without an explicit correction");
  }
  if (observation.correction && samePicks(oldSession, observation.session)) {
    throw new Error("Explicit correction did not change the authoritative pick history");
  }
}

/** Reconcile a full authoritative snapshot. Invalid reads keep the last good board blocked. */
export function reconcileObservation(board: DraftBoard, input: unknown, previous: CopilotState | null, asOf: Date): CopilotState {
  try {
    const observation = DraftObservationSchema.parse(input);
    validPage(board, observation);
    validateSession(board, observation, observation.session, asOf);
    if (!observation.completeHistory) throw new Error("Draft observation does not include complete pick history");
    if (!observation.identityVerified) throw new Error("Draft observation has unresolved player identity evidence");
    validateProgress(previous, observation);
    return acceptedState(observation, previous);
  } catch (error) {
    if (!previous) throw error;
    return {
      ...previous,
      status: "blocked",
      issues: [error instanceof Error ? error.message : "Draft observation rejected"]
    };
  }
}


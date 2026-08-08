import type { NotificationPriority, NotificationRecord } from "../models/v1.js";
import type { AddDropAction, ProposeTradeAction, QueuedAction, RosterSlotInput } from "../agents/types.js";

/**
 * In-season notification event types (doc 10 "Notification Types") emitted by
 * the scheduled season jobs. Injury alerts and the weekly planning report are
 * already produced by `runRefresh`; these cover the lineup-lock, waiver-window,
 * approval-gate, and degraded-source events added for the in-season loop.
 */
export const SEASON_NOTIFICATION_TYPES = {
  lineupLock: "lineup_lock_reminder",
  waiverWindow: "waiver_deadline_reminder",
  approvalRequest: "approval_request",
  sourceDegraded: "projection_source_degraded"
} as const;

export type SeasonNotificationType =
  (typeof SEASON_NOTIFICATION_TYPES)[keyof typeof SEASON_NOTIFICATION_TYPES];

export interface SeasonAlertContext {
  readonly leagueId: string;
  readonly userId: string;
  readonly scoringPeriod: string;
  readonly clock?: () => Date;
  /** Time-to-live for the notification; defaults to 24h. */
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function envelope(
  context: SeasonAlertContext,
  parts: {
    idSuffix: string;
    type: SeasonNotificationType;
    priority: NotificationPriority;
    title: string;
    body: string;
    actionRequired: boolean;
    relatedRecommendationIds?: string[];
    ttlMs?: number;
  }
): NotificationRecord {
  const now = (context.clock ?? (() => new Date()))();
  const ttl = parts.ttlMs ?? context.ttlMs ?? DEFAULT_TTL_MS;
  return {
    notification_id: `notif-${parts.type}-${context.scoringPeriod}-${parts.idSuffix}`,
    user_id: context.userId,
    league_id: context.leagueId,
    priority: parts.priority,
    type: parts.type,
    title: parts.title,
    body: parts.body,
    related_recommendation_ids: parts.relatedRecommendationIds ?? [],
    action_required: parts.actionRequired,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl).toISOString(),
    delivered: false
  };
}

/** Sunday pre-lock reminder carrying the final recommended start/sit lineup. */
export function buildLineupLockNotification(
  context: SeasonAlertContext,
  lineup: {
    readonly teamId: string;
    readonly starters: ReadonlyArray<RosterSlotInput>;
    readonly expectedPoints: number;
    readonly benchedRisks?: ReadonlyArray<string>;
  }
): NotificationRecord {
  const starters = lineup.starters.map((s) => `${s.slot}:${s.playerId}`).join(", ");
  const risks = lineup.benchedRisks?.length
    ? ` Watch: ${lineup.benchedRisks.join(", ")}.`
    : "";
  return envelope(context, {
    idSuffix: lineup.teamId,
    type: SEASON_NOTIFICATION_TYPES.lineupLock,
    priority: "high",
    title: `Lineup lock soon — ${context.scoringPeriod}`,
    body:
      `Final start/sit for ${lineup.teamId}: ${starters || "no starters resolved"}. ` +
      `Projected ${Math.round(lineup.expectedPoints * 100) / 100} pts.${risks}`,
    actionRequired: true,
    // Locks are same-day; expire in 6h so a stale reminder never lingers.
    ttlMs: 6 * 60 * 60 * 1000
  });
}

/** Post-waiver-processing sweep: adds/drops and trade looks worth reviewing. */
export function buildWaiverWindowNotification(
  context: SeasonAlertContext,
  sweep: {
    readonly teamId: string;
    readonly waiverCandidates: ReadonlyArray<AddDropAction>;
    readonly tradeCandidates: ReadonlyArray<ProposeTradeAction>;
  }
): NotificationRecord {
  const adds = sweep.waiverCandidates
    .map((c) => `+${c.addPlayerIds.join("/")} -${c.dropPlayerIds.join("/")}`)
    .slice(0, 5);
  const body = adds.length > 0
    ? `Waiver window open. Top targets: ${adds.join("; ")}. ${sweep.tradeCandidates.length} trade look(s) queued for review.`
    : `Waiver window open. No add/drop beats the current roster. ${sweep.tradeCandidates.length} trade look(s) queued for review.`;
  return envelope(context, {
    idSuffix: sweep.teamId,
    type: SEASON_NOTIFICATION_TYPES.waiverWindow,
    priority: adds.length > 0 ? "high" : "medium",
    title: `Waiver + trade sweep — ${context.scoringPeriod}`,
    body,
    actionRequired: adds.length > 0
  });
}

/**
 * One approval request per high-risk queued action. Nothing executes until the
 * user runs `pmt action-approve <actionId>`, so these notifications are the
 * only path from an agent proposal to a real move.
 */
export function buildApprovalRequestNotifications(
  context: SeasonAlertContext,
  queued: ReadonlyArray<QueuedAction>
): NotificationRecord[] {
  return queued.map((item) =>
    envelope(context, {
      idSuffix: item.actionId,
      type: SEASON_NOTIFICATION_TYPES.approvalRequest,
      priority: item.risk === "high" ? "critical" : "medium",
      title: `Approval needed: ${item.action.type} (${item.risk} risk)`,
      body: `${item.rationale} Approve with \`pmt action-approve ${item.actionId}\` or reject with \`pmt action-reject ${item.actionId}\`.`,
      actionRequired: true
    })
  );
}

/**
 * A projection source degraded (premium login failed, source 404, parse
 * break). The loop keeps running on the remaining sources; the user is told
 * which numbers are now missing.
 */
export function buildSourceDegradedNotification(
  context: SeasonAlertContext,
  degraded: { readonly source: string; readonly reason: string; readonly fallback: string }
): NotificationRecord {
  return envelope(context, {
    idSuffix: degraded.source,
    type: SEASON_NOTIFICATION_TYPES.sourceDegraded,
    priority: "medium",
    title: `Projection source degraded: ${degraded.source}`,
    body: `${degraded.reason} Falling back to ${degraded.fallback}.`,
    actionRequired: false
  });
}

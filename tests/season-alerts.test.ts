import assert from "node:assert/strict";
import test from "node:test";
import {
  SEASON_NOTIFICATION_TYPES,
  buildApprovalRequestNotifications,
  buildLineupLockNotification,
  buildSourceDegradedNotification,
  buildWaiverWindowNotification
} from "../src/notifications/season-alerts.js";
import type { QueuedAction } from "../src/agents/types.js";

const context = {
  leagueId: "league-001",
  userId: "manager-001",
  scoringPeriod: "2026-W03",
  clock: () => new Date("2026-09-20T15:00:00.000Z")
};

test("lineup lock notification carries the final start/sit and expires same day", () => {
  const notification = buildLineupLockNotification(context, {
    teamId: "team-001",
    starters: [{ playerId: "p1", slot: "RB" }, { playerId: "p2", slot: "WR" }],
    expectedPoints: 121.456
  });

  assert.equal(notification.type, SEASON_NOTIFICATION_TYPES.lineupLock);
  assert.equal(notification.priority, "high");
  assert.equal(notification.action_required, true);
  assert.match(notification.body, /RB:p1, WR:p2/);
  assert.match(notification.body, /121\.46 pts/);
  assert.equal(notification.expires_at, "2026-09-20T21:00:00.000Z");
});

test("waiver window notification lists top targets and flags action", () => {
  const notification = buildWaiverWindowNotification(context, {
    teamId: "team-001",
    waiverCandidates: [{ type: "add_drop", teamId: "team-001", addPlayerIds: ["fa1"], dropPlayerIds: ["p9"] }],
    tradeCandidates: []
  });

  assert.equal(notification.type, SEASON_NOTIFICATION_TYPES.waiverWindow);
  assert.equal(notification.action_required, true);
  assert.match(notification.body, /\+fa1 -p9/);
});

test("waiver window notification stays informational when nothing beats the roster", () => {
  const notification = buildWaiverWindowNotification(context, {
    teamId: "team-001",
    waiverCandidates: [],
    tradeCandidates: []
  });

  assert.equal(notification.priority, "medium");
  assert.equal(notification.action_required, false);
  assert.match(notification.body, /No add\/drop/);
});

test("approval requests keep the human gate and name the approve command", () => {
  const queued: QueuedAction[] = [{
    actionId: "act-1",
    action: { type: "propose_trade", fromTeamId: "team-001", toTeamId: "team-002", givePlayerIds: ["p1"], receivePlayerIds: ["p2"] },
    risk: "high",
    rationale: "Propose +EV trade.",
    status: "pending",
    createdAt: "2026-09-20T15:00:00.000Z",
    expiresAt: "2026-09-21T15:00:00.000Z"
  }];

  const [notification] = buildApprovalRequestNotifications(context, queued);
  assert.equal(notification.type, SEASON_NOTIFICATION_TYPES.approvalRequest);
  assert.equal(notification.priority, "critical");
  assert.equal(notification.action_required, true);
  assert.match(notification.body, /pmt action-approve act-1/);
  assert.match(notification.body, /pmt action-reject act-1/);
});

test("degraded source notification names the fallback", () => {
  const notification = buildSourceDegradedNotification(context, {
    source: "razzball-premium",
    reason: "Premium login failed (401).",
    fallback: "free-tier Razzball projections"
  });

  assert.equal(notification.type, SEASON_NOTIFICATION_TYPES.sourceDegraded);
  assert.equal(notification.action_required, false);
  assert.match(notification.body, /free-tier Razzball projections/);
});

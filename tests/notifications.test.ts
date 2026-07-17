import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleNotificationProvider, FileNotificationProvider } from "../src/notifications/notification-provider.js";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotificationRecord } from "../src/models/v1.js";

function notification(): NotificationRecord {
  return {
    notification_id: "n1", user_id: "u", league_id: "league-001", priority: "high", type: "breaking_injury_alert",
    title: "Injury", body: "Player out", related_recommendation_ids: [], action_required: true,
    created_at: "2026-09-10T00:00:00Z", expires_at: "2026-09-11T00:00:00Z", delivered: false
  };
}

test("console provider delivers", async () => {
  const result = await new ConsoleNotificationProvider().send(notification());
  assert.equal(result.delivered, true);
  assert.equal(result.detail, "console");
});

test("file provider appends a line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-notif-"));
  const file = join(dir, "notifications.log");
  try {
    const provider = new FileNotificationProvider(file);
    const result = await provider.send(notification());
    assert.equal(result.delivered, true);
    const content = await readFile(file, "utf8");
    assert.ok(content.includes("Injury"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

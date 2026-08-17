import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { SqliteV1Store } from "../src/history/sqlite-v1-store.js";
import type { NewsItem } from "../src/models/types.js";
import type { HistoricalRecord, ManagerProfileRecord, NotificationRecord } from "../src/models/v1.js";

function news(id: string): NewsItem {
  return {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "f", source_record_id: id,
    news_id: id, player_id: "p", source: "f", headline: "h", summary: "s", impact: "medium",
    published_at: "2026-09-10T00:00:00Z", ingested_at: ""
  };
}

function history(id: string): HistoricalRecord {
  return { record_id: id, league_id: "league-001", snapshot_id: "snap", captured_at: "", roster_changes: [], projection_changes: [] };
}

function profile(id: string): ManagerProfileRecord {
  return { league_id: "league-001", manager_id: id, display_name: id, observed_behavior_profile: {}, updated_at: "" };
}

function notification(id: string): NotificationRecord {
  return {
    notification_id: id, user_id: "u", league_id: "league-001", priority: "medium", type: "t",
    title: "title", body: "body", related_recommendation_ids: [], action_required: false,
    created_at: "", expires_at: "", delivered: false
  };
}

async function exerciseStore(label: string, make: () => { store: InMemoryV1Store | SqliteV1Store; close?: () => void }): Promise<void> {
  test(`${label}: news save/get`, async () => {
    const { store, close } = make();
    await store.saveNews("league-001", [news("n1"), news("n2")]);
    const all = await store.getNews("league-001");
    assert.equal(all.length, 2);
    const since = await store.getNews("league-001", "2026-09-11T00:00:00Z");
    assert.equal(since.length, 0);
    close?.();
  });

  test(`${label}: history records`, async () => {
    const { store, close } = make();
    await store.recordHistory(history("h1"));
    const records = await store.getHistory("league-001");
    assert.equal(records.length, 1);
    close?.();
  });

  test(`${label}: manager profiles`, async () => {
    const { store, close } = make();
    await store.saveManagerProfile(profile("m1"));
    const profiles = await store.getManagerProfiles("league-001");
    assert.equal(profiles.length, 1);
    close?.();
  });

  test(`${label}: notifications`, async () => {
    const { store, close } = make();
    await store.saveNotification(notification("x1"));
    const notes = await store.getNotifications("league-001");
    assert.equal(notes.length, 1);
    close?.();
  });
}

exerciseStore("in-memory", () => ({ store: new InMemoryV1Store() }));
exerciseStore("sqlite", () => {
  const store = new SqliteV1Store({ memory: true });
  return { store, close: () => store.close() };
});

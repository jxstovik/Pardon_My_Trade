import assert from "node:assert/strict";
import test from "node:test";
import {
  FallbackDraftFeed,
  ManualDraftFeed,
  type DraftFeed,
  type DraftPickEvent
} from "../src/draft/feed/draft-feed.js";
import { EspnDraftPollFeed } from "../src/draft/feed/espn-draft-poll-feed.js";
import { DraftPoller } from "../src/draft/feed/draft-poller.js";
import { DraftSession } from "../src/draft/draft-session.js";
import type { EspnPlatformClient } from "../src/adapters/espn/espn-platform-client.js";

function pick(overrides: Partial<DraftPickEvent> = {}): DraftPickEvent {
  return {
    pickNo: 1,
    round: 1,
    roundPick: 1,
    teamId: "t1",
    playerExternalId: "p1",
    source: "manual",
    timestamp: 1000,
    ...overrides
  };
}

test("ManualDraftFeed drains only new picks per poll", async () => {
  const feed = new ManualDraftFeed();
  feed.enqueue({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "p1" });
  feed.enqueue({ round: 1, roundPick: 2, teamId: "t2", playerExternalId: "p2" });
  const first = await feed.poll();
  assert.equal(first.length, 2);
  const second = await feed.poll();
  assert.equal(second.length, 0);
});

test("ManualDraftFeed infers next pick no when omitted", () => {
  const feed = new ManualDraftFeed();
  const a = feed.enqueue({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "p1" });
  const b = feed.enqueue({ round: 1, roundPick: 2, teamId: "t2", playerExternalId: "p2" });
  assert.equal(a.pickNo, 1);
  assert.equal(b.pickNo, 2);
});

test("FallbackDraftFeed merges both feeds and prefers primary on conflict", async () => {
  const primary: DraftFeed = {
    name: "espn",
    available: true,
    async poll() {
      return [pick({ pickNo: 1, playerExternalId: "espn-p1", source: "espn" })];
    }
  };
  const manual = new ManualDraftFeed();
  manual.enqueue({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "manual-p1" });
  const feed = new FallbackDraftFeed(primary, manual);
  const events = await feed.poll();
  assert.equal(events.length, 1);
  assert.equal(events[0].playerExternalId, "espn-p1");
  assert.equal(events[0].source, "espn");
});

test("FallbackDraftFeed captures manual backup when primary is healthy but empty", async () => {
  const primary: DraftFeed = { name: "espn", available: true, async poll() { return []; } };
  const manual = new ManualDraftFeed();
  manual.enqueue({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "p1" });
  const feed = new FallbackDraftFeed(primary, manual);
  const events = await feed.poll();
  assert.equal(events.length, 1, "manual backup must not be dropped when primary yields nothing");
});

test("FallbackDraftFeed tolerates a throwing primary", async () => {
  const primary: DraftFeed = {
    name: "espn",
    available: true,
    async poll() { throw new Error("boom"); }
  };
  const manual = new ManualDraftFeed();
  manual.enqueue({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "p1" });
  const feed = new FallbackDraftFeed(primary, manual);
  const events = await feed.poll();
  assert.equal(events.length, 1);
});

test("EspnDraftPollFeed degrades to empty on error", async () => {
  const client = {
    async getJson() { throw new Error("unreachable"); }
  } as unknown as EspnPlatformClient;
  const feed = new EspnDraftPollFeed(client, "draft-1");
  assert.equal(feed.available, true);
  const events = await feed.poll();
  assert.equal(events.length, 0);
  assert.equal(feed.available, false, "should mark itself unavailable after error");
});

test("EspnDraftPollFeed parses picks and tracks last pick no", async () => {
  const response = {
    draftDetail: {
      picks: [
        { pickNo: 1, round: 1, roundPick: 1, teamId: "t1", player: { id: "p1" }, date: 5 },
        { pickNo: 2, round: 1, roundPick: 2, teamId: "t2", player: { id: "p2" }, date: 6 }
      ]
    }
  };
  const client = {
    async getJson() { return response; }
  } as unknown as EspnPlatformClient;
  const feed = new EspnDraftPollFeed(client, "draft-1");
  const first = await feed.poll();
  assert.equal(first.length, 2);
  const second = await feed.poll();
  assert.equal(second.length, 0, "already-seen picks must not repeat");
});

test("DraftPoller runs callback on new picks but tolerates empty ticks", async () => {
  const feed: DraftFeed = { name: "m", available: true, async poll() { return []; } };
  let seen = 0;
  const poller = new DraftPoller(feed, { intervalMs: 1000, onPicks: (p) => { seen += p.length; } });
  await poller.pollOnce();
  assert.equal(seen, 0);
  assert.equal(poller.running, false);
});

test("DraftPoller stops itself after sustained errors", async () => {
  let calls = 0;
  const feed: DraftFeed = {
    name: "m",
    available: true,
    async poll() { calls += 1; throw new Error("x"); }
  };
  const poller = new DraftPoller(feed, { intervalMs: 1000, maxErrors: 3 });
  await poller.pollOnce();
  await poller.pollOnce();
  await poller.pollOnce();
  assert.equal(calls, 3);
  assert.equal(poller.running, false, "should auto-stop after maxErrors");
});

test("DraftSession records manual picks and exposes the board", async () => {
  const session = new DraftSession();
  session.recordManualPick({ round: 1, roundPick: 1, teamId: "t1", playerExternalId: "p1" });
  session.recordManualPick({ round: 1, roundPick: 2, teamId: "t2", playerExternalId: "p2" });
  await session.pollOnce();
  const board = session.getBoard();
  assert.equal(board.length, 2);
  assert.equal(board[0].playerExternalId, "p1");
});

test("DraftSession always includes manual feed in the composite", () => {
  const session = new DraftSession();
  assert.match(session.feedName, /manual/, "manual backup must always be present in the feed");
});

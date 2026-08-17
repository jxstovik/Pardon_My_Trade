import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "../src/config/load-env.js";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";
import { loadEspnCredentials } from "../src/adapters/espn/espn-auth.js";
import { RazzballProjectionSource } from "../src/projections/razzball-projection-source.js";
import { FFTodayProjectionSource } from "../src/projections/fftoday-projection-source.js";

loadEnv();

const enabled = process.env.PMT_LIVE_TESTS === "1";

test("live ESPN league smoke test", { skip: !enabled || !process.env.ESPN_LEAGUE_ID }, async () => {
  const season = process.env.ESPN_LIVE_SEASON ?? "2025";
  const reader = new EspnPlatformReader({ credentials: { ...loadEspnCredentials(), season } });
  const league = await reader.getLeague(process.env.ESPN_LEAGUE_ID!, season);
  const players = await reader.getPlayers("football", season);
  assert.ok(league.teams.length > 0, "ESPN league should contain teams");
  assert.ok(players.length > 0, "ESPN league should contain roster players");
});

test("live Razzball projection smoke test", { skip: !enabled }, async () => {
  const source = new RazzballProjectionSource({ position: "rb", force: true });
  const candidates = await source.fetchProjections("football", process.env.ESPN_SEASON ?? "2026", "2026-ROS");
  assert.ok(candidates.length > 0, "Razzball should return projection rows");
});

test("live FFToday projection smoke test", { skip: !enabled }, async () => {
  const source = new FFTodayProjectionSource({ position: "rb", optional: true, force: true });
  const candidates = await source.fetchProjections("football", "2025", "2025-ROS");
  assert.ok(candidates.length > 0 || source.lastSkipReason, "FFToday should return rows or a reported skip reason");
});

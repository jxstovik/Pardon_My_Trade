import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseHtmlTables, firstTable } from "../src/projections/html-table-parser.js";
import {
  detectColumnRoles,
  mapTableToCandidates,
  normalizePosition,
  parseNumber
} from "../src/projections/source-table-mapper.js";

test("detectColumnRoles finds player/team/stat/points/floor/ceiling", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const table = firstTable(parseHtmlTables(html));
  assert.ok(table);
  const roles = detectColumnRoles(table.headers);
  assert.equal(roles.playerIdx, 0);
  assert.equal(roles.teamIdx, 1);
  assert.equal(roles.pointsIdx, 10);
  assert.equal(roles.floorIdx, 8);
  assert.equal(roles.ceilingIdx, 9);
  const keys = roles.statCols.map((s) => s.key);
  assert.ok(keys.includes("rushing_yards"));
  assert.ok(keys.includes("receiving_yards"));
  assert.ok(keys.includes("rushing_touchdowns"));
});

test("mapTableToCandidates builds projection candidates with floor/ceiling", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const table = firstTable(parseHtmlTables(html));
  assert.ok(table);
  const candidates = mapTableToCandidates(table, { source: "razzball", fallbackPosition: "RB" });
  assert.equal(candidates.length, 2);
  const cmc = candidates[0];
  assert.equal(cmc.name, "Christian McCaffrey");
  assert.equal(cmc.team, "SF");
  assert.deepEqual(cmc.positions, ["RB"]);
  assert.equal(cmc.projected_stats.rushing_yards, 1100);
  assert.equal(cmc.projected_stats.receptions, 55);
  assert.equal(cmc.projected_points, 280.5);
  assert.equal(cmc.floor, 240);
  assert.equal(cmc.ceiling, 320);
});

test("mapTableToCandidates derives score from rank on ranking pages", async () => {
  const html = await readFile("tests/fixtures/razzball-weekly-qb.html", "utf8");
  const table = firstTable(parseHtmlTables(html));
  assert.ok(table);
  const candidates = mapTableToCandidates(table, { source: "razzball", fallbackPosition: "QB" });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].name, "Josh Allen");
  assert.equal(candidates[0].projected_stats.passing_yards, 3950);
  // No floor/ceiling columns -> derived from points.
  assert.ok(candidates[0].ceiling >= candidates[0].projected_points);
});

test("parseNumber handles commas, parens, and dashes", () => {
  assert.equal(parseNumber("1,100"), 1100);
  assert.equal(parseNumber("(5)"), -5);
  assert.equal(parseNumber("-"), undefined);
  assert.equal(parseNumber("12.5"), 12.5);
  assert.equal(parseNumber("N/A"), undefined);
});

test("normalizePosition maps aliases", () => {
  assert.equal(normalizePosition("RB", "RB"), "RB");
  assert.equal(normalizePosition("teamdefense", "RB"), "DST");
  assert.equal(normalizePosition("pk", "K"), "K");
  assert.equal(normalizePosition(undefined, "RB"), "RB");
});

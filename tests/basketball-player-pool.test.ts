import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/basketball/contracts.js";
import { importPlayerPool, normalizePlayerExport, parsePlayerCsv, readPlayerPool, renderPlayerPool } from "../src/basketball/player-pool.js";

const config = ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json", "utf8")));
const source = {schemaVersion:1, leagueId:config.leagueId, leagueName:config.leagueName, leagueSeason:"2026-27",
  sourceUrl:`https://www.fantrax.com/fantasy/league/${config.leagueId}/players`, observedAt:"2026-10-26T19:29:41Z",
  kind:"official-csv-export", statsSeason:"2025-26", statsLabel:"2025-26 Reg Season - YTD", statsBasis:"per-game",
  filter:"all-available-players", completeness:"all-matching-export-rows", scopeVerification:"browser-league-header-and-selected-filters"};
// Explicit synthetic unit-test rows. They are never loaded into the actual league store.
const header = "ID,Player,Team,Position,RkOv,Status,Score,%D,ADP,FG%,3PTM,FT%,PTS,REB,AST,ST,BLK";
const row = '*abc12*,"Sample, Player",ABC,"G,F/C",1,FA,100,80,11.7,.402,1.5,.810,15.8,8.1,2.9,2.1,1.1';
const zero = '*def34*,No History,DEF,G,2,W <small>(Tue)</small>,0,0,-,0,0,0,0,0,0,0,0';
const csv = `\uFEFF${header}\r\n${row}\r\n${zero}\r\n`;

test("CSV boundary preserves quoted delimiters, escaped quotes, Unicode and embedded newlines", () => {
  assert.deepEqual(parsePlayerCsv('\uFEFFa,b\r\n"A, B","c""d"\r\n"é\nf",g\r\n'), [["a","b"],["A, B",'c"d'],["é\nf","g"]]);
  assert.throws(()=>parsePlayerCsv('a\n"bad'), /Unterminated/);
  assert.throws(()=>parsePlayerCsv('a\n"bad"tail'), /Malformed/);
});

test("official export keeps stable IDs and prior-season statistics separate from forecast claims", () => {
  const pool = normalizePlayerExport(config, source, csv);
  assert.equal(pool.players[0]!.fantraxId, "abc12");
  assert.equal(pool.players[0]!.fullName, "Sample, Player");
  assert.deepEqual(pool.players[0]!.eligibleGroups, ["G","F/C"]);
  assert.equal(pool.players[1]!.adp, null); assert.equal(pool.players[1]!.waiverWeekday, "Tue");
  assert.equal(pool.quality.totalPlayers, 2); assert.equal(pool.quality.nonzeroDisplayedHistory, 1);
  assert.ok(pool.quality.missingFields.includes("FTA"));
  assert.ok(pool.quality.warnings.some(w=>w.includes("not current-season projections")));
  const unavailable = normalizePlayerExport(config, source, csv.replace('2,W <small>(Tue)</small>,0,0,-','2,W <small>(Tue)</small>,0,-,-'));
  assert.equal(unavailable.players[1]!.rosteredPercent, null);
  assert.equal(unavailable.quality.unavailableRosteredPercent, 1);
});

test("schema, scope, duplicates, invalid numeric data and incomplete rows fail closed", () => {
  assert.throws(()=>normalizePlayerExport(config, {...source, leagueId:"other"}, csv), /scope/);
  assert.throws(()=>normalizePlayerExport(config, {...source, sourceUrl:source.sourceUrl+'?leagueId=other'}, csv), /scope/);
  assert.throws(()=>normalizePlayerExport(config, {...source, statsSeason:"2026-27", statsLabel:"2026-27 Reg Season - YTD"}, csv), /prior-season/);
  assert.throws(()=>normalizePlayerExport(config, source, `${header}\n${row}\n${row}`), /duplicate/);
  assert.throws(()=>normalizePlayerExport(config, source, header), /Empty/);
  assert.throws(()=>normalizePlayerExport(config, source, `${header}\n${row},extra`), /column count/);
  assert.throws(()=>normalizePlayerExport(config, source, csv.replace('.402','1.402')), /percentage/);
  assert.throws(()=>normalizePlayerExport(config, source, csv.replace('15.8','NaN')), /Invalid PTS/);
  assert.throws(()=>normalizePlayerExport(config, source, csv.replace('G,F/C','PG')), /eligibility/);
});

test("pool import preserves original bytes, is repeatable, and detects raw/manifest tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "pmt-pool-"));
  try {
    const first = await importPlayerPool(root, config, source, Buffer.from(csv), new Date("2026-10-26T19:30:00Z"));
    const second = await importPlayerPool(root, config, source, Buffer.from(csv), new Date("2026-10-26T20:30:00Z"));
    assert.equal(first.revision, second.revision);
    assert.equal(await readFile(join(first.directory, `${first.rawSha256}.csv`), "utf8"), csv);
    await assert.rejects(importPlayerPool(root, config, {...source, leagueId:"wrong"}, Buffer.from(csv), new Date()));
    const saved = await readPlayerPool(root, config);
    assert.equal(saved.revision, first.revision);
    assert.match(renderPlayerPool(saved), /2 unique named Fantrax IDs/);
    assert.match(renderPlayerPool(saved), /not PMT recommendations/);
    await writeFile(join(first.directory, `${first.rawSha256}.csv`), 'tampered');
    await assert.rejects(readPlayerPool(root, config), /raw CSV hash mismatch/);
  } finally {await rm(root,{recursive:true,force:true});}
});

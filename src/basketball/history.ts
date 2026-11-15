import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type BasketballConfig } from "./contracts.js";
import { PlayerExportMetadata, normalizePlayerExport, parsePlayerCsv } from "./player-pool.js";
import { atomicJson, contentHash, immutableText, leagueDirectory } from "./store.js";

export const HistorySource = PlayerExportMetadata.extend({statView:z.literal("standard"), displayCountDecimals:z.literal(1)}).strict();
const EXTRA = ["GP", "MIN", "FGM", "FGA", "FTM", "FTA", "TO"] as const;
const RATE_KEYS = ["MIN", "FGM", "FGA", "FTM", "FTA", "TO", "PTS", "REB", "AST", "ST", "BLK", "3PTM"] as const;
type RateKey = typeof RATE_KEYS[number];
const integer = (s: string) => /^\d+$/.test(s) && Number.isSafeInteger(Number(s));
const rate = (s: string): number => {
  if (!/^(?:\d+(?:\.\d)?|\.\d)$/.test(s) || !Number.isFinite(Number(s))) throw new Error("Expected a nonnegative one-decimal historical display value");
  return Number(s);
};

/** Display history only. Rounded rates are never repaired into exact totals or forecasts. */
export function normalizeHistory(config: BasketballConfig, metadata: unknown, csv: string) {
  const source = HistorySource.parse(metadata);
  const {statView, displayCountDecimals, ...baseSource} = source;
  const base = normalizePlayerExport(config, baseSource, csv);
  const rows = parsePlayerCsv(csv), header = rows.shift()!;
  if (EXTRA.some(k=>!header.includes(k))) throw new Error("Standard history requires games, minutes, makes, attempts and turnovers");
  const players = rows.map((row, i) => {
    const cells = Object.fromEntries(header.map((h,j)=>[h,row[j]!.trim()]));
    if (!integer(cells.GP!)) throw new Error("Historical GP must be a nonnegative integer");
    const gamesPlayed = Number(cells.GP), rates = Object.fromEntries(RATE_KEYS.map(k=>[k,rate(cells[k]!)])) as Record<RateKey,number>;
    if (rates.FGM > rates.FGA || rates.FTM > rates.FTA || rates["3PTM"] > rates.FGM) throw new Error("Historical makes exceed attempts/field goals");
    if (gamesPlayed === 0 && Object.values(rates).some(n=>n>0)) throw new Error("Positive historical rates with zero displayed GP");
    const flags: string[] = [];
    // Independent nearest-tenth display intervals imply a maximum points identity error of .25.
    // This is a screening assumption, not a claim about Fantrax rounding or category equality.
    const pointsResidual = rates.PTS - (2*rates.FGM + rates["3PTM"] + rates.FTM);
    if (Math.abs(pointsResidual) > .25 + 1e-9) flags.push("points-components-outside-nearest-tenth-envelope");
    if (rates.MIN > 60) flags.push("minutes-outside-screening-envelope");
    return {...base.players[i]!, gamesPlayed, displayedPerGame:rates,
      coverage:gamesPlayed === 0 ? "zero-displayed-games-unresolved" as const : "positive-displayed-games" as const,
      pointsResidual, flags, usableForBaselineResearch:gamesPlayed>0 && flags.length===0};
  });
  return {source, players, quality:{totalPlayers:players.length, positiveGames:players.filter(p=>p.gamesPlayed>0).length,
    zeroGamesUnresolved:players.filter(p=>p.gamesPlayed===0).length, quarantined:players.filter(p=>p.flags.length>0).length,
    baselineResearchRows:players.filter(p=>p.usableForBaselineResearch).length,
    currentSeasonForecasts:0, precision:"One-decimal display rates; exact season makes/attempts are unavailable.",
    warnings:["Prior-season history is not a current-season forecast or draft recommendation.",
      "Rates and percentages are separately rounded; never multiply rates by GP and label the result exact totals.",
      "The nearest-tenth coherence envelope is an explicit screening assumption; flagged rows remain quarantined, never repaired.",
      "Zero displayed GP is unresolved coverage, not proof of no playing history or a zero forecast.",
      "Current school labels do not establish historical school stints or future roles.",
      "Available-player scope does not prove owned/ineligible coverage. Schedule, current availability and transfer/freshman priors remain missing.",
      "Turnovers are retained only as a source field; this league has no turnover category."]}};
}

export async function importHistory(root:string, config:BasketballConfig, metadata:unknown, raw:Buffer, at:Date) {
  const csv = raw.toString("utf8");
  if (!Buffer.from(csv,"utf8").equals(raw)) throw new Error("History CSV must be valid UTF-8");
  const normalized = normalizeHistory(config,metadata,csv), rawSha256=createHash("sha256").update(raw).digest("hex");
  const content={schemaVersion:1,analysisVersion:"historical-display-v1",leagueId:config.leagueId,rawSha256,...normalized};
  const revision=contentHash(content), directory=join(leagueDirectory(root,config),"histories");
  await mkdir(directory,{recursive:true});
  await immutableText(join(directory,`${rawSha256}.csv`),csv);
  await immutableText(join(directory,`${revision}.json`),JSON.stringify(content,null,2)+"\n");
  // Immutable revision records source time; append a separate receipt for this actual ingestion event.
  const receipt={revision,ingestedAt:at.toISOString()};
  await immutableText(join(directory,`${contentHash(receipt)}.receipt.json`),JSON.stringify(receipt,null,2)+"\n");
  await atomicJson(join(leagueDirectory(root,config),"current-history.json"),{revision});
  return {revision,directory,...content};
}

export async function readHistory(root:string,config:BasketballConfig) {
  const directory=join(leagueDirectory(root,config),"histories");
  const pointer=JSON.parse(await readFile(join(leagueDirectory(root,config),"current-history.json"),"utf8"));
  if (!/^[a-f0-9]{64}$/.test(pointer.revision)) throw new Error("Invalid history pointer");
  return readHistoryRevision(root,config,pointer.revision);
}

/** Read a pinned immutable history revision without following or changing the mutable current pointer. */
export async function readHistoryRevision(root:string,config:BasketballConfig,revision:string) {
  if(!/^[a-f0-9]{64}$/.test(revision))throw new Error("Invalid history revision");
  const directory=join(leagueDirectory(root,config),"histories");
  const saved=JSON.parse(await readFile(join(directory,`${revision}.json`),"utf8")) as Omit<Awaited<ReturnType<typeof importHistory>>,"revision"|"directory">;
  if (saved.leagueId!==config.leagueId || contentHash(saved)!==revision || !/^[a-f0-9]{64}$/.test(saved.rawSha256)) throw new Error("History manifest scope/hash mismatch");
  const raw=await readFile(join(directory,`${saved.rawSha256}.csv`));
  if (createHash("sha256").update(raw).digest("hex")!==saved.rawSha256) throw new Error("History raw hash mismatch");
  const normalized=normalizeHistory(config,saved.source,raw.toString("utf8"));
  if (contentHash(normalized)!==contentHash({source:saved.source,players:saved.players,quality:saved.quality})) throw new Error("History normalization mismatch");
  return {revision,directory,...saved};
}

export function renderHistory(history:Awaited<ReturnType<typeof importHistory>>):string {
  const q=history.quality;
  return ["# Banging 3s: historical standard export audit","",`Observed ${history.source.observedAt}; **${history.source.statsLabel}**, per-game display rates with season GP.`,"",
    `${q.totalPlayers} unique available-player IDs; ${q.positiveGames} with positive displayed GP; ${q.zeroGamesUnresolved} with unresolved zero-GP coverage.`,
    `${q.quarantined} rows quarantined by explicit coherence screening; ${q.baselineResearchRows} rows pass this bounded research screen. This does not establish season/pool coverage, a validated baseline or draft rankings.`,"",
    "## Limits","",...q.warnings.map(w=>`- ${w}`),"","## Quarantine","",
    ...history.players.filter(p=>p.flags.length).map(p=>`- ${p.fantraxId}: ${p.fullName.replace(/[<>\r\n]/g,"")}; ${p.flags.join(", ")}; PTS component residual ${p.pointsResidual.toFixed(3)}.`),"",
    `Original CSV SHA-256: ${history.rawSha256}. Normalized revision: ${history.revision}.`,"",
    "Original bytes retained privately. Zero current-season forecasts; no model promotion or live action.",""].join("\n");
}

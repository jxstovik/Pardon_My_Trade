import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { instant, type BasketballConfig } from "./contracts.js";
import { atomicJson, contentHash, immutableText, leagueDirectory } from "./store.js";

const HEADERS = ["ID", "Player", "Team", "Position", "RkOv", "Status", "Score", "%D", "ADP", "FG%", "3PTM", "FT%", "PTS", "REB", "AST", "ST", "BLK"] as const;
const HISTORY_STATS = ["FG%", "3PTM", "FT%", "PTS", "REB", "AST", "ST", "BLK"] as const;
export const PlayerExportMetadata = z.object({
  schemaVersion: z.literal(1), leagueId: z.string(), leagueName: z.string(), leagueSeason: z.string(),
  sourceUrl: z.url(), observedAt: instant, kind: z.literal("official-csv-export"),
  statsSeason: z.string().regex(/^20\d{2}-\d{2}$/), statsLabel: z.string(),
  statsBasis: z.literal("per-game"), filter: z.literal("all-available-players"),
  completeness: z.literal("all-matching-export-rows"), scopeVerification: z.literal("browser-league-header-and-selected-filters")
}).strict();
export type PlayerExportSource = z.infer<typeof PlayerExportMetadata>;
type PoolPlayer = {
  fantraxId: string; fullName: string; schoolLabel: string; eligibleGroups: ("G" | "F/C")[];
  status: "free-agent" | "waiver"; rawStatus: string; waiverWeekday: string | null;
  providerDisplayRank: number; providerScore: number; rosteredPercent: number | null; adp: number | null;
  historicalPerGame: Record<typeof HISTORY_STATS[number], number>;
};

/** Strict CSV boundary: quoted commas/newlines and escaped quotes, without silent row repair. */
export function parsePlayerCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  const cell = () => {row.push(field); field = ""; closed = false;};
  const line = () => {cell(); if (row.some(v => v !== "")) rows.push(row); row = [];};
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {if (text[i + 1] === '"') {field += '"'; i++;} else {quoted = false; closed = true;}}
      else field += c;
    } else if (c === ",") cell();
    else if (c === "\n" || c === "\r") {if (c === "\r" && text[i + 1] === "\n") i++; line();}
    else if (c === '"' && field === "" && !closed) quoted = true;
    else {if (closed || c === '"') throw new Error("Malformed quoted CSV field"); field += c;}
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field !== "" || row.length > 0 || closed) line();
  return rows;
}

function numeric(value: string, label: string): number {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error(`Invalid ${label} in player export`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Non-finite ${label} in player export`);
  return n;
}
function verifySource(config: BasketballConfig, source: PlayerExportSource): void {
  const url = new URL(source.sourceUrl);
  if (source.leagueId !== config.leagueId || source.leagueName !== config.leagueName || source.leagueSeason !== config.rules.seasonLabel || url.origin !== "https://www.fantrax.com" || url.pathname !== `/fantasy/league/${config.leagueId}/players` || url.search || url.hash || url.username || url.password) throw new Error("Player export league/source scope mismatch");
  if (Number(source.statsSeason.slice(5)) !== (Number(source.statsSeason.slice(0, 4)) + 1) % 100 || Number(source.statsSeason.slice(0, 4)) >= config.seasonYear || source.statsLabel !== `${source.statsSeason} Reg Season - YTD`) throw new Error("This importer requires an explicitly labeled prior-season history export");
}

export function normalizePlayerExport(config: BasketballConfig, metadata: unknown, csv: string) {
  const source = PlayerExportMetadata.parse(metadata); verifySource(config, source);
  const rows = parsePlayerCsv(csv), header = rows.shift();
  if (!header || new Set(header).size !== header.length || HEADERS.some(h => !header.includes(h))) throw new Error("Missing or duplicate player-export headers");
  if (rows.length === 0) throw new Error("Empty export cannot replace a player pool");
  const seen = new Set<string>();
  const players: PoolPlayer[] = rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`Player export row ${index + 2} has the wrong column count`);
    const r = Object.fromEntries(header.map((h, i) => [h, values[i]!.trim()]));
    const match = /^(?:\*([a-z0-9]+)\*|([a-z0-9]+))$/.exec(r.ID!);
    const fantraxId = match?.[1] ?? match?.[2];
    if (!fantraxId || seen.has(fantraxId)) throw new Error("Invalid or duplicate Fantrax player ID");
    seen.add(fantraxId);
    if (!r.Player || !r.Team) throw new Error("Player name and school label are required");
    const eligibleGroups = r.Position!.split(",") as PoolPlayer["eligibleGroups"];
    if (new Set(eligibleGroups).size !== eligibleGroups.length || eligibleGroups.some(p => p !== "G" && p !== "F/C")) throw new Error("Unsupported player eligibility group");
    const waiver = /^W(?: <small>\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)<\/small>)?$/.exec(r.Status!);
    if (r.Status !== "FA" && !waiver) throw new Error("Unsupported available-player status");
    const historicalPerGame = Object.fromEntries(HISTORY_STATS.map(k => [k, numeric(r[k]!, k)])) as PoolPlayer["historicalPerGame"];
    if (historicalPerGame["FG%"] > 1 || historicalPerGame["FT%"] > 1) throw new Error("Invalid historical shooting percentage");
    const providerDisplayRank = numeric(r.RkOv!, "rank"), rosteredPercent = r["%D"] === "-" ? null : numeric(r["%D"]!, "rostered percent");
    if (!Number.isSafeInteger(providerDisplayRank) || providerDisplayRank < 1 || (rosteredPercent !== null && rosteredPercent > 100)) throw new Error("Invalid player rank or rostered percentage");
    return {fantraxId, fullName:r.Player, schoolLabel:r.Team, eligibleGroups,
      status: r.Status === "FA" ? "free-agent" : "waiver", rawStatus:r.Status!, waiverWeekday:waiver?.[1] ?? null,
      providerDisplayRank, providerScore:numeric(r.Score!, "provider score"), rosteredPercent,
      adp:r.ADP === "-" ? null : numeric(r.ADP!, "ADP"), historicalPerGame} satisfies PoolPlayer;
  });
  const quality = {
    totalPlayers: players.length, freeAgents:players.filter(p => p.status === "free-agent").length,
    waiverPlayers:players.filter(p => p.status === "waiver").length,
    nonzeroDisplayedHistory:players.filter(p => Object.values(p.historicalPerGame).some(n => n > 0)).length,
    unavailableRosteredPercent:players.filter(p => p.rosteredPercent === null).length,
    missingFields:["GP", "MIN", "FGM", "FGA", "FTM", "FTA"],
    warnings:["Prior-season display statistics are not current-season projections.",
      "Current school labels do not establish the school where historical statistics were earned.",
      "An all-zero history row does not establish DNP, missing coverage or a zero forecast.",
      "Shooting attempts are absent; aggregate team percentages cannot be calculated from this export.",
      "Provider rank/score/ADP are preserved source fields, not PMT recommendations.",
      "The export scope is all available players; it is not proof of every owned or ineligible league player.",
      "A waiver weekday is not a verified processing instant."]
  };
  return {source, players, quality};
}

export async function importPlayerPool(root: string, config: BasketballConfig, metadata: unknown, raw: Buffer, at: Date) {
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw new Error("Player export must be valid UTF-8");
  const normalized = normalizePlayerExport(config, metadata, text);
  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  const content = {schemaVersion:1, leagueId:config.leagueId, rawSha256, ...normalized};
  const revision = contentHash(content), directory = join(leagueDirectory(root, config), "player-pools");
  await mkdir(directory, {recursive:true});
  await immutableText(join(directory, `${rawSha256}.csv`), text);
  await immutableText(join(directory, `${revision}.json`), JSON.stringify(content, null, 2) + "\n");
  // Keep the first ingestion time on repeat import. This is not a complete ingestion-event ledger.
  await immutableText(join(directory, `${revision}.receipt.json`), JSON.stringify({revision, firstIngestedAt:at.toISOString()}, null, 2) + "\n").catch(async error => {
    if (!(error instanceof Error) || !error.message.includes("Immutable basketball file conflict")) throw error;
    const receipt = JSON.parse(await readFile(join(directory, `${revision}.receipt.json`), "utf8"));
    if (receipt.revision !== revision) throw new Error("Player pool receipt mismatch");
  });
  await atomicJson(join(leagueDirectory(root, config), "current-player-pool.json"), {revision});
  return {revision, directory, ...content};
}

export async function readPlayerPool(root: string, config: BasketballConfig) {
  const directory = join(leagueDirectory(root, config), "player-pools");
  const {revision} = JSON.parse(await readFile(join(leagueDirectory(root, config), "current-player-pool.json"), "utf8"));
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid player pool pointer");
  const saved = JSON.parse(await readFile(join(directory, `${revision}.json`), "utf8")) as ReturnType<typeof normalizePlayerExport> & {schemaVersion:number; leagueId:string; rawSha256:string};
  if (contentHash(saved) !== revision || saved.leagueId !== config.leagueId || !/^[a-f0-9]{64}$/.test(saved.rawSha256)) throw new Error("Player pool manifest hash/scope mismatch");
  verifySource(config, PlayerExportMetadata.parse(saved.source));
  const raw = await readFile(join(directory, `${saved.rawSha256}.csv`));
  if (createHash("sha256").update(raw).digest("hex") !== saved.rawSha256) throw new Error("Player pool raw CSV hash mismatch");
  return {revision, directory, ...saved};
}

export function renderPlayerPool(pool: Awaited<ReturnType<typeof importPlayerPool>>): string {
  const clean = (s: string) => s.replace(/[\r\n|]/g, " ").replace(/[<>]/g, "");
  return [`# Banging 3s: named player export audit`, "", `Source observed ${pool.source.observedAt}; historical stats: **${pool.source.statsLabel}**, per game. League season: **${pool.source.leagueSeason}**.`, "",
    `**${pool.quality.totalPlayers} unique named Fantrax IDs**; ${pool.quality.freeAgents} free agents and ${pool.quality.waiverPlayers} waiver players in this all-available export.`, "",
    "This is an identity/history acquisition milestone. Forecasts, player recommendations, strategy benefits and win probabilities remain unavailable.", "", "## Identity sample — export order only", "", "| Fantrax ID | Full name | School label | Eligibility |", "|---|---|---|---|",
    ...pool.players.slice(0,10).map(p=>`| ${p.fantraxId} | ${clean(p.fullName)} | ${clean(p.schoolLabel)} | ${p.eligibleGroups.join(", ")} |`), "",
    "## Data limitations", "", ...pool.quality.warnings.map(w=>`- ${w}`), "",
    `Raw CSV SHA-256: ${pool.rawSha256}. Normalized revision: ${pool.revision}.`, "",
    "Original export bytes are retained privately under data/basketball; no session credentials were exported. No live action executed.", ""].join("\n");
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RecommendationCache, DEFAULT_CACHE_TTL_MS } from "./projections/recommendation-cache.js";
import { RazzballProjectionSource } from "./projections/razzball-projection-source.js";
import { FFTodayProjectionSource } from "./projections/fftoday-projection-source.js";
import { EspnProjectionSource } from "./projections/espn-projection-source.js";
import { loginRazzball } from "./projections/razzball-auth.js";
import { saveRecommendation } from "./projections/recommendation-writer.js";
import { SqliteKnowledgeRepository } from "./knowledge/sqlite-knowledge-repository.js";
import { persistCandidates } from "./season-refresh.js";
import { getCurrentScoringPeriod, weekFromScoringPeriod } from "./seasons/nfl-calendar.js";
import type { ProjectionCandidate, ProjectionSource } from "./projections/projection-source.js";

/**
 * Implements the `pmt projections` and `pmt razzball-login` CLI surfaces
 * described in the fantasy-recommendations skill.
 */

function cacheDir(): string {
  const dataDir = process.env.PMT_DATA_DIR ?? "data";
  return dataDir === "data" ? "data/recommendations/cache" : `${dataDir}/recommendations/cache`;
}

function recDir(): string {
  const dataDir = process.env.PMT_DATA_DIR ?? "data";
  return dataDir === "data" ? "data/recommendations" : `${dataDir}/recommendations`;
}

function ttlMs(): number {
  const raw = process.env.PMT_CACHE_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MS;
}

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positionals: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

function buildSource(sourceArg: string, position: string, flags: Record<string, string | boolean>, cache: RecommendationCache): ProjectionSource {
  const week = flags["week"] !== undefined ? Number(flags["week"]) : undefined;
  const ppr = flags["ppr"] === true;
  if (sourceArg === "espn") {
    return new EspnProjectionSource();
  }
  if (sourceArg === "razzball" || sourceArg === "razzball-premium") {
    const premium = sourceArg === "razzball-premium";
    const kind = premium ? "pigskinonator" : (week !== undefined ? "weekly" : "ros");
    return new RazzballProjectionSource({ position, kind, week, ppr, fetchImpl: globalThis.fetch, cache });
  }
  if (sourceArg === "fftoday") {
    const kind = week !== undefined ? "weekly" : "season";
    return new FFTodayProjectionSource({ position, kind, week, fetchImpl: globalThis.fetch, cache });
  }
  throw new Error(`Unknown projection source: ${sourceArg}. Use razzball, razzball-premium, fftoday, or espn.`);
}

function sourceLabel(sourceArg: string): string {
  return sourceArg.replace("-premium", "");
}

export async function runProjectionsCommand(args: string[]): Promise<void> {
  const cache = new RecommendationCache({ directory: cacheDir(), ttlMs: ttlMs() });

  if (args.includes("--clear-cache")) {
    const removed = await cache.clear();
    console.log(JSON.stringify({ cleared: removed }, null, 2));
    return;
  }
  if (args.includes("--cache-stats")) {
    const stats = await cache.stats();
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const { flags, positionals } = parseFlags(args);
  const sourceArg = positionals[0];
  const position = positionals[1] ?? "rb";

  if (!sourceArg) {
    throw new Error("projections requires a source: pmt projections <razzball|razzball-premium|fftoday|espn> <position> [--week N] [--ppr] [--no-save] [--persist] [--max N]");
  }

  const source = buildSource(sourceArg, position, flags, cache);
  const season = process.env.ESPN_SEASON ?? new Date().getFullYear().toString();

  // `--auto` resolves the current NFL week from the calendar when no explicit
  // `--week N` was supplied, so weekly pulls track the season automatically.
  if (flags["auto"] && flags["week"] === undefined) {
    const period = getCurrentScoringPeriod(new Date(), season);
    const autoWeek = weekFromScoringPeriod(period);
    if (autoWeek !== undefined) flags["week"] = String(autoWeek);
  }

  const scoringPeriod = typeof flags["week"] === "string" ? `${season}-W${flags["week"]}` : `${season}-ROS`;

  const candidates = await source.fetchProjections("football", season, scoringPeriod);
  const max = typeof flags["max"] === "string" ? Number(flags["max"]) : undefined;
  const rows = (max ? candidates.slice(0, max) : candidates).map((c: ProjectionCandidate, i: number) => ({
    rank: i + 1,
    player: c.name,
    team: c.team,
    position: c.positions[0] ?? "",
    value: c.projected_points,
    floor: c.floor,
    ceiling: c.ceiling
  }));

  const label = sourceLabel(sourceArg);
  const query = `${position} ${scoringPeriod.replace(`${season}-`, "")}`;
  const writeFileImpl = flags["no-save"] ? async () => {} : undefined;
  const { path, markdown } = await saveRecommendation(
    {
      source: label,
      query,
      url: "",
      rows,
      clock: () => new Date()
    },
    { directory: recDir(), writeFileImpl }
  );

  console.log(markdown);
  if (!flags["no-save"]) {
    console.log(`\nSaved: ${path}`);
  }

  if (flags["persist"]) {
    const dataDir = process.env.PMT_DATA_DIR ?? "data";
    const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
    const pointerRaw = await readFile(join(dataDir, "last-snapshot.json"), "utf8").catch(() => undefined);
    if (pointerRaw) {
      const pointer = JSON.parse(pointerRaw) as { snapshot_id: string };
      const snapshot = await repository.getLeagueSnapshot(pointer.snapshot_id);
      if (snapshot) {
        const stored = await persistCandidates(repository, snapshot, source, candidates, scoringPeriod, dataDir);
        console.log(`Persisted ${stored} matched projections to the store (${scoringPeriod}).`);
      } else {
        console.log("No imported snapshot found; run `pmt import-espn <leagueId>` before --persist.");
      }
    } else {
      console.log("No imported snapshot found; run `pmt import-espn <leagueId>` before --persist.");
    }
  }
}

export async function runRazzballLogin(): Promise<void> {
  const username = process.env.RAZZBALL_USERNAME;
  const password = process.env.RAZZBALL_PASSWORD;
  if (!username || !password) {
    throw new Error("RAZZBALL_USERNAME and RAZZBALL_PASSWORD must be set in the environment to log in.");
  }
  const dataDir = process.env.PMT_DATA_DIR ?? "data";
  const session = await loginRazzball(username, password, { dataDir });
  console.log(JSON.stringify({
    message: "Razzball premium session saved.",
    fetched_at: session.fetched_at,
    cookiePath: `${dataDir}/razzball-cookies.json`
  }, null, 2));
}

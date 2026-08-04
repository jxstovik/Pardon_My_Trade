import { PmtError } from "../errors.js";
import type { PlayerPosition } from "../models/types.js";
import { fetchWithCache, RecommendationCache } from "./recommendation-cache.js";
import { parseHtmlTables, selectPlayerTable } from "./html-table-parser.js";
import { mapTableToCandidates, normalizePosition } from "./source-table-mapper.js";
import type { ProjectionCandidate, ProjectionSource } from "./projection-source.js";

export type FFTodayKind = "season" | "weekly";

export interface FFTodayProjectionSourceOptions {
  readonly position: string;
  readonly kind?: FFTodayKind;
  readonly season?: string;
  readonly week?: number;
  readonly fetchImpl?: typeof fetch;
  readonly cache?: RecommendationCache;
  readonly dataDir?: string;
  readonly maxRows?: number;
}

const POSITION_POSID: Record<string, string> = {
  qb: "10",
  rb: "20",
  wr: "30",
  te: "40",
  dl: "50",
  lb: "60",
  db: "70",
  k: "80",
  pk: "80",
  dst: "99",
  def: "99",
  defense: "99"
};

export function posIdToPosition(posId: string): PlayerPosition {
  switch (posId) {
    case "10": return "QB";
    case "20": return "RB";
    case "30": return "WR";
    case "40": return "TE";
    case "80": return "K";
    case "99": return "DST";
    default: return "RB";
  }
}

export function buildFFTDayUrl(options: {
  position: string;
  kind?: FFTodayKind;
  season?: string;
  week?: number;
}): string {
  const posId = POSITION_POSID[options.position.toLowerCase()] ?? "20";
  const kind = options.kind ?? "season";
  const base = "https://www.fftoday.com";
  if (kind === "weekly") {
    const season = options.season ?? new Date().getFullYear().toString();
    const week = options.week ?? 1;
    return `${base}/playerwkproj.php?Season=${season}&GameWeek=${week}&PosID=${posId}`;
  }
  return `${base}/playerproj.php?PosID=${posId}`;
}

export class FFTodayProjectionSource implements ProjectionSource {
  readonly name: string;
  private readonly position: string;
  private readonly kind: FFTodayKind;
  private readonly season?: string;
  private readonly week?: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache?: RecommendationCache;
  private readonly dataDir: string;
  private readonly maxRows?: number;

  constructor(options: FFTodayProjectionSourceOptions) {
    this.position = options.position.toLowerCase();
    this.kind = options.kind ?? "season";
    this.season = options.season;
    this.week = options.week;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.cache = options.cache;
    this.dataDir = options.dataDir ?? "data";
    this.maxRows = options.maxRows;
    this.name = `fftoday-${this.position}`;
  }

  async fetchProjections(_sport: string, season: string, _scoringPeriod: string): Promise<ProjectionCandidate[]> {
    const url = buildFFTDayUrl({
      position: this.position,
      kind: this.kind,
      season: this.season ?? season,
      week: this.week
    });

    const entry = await fetchWithCache(url, {
      fetchImpl: this.fetchImpl,
      cache: this.cache ?? new RecommendationCache({ directory: this.cacheDir() }),
      source: "fftoday"
    });

    return this.parse(entry.body);
  }

  private parse(html: string): ProjectionCandidate[] {
    const result = parseHtmlTables(html);
    const table = selectPlayerTable(result);
    if (!table) {
      throw new PmtError({
        code: "FFTODAY_NO_TABLE",
        message: "FFToday response did not contain a parseable player table.",
        source: "projection_source",
        retryable: false
      });
    }
    return mapTableToCandidates(table, {
      source: "fftoday",
      fallbackPosition: normalizePosition(this.position, "RB"),
      maxRows: this.maxRows
    });
  }

  private cacheDir(): string {
    return this.dataDir === "data" ? "data/recommendations/cache" : `${this.dataDir}/recommendations/cache`;
  }
}

import { PmtError } from "../errors.js";
import type { PlayerPosition } from "../models/types.js";
import { fetchWithCache, RecommendationCache } from "./recommendation-cache.js";
import { parseHtmlTables, selectPlayerTable } from "./html-table-parser.js";
import { mapTableToCandidates } from "./source-table-mapper.js";
import { loadRazzballCookies } from "./razzball-auth.js";
import type { ProjectionCandidate, ProjectionSource } from "./projection-source.js";

export type RazzballKind = "ros" | "weekly" | "pigskinonator";

export interface RazzballProjectionSourceOptions {
  readonly position: string;
  readonly kind?: RazzballKind;
  readonly week?: number;
  readonly ppr?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly cache?: RecommendationCache;
  readonly dataDir?: string;
  readonly cookiePath?: string;
  readonly maxRows?: number;
}

const POSITION_SLUGS: Record<string, string> = {
  qb: "qb",
  rb: "rb",
  wr: "wr",
  te: "te",
  k: "pk",
  pk: "pk",
  dst: "teamdefense",
  def: "teamdefense",
  defense: "teamdefense",
  idp: "idp"
};

export function slugToPosition(slug: string): PlayerPosition {
  switch (slug.toLowerCase()) {
    case "qb": return "QB";
    case "rb": return "RB";
    case "wr": return "WR";
    case "te": return "TE";
    case "k":
    case "pk": return "K";
    case "dst":
    case "def":
    case "defense": return "DST";
    default: return "RB";
  }
}

export function buildRazzballUrl(options: {
  position: string;
  kind?: RazzballKind;
  week?: number;
  ppr?: boolean;
}): string {
  const base = "https://football.razzball.com";
  const pos = (POSITION_SLUGS[options.position.toLowerCase()] ?? options.position.toLowerCase());
  const kind = options.kind ?? "ros";

  if (kind === "ros") {
    return `${base}/projections-${pos}-restofseason/`;
  }
  if (kind === "weekly") {
    const pprSuffix = options.ppr ?? ["rb", "wr", "te"].includes(pos) ? "-ppr" : "";
    return `${base}/weekly-rankings-${pos}${pprSuffix}/`;
  }
  // pigskinonator (premium)
  const week = options.week ? `?week=${options.week}` : "";
  return `${base}/pigskinonator-${pos}/${week}`;
}

export class RazzballProjectionSource implements ProjectionSource {
  readonly name: string;
  private readonly position: string;
  private readonly kind: RazzballKind;
  private readonly week?: number;
  private readonly ppr: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly cache?: RecommendationCache;
  private readonly dataDir: string;
  private readonly cookiePath?: string;
  private readonly maxRows?: number;

  constructor(options: RazzballProjectionSourceOptions) {
    this.position = options.position.toLowerCase();
    this.kind = options.kind ?? "ros";
    this.week = options.week;
    this.ppr = options.ppr ?? false;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.cache = options.cache;
    this.dataDir = options.dataDir ?? "data";
    this.cookiePath = options.cookiePath;
    this.maxRows = options.maxRows;
    const premium = this.kind === "pigskinonator" ? "premium-" : "";
    this.name = `razzball-${premium}${this.position}`;
  }

  async fetchProjections(_sport: string, _season: string, _scoringPeriod: string): Promise<ProjectionCandidate[]> {
    const url = buildRazzballUrl({ position: this.position, kind: this.kind, week: this.week });
    const premium = this.kind === "pigskinonator";

    let cookies: string | undefined;
    if (premium) {
      try {
        cookies = await loadRazzballCookies({ dataDir: this.dataDir, cookiePath: this.cookiePath });
      } catch {
        cookies = undefined;
      }
      if (!cookies) {
        throw new PmtError({
          code: "RAZZBALL_PREMIUM_REQUIRED",
          message: "Razzball premium URL requires a saved session. Run `pmt razzball-login` first.",
          source: "projection_source",
          retryable: false
        });
      }
    }

    const entry = await fetchWithCache(url, {
      fetchImpl: this.fetchImpl,
      cache: this.cache ?? new RecommendationCache({ directory: this.cacheDir() }),
      source: "razzball",
      cookies
    });

    return this.parse(entry.body);
  }

  private parse(html: string): ProjectionCandidate[] {
    const result = parseHtmlTables(html);
    const table = selectPlayerTable(result);
    if (!table) return [];
    return mapTableToCandidates(table, {
      source: "razzball",
      fallbackPosition: slugToPosition(this.position),
      maxRows: this.maxRows,
      pointsPreference: this.ppr ? "ppr" : "std"
    });
  }

  private cacheDir(): string {
    return this.cookiePath ? this.cookiePath.replace(/razzball-cookies\.json$/, "recommendations/cache") : "data/recommendations/cache";
  }
}

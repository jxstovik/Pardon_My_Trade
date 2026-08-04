import { EspnProjectionSource } from "./espn-projection-source.js";
import { FFTodayProjectionSource } from "./fftoday-projection-source.js";
import { RazzballProjectionSource } from "./razzball-projection-source.js";
import { RecommendationCache } from "./recommendation-cache.js";
import type { ProjectionSource } from "./projection-source.js";

/**
 * Builds the list of projection sources from the `PMT_PROJECTION_SOURCES` env
 * var (comma-separated). When unset, only ESPN is registered — preserving the
 * deterministic test behaviour. Razzball/FFToday fan out into one source per
 * position because their pages are position-scoped.
 */

export const RAZZBALL_POSITIONS = ["qb", "rb", "wr", "te", "k", "dst", "idp"] as const;
export const FFTODAY_POSITIONS = ["qb", "rb", "wr", "te", "k", "dst"] as const;

export interface BuildProjectionSourcesOptions {
  readonly sources?: string;
  readonly season?: string;
  readonly dataDir?: string;
  readonly cache?: RecommendationCache;
  readonly fetchImpl?: typeof fetch;
  readonly onUnsupported?: (name: string) => void;
}

export function buildProjectionSources(options: BuildProjectionSourcesOptions = {}): ProjectionSource[] {
  const raw = options.sources?.trim();
  if (!raw) {
    return [new EspnProjectionSource({ fetchImpl: options.fetchImpl, baseUrl: undefined })];
  }

  const dataDir = options.dataDir ?? "data";
  const cache = options.cache ?? new RecommendationCache({ directory: joinCache(dataDir) });
  const season = options.season ?? new Date().getFullYear().toString();
  const out: ProjectionSource[] = [];

  for (const token of raw.split(",")) {
    const name = token.trim().toLowerCase();
    if (!name) continue;
    if (name === "espn") {
      out.push(new EspnProjectionSource({ fetchImpl: options.fetchImpl }));
    } else if (name === "razzball") {
      for (const position of RAZZBALL_POSITIONS) {
        out.push(new RazzballProjectionSource({
          position,
          kind: "ros",
          fetchImpl: options.fetchImpl,
          cache,
          dataDir
        }));
      }
    } else if (name === "fftoday") {
      for (const position of FFTODAY_POSITIONS) {
        out.push(new FFTodayProjectionSource({
          position,
          kind: "season",
          season,
          fetchImpl: options.fetchImpl,
          cache
        }));
      }
    } else if (name === "fantasypros") {
      options.onUnsupported?.(name);
    } else {
      options.onUnsupported?.(name);
    }
  }
  return out;
}

function joinCache(dataDir: string): string {
  return dataDir === "data" ? "data/recommendations/cache" : `${dataDir}/recommendations/cache`;
}

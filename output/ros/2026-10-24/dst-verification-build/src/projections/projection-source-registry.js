import { EspnProjectionSource } from "./espn-projection-source.js";
import { FFTodayProjectionSource } from "./fftoday-projection-source.js";
import { FantasyProsProjectionSource } from "./fantasypros-projection-source.js";
import { RazzballProjectionSource } from "./razzball-projection-source.js";
import { RecommendationCache } from "./recommendation-cache.js";
/**
 * Builds the list of projection sources from the `PMT_PROJECTION_SOURCES` env
 * var (comma-separated). When unset, only ESPN is registered — preserving the
 * deterministic test behaviour. Razzball/FFToday fan out into one source per
 * position because their pages are position-scoped.
 */
export const RAZZBALL_POSITIONS = ["qb", "rb", "wr", "te", "k", "dst", "idp"];
export const FFTODAY_POSITIONS = ["qb", "rb", "wr", "te", "k", "dst"];
export const FANTASYPROS_POSITIONS = ["qb", "rb", "wr", "te", "k", "dst"];
export function buildProjectionSources(options = {}) {
    const raw = options.sources?.trim();
    if (!raw) {
        return [new EspnProjectionSource({ fetchImpl: options.fetchImpl, baseUrl: undefined, credentials: options.espnCredentials })];
    }
    const dataDir = options.dataDir ?? "data";
    const cache = options.cache ?? new RecommendationCache({ directory: joinCache(dataDir) });
    const season = options.season ?? new Date().getFullYear().toString();
    const force = options.force ?? false;
    const optional = options.optional ?? true;
    const out = [];
    for (const token of raw.split(",")) {
        const name = token.trim().toLowerCase();
        if (!name)
            continue;
        if (name === "espn") {
            out.push(new EspnProjectionSource({ fetchImpl: options.fetchImpl, credentials: options.espnCredentials }));
        }
        else if (name === "razzball") {
            for (const position of RAZZBALL_POSITIONS) {
                out.push(new RazzballProjectionSource({
                    position,
                    kind: "ros",
                    // User directive: full PPR is the primary scoring format. Razzball's
                    // ROS pages expose PPR columns for RB/WR/TE (STD for QB/K/DST).
                    ppr: true,
                    fetchImpl: options.fetchImpl,
                    cache,
                    dataDir,
                    force,
                    optional
                }));
            }
        }
        else if (name === "fftoday") {
            for (const position of FFTODAY_POSITIONS) {
                out.push(new FFTodayProjectionSource({
                    position,
                    kind: "season",
                    season,
                    fetchImpl: options.fetchImpl,
                    cache,
                    force,
                    optional
                }));
            }
        }
        else if (name === "fantasypros") {
            for (const position of FANTASYPROS_POSITIONS) {
                out.push(new FantasyProsProjectionSource({
                    position,
                    kind: "season",
                    season,
                    scoring: "PPR",
                    cache,
                    force,
                    optional
                }));
            }
        }
        else {
            options.onUnsupported?.(name);
        }
    }
    return out;
}
function joinCache(dataDir) {
    return dataDir === "data" ? "data/recommendations/cache" : `${dataDir}/recommendations/cache`;
}

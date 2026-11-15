import { PmtError } from "../errors.js";
import { fetchWithCache, RecommendationCache } from "./recommendation-cache.js";
import { parseHtmlTables, selectPlayerTable } from "./html-table-parser.js";
import { mapTableToCandidates } from "./source-table-mapper.js";
import { loadRazzballCookies } from "./razzball-auth.js";
const POSITION_SLUGS = {
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
export function slugToPosition(slug) {
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
export function buildRazzballUrl(options) {
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
export class RazzballProjectionSource {
    name;
    lastSkipReason;
    position;
    kind;
    week;
    ppr;
    fetchImpl;
    cache;
    dataDir;
    cookiePath;
    maxRows;
    force;
    optional;
    constructor(options) {
        this.position = options.position.toLowerCase();
        this.kind = options.kind ?? "ros";
        this.week = options.week;
        this.ppr = options.ppr ?? false;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.cache = options.cache;
        this.dataDir = options.dataDir ?? "data";
        this.cookiePath = options.cookiePath;
        this.maxRows = options.maxRows;
        this.force = options.force ?? false;
        this.optional = options.optional ?? false;
        const premium = this.kind === "pigskinonator" ? "premium-" : "";
        this.name = `razzball-${premium}${this.position}`;
    }
    async fetchProjections(_sport, _season, _scoringPeriod) {
        this.lastSkipReason = undefined;
        const url = buildRazzballUrl({ position: this.position, kind: this.kind, week: this.week });
        const premium = this.kind === "pigskinonator";
        let cookies;
        if (premium) {
            try {
                cookies = await loadRazzballCookies({ dataDir: this.dataDir, cookiePath: this.cookiePath });
            }
            catch {
                cookies = undefined;
            }
            if (!cookies) {
                const message = "Razzball premium URL requires a saved session. Run `pmt razzball-login` first.";
                if (this.optional)
                    return this.skip(message);
                throw new PmtError({
                    code: "RAZZBALL_PREMIUM_REQUIRED",
                    message,
                    source: "projection_source",
                    retryable: false
                });
            }
        }
        try {
            const entry = await fetchWithCache(url, {
                fetchImpl: this.fetchImpl,
                cache: this.cache ?? new RecommendationCache({ directory: this.cacheDir() }),
                source: "razzball",
                cookies,
                force: this.force
            });
            return this.parse(entry.body);
        }
        catch (cause) {
            if (this.optional)
                return this.skip(cause.message);
            throw cause;
        }
    }
    skip(reason) {
        this.lastSkipReason = reason;
        return [];
    }
    parse(html) {
        const result = parseHtmlTables(html);
        const table = selectPlayerTable(result);
        if (!table)
            return [];
        return mapTableToCandidates(table, {
            source: "razzball",
            fallbackPosition: slugToPosition(this.position),
            maxRows: this.maxRows,
            pointsPreference: this.ppr ? "ppr" : "std"
        });
    }
    cacheDir() {
        return this.cookiePath ? this.cookiePath.replace(/razzball-cookies\.json$/, "recommendations/cache") : "data/recommendations/cache";
    }
}

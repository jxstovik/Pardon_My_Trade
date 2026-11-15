import { fetchWithCache } from "./recommendation-cache.js";
import { normalizePosition } from "./source-table-mapper.js";
const FP_POSITION_PATH = {
    qb: "qb",
    rb: "rb",
    wr: "wr",
    te: "te",
    k: "k",
    dst: "dst",
    defense: "dst"
};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Extract the last fantasy-points cell of each player row from the FP table HTML. */
export function parseFantasyProsRows(html) {
    const out = [];
    // Rows: anchor with class containing fp-player-name, followed by cells; the
    // projected fantasy points live in the final numeric <td> of the row.
    const rowRe = /<tr[^>]*class="[^"]*mpb-player-[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
    const nameRe = /fp-player-name[^>]*>([^<]+)</;
    const teamRe = /<span[^>]*class="[^"]*player-team[^"]*"[^>]*>([A-Za-z]{2,4})<\/span>/;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = rowRe.exec(html)) !== null) {
        const rowHtml = m[1];
        const nameMatch = rowHtml.match(nameRe);
        if (!nameMatch)
            continue;
        const teamMatch = rowHtml.match(teamRe);
        const cells = [];
        let c;
        cellRe.lastIndex = 0;
        while ((c = cellRe.exec(rowHtml)) !== null) {
            cells.push(c[1].replace(/<[^>]*>/g, "").trim());
        }
        const numeric = cells.filter((v) => /^-?\d+(\.\d+)?$/.test(v));
        const points = Number(numeric[numeric.length - 1]);
        if (!Number.isFinite(points))
            continue;
        out.push({
            name: nameMatch[1].trim(),
            team: teamMatch ? teamMatch[1].trim() : "",
            points
        });
    }
    return out;
}
export class FantasyProsProjectionSource {
    name;
    lastSkipReason;
    position;
    kind;
    season;
    week;
    scoring;
    fetchImpl;
    cache;
    dataDir;
    maxRows;
    force;
    optional;
    baseUrl;
    constructor(options) {
        this.position = options.position;
        this.kind = options.kind ?? "season";
        this.season = options.season;
        this.week = options.week;
        this.scoring = options.scoring ?? "PPR";
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.cache = options.cache;
        this.dataDir = options.dataDir;
        this.maxRows = options.maxRows;
        this.force = options.force ?? false;
        this.optional = options.optional ?? true;
        this.baseUrl = options.baseUrl ?? "https://www.fantasypros.com/nfl/projections";
        const label = this.kind === "weekly" ? `week-${this.week}` : "ros";
        this.name = `fantasypros-${this.position}-${label}`;
    }
    buildUrl() {
        const path = FP_POSITION_PATH[this.position] ?? "rb";
        const params = new URLSearchParams({ scoring: this.scoring });
        if (this.kind === "weekly" && this.week) {
            params.set("week", String(this.week));
        }
        return `${this.baseUrl}/${path}.php?${params.toString()}`;
    }
    async fetchProjections(_sport, _season, _scoringPeriod) {
        const url = this.buildUrl();
        try {
            const html = await this.loadHtml(url);
            const rows = parseFantasyProsRows(html);
            const limited = this.maxRows ? rows.slice(0, this.maxRows) : rows;
            if (limited.length === 0) {
                return this.finish([], `parsed 0 rows from ${url}`);
            }
            const candidates = limited.map((row) => ({
                name: row.name,
                team: row.team,
                positions: [normalizePosition(this.position, "RB")],
                projected_stats: { fantasy_points: row.points },
                projected_points: row.points,
                floor: Math.max(0, row.points * 0.55),
                ceiling: row.points * 1.6,
                confidence: 0.55
            }));
            return this.finish(candidates);
        }
        catch (cause) {
            return this.finish([], cause.message);
        }
    }
    async loadHtml(url) {
        if (this.cache && !this.force) {
            const entry = await fetchWithCache(url, {
                cache: this.cache,
                source: this.name,
                headers: { "User-Agent": UA },
                force: this.force
            });
            return entry.body;
        }
        const res = await this.fetchImpl(url, { headers: { "User-Agent": UA } });
        if (!res.ok) {
            throw new Error(`FantasyPros request to ${url} failed with status ${res.status}.`);
        }
        return res.text();
    }
    finish(candidates, skipReason) {
        if (skipReason && this.optional) {
            this.lastSkipReason = skipReason;
            return [];
        }
        if (skipReason) {
            throw new Error(skipReason);
        }
        return candidates;
    }
}

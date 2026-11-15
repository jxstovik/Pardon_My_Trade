import { createHash } from "node:crypto";
function resolveScope(snapshot, input) {
    if (input.leagueId && ![snapshot.league.league_id, snapshot.league.external_id].includes(input.leagueId))
        throw new Error("News league scope differs from the snapshot.");
    const players = new Map();
    const aliases = new Map();
    for (const player of [...snapshot.players, ...snapshot.free_agents]) {
        players.set(player.player_id, player);
        for (const id of [player.player_id, player.external_id, ...Object.values(player.external_ids)]) {
            if (!id)
                continue;
            const ids = aliases.get(id) ?? new Set();
            ids.add(player.player_id);
            aliases.set(id, ids);
        }
    }
    const canonical = (id) => {
        const ids = aliases.get(id);
        return ids?.size === 1 ? [...ids][0] : undefined;
    };
    const team = input.teamId ? snapshot.league.teams.filter(t => [t.team_id, t.external_id].includes(input.teamId)) : [];
    if (input.teamId && team.length !== 1)
        throw new Error("News team scope is missing or ambiguous in the snapshot.");
    const rosterIds = team.flatMap(t => [...t.roster.starters, ...t.roster.bench, ...t.roster.injured_reserve, ...t.roster.taxi]).flatMap(s => s.player_id ? [s.player_id] : []);
    const requested = input.teamId ? [...rosterIds, ...(input.playerIds ?? []), ...(input.candidatePlayerIds ?? [])] : input.playerIds || input.candidatePlayerIds ? [...(input.playerIds ?? []), ...(input.candidatePlayerIds ?? [])] : [...players.keys()];
    const unresolved = new Set(requested.filter(id => !canonical(id)));
    const ids = new Set(requested.flatMap(id => canonical(id) ? [canonical(id)] : []));
    return { players, canonical, ids, unresolved, team };
}
function readCursor(value) {
    if (!value)
        return undefined;
    try {
        if (value.length > 2048)
            throw new Error();
        const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (c.v !== 1 || !Number.isSafeInteger(c.offset) || c.offset < 0 || !/^[a-f0-9]{64}$/.test(c.fingerprint) || !Number.isFinite(Date.parse(c.since)) || !Number.isFinite(Date.parse(c.until)))
            throw new Error();
        return c;
    }
    catch {
        throw new Error("Invalid news context cursor; restart without cursor.");
    }
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rank = { high: 3, medium: 2, low: 1 };
const clip = (text, size) => text?.slice(0, size) ?? "";
function windowFor(input, now, cursor) {
    const until = input.until ?? cursor?.until ?? now.toISOString();
    const since = input.since ?? cursor?.since ?? new Date(Date.parse(until) - 7 * 86400000).toISOString();
    if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(since) > Date.parse(until))
        throw new Error("Invalid news window: since must be at or before until.");
    return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}
/** Budget applies to JSON.stringify(data), excluding the common MCP envelope. */
function boundedPage(rows, key, input, window, identity, metadata, responseMetadata = {}) {
    const maxChars = input.maxChars ?? 16000;
    const limit = input.limit ?? 50;
    if (!Number.isInteger(maxChars) || maxChars < 2048 || maxChars > 64000 || !Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Use maxChars 2048..64000 and limit 1..500.");
    const cursor = readCursor(input.cursor);
    const fingerprint = hash({ identity, window, rows, metadata });
    if (cursor && (cursor.fingerprint !== fingerprint || cursor.since !== window.since || cursor.until !== window.until || cursor.offset >= rows.length))
        throw new Error("News context changed or cursor scope differs; restart without cursor. No items were skipped.");
    const start = cursor?.offset ?? 0;
    const response = (end) => ({
        ...metadata,
        ...responseMetadata,
        [key]: rows.slice(start, end),
        total_count: rows.length,
        returned_count: end - start,
        truncated: end < rows.length,
        next_cursor: end < rows.length ? Buffer.from(JSON.stringify({ v: 1, offset: end, fingerprint, ...window })).toString("base64url") : null,
        filters: window,
        omissions: {
            ...metadata.omissions,
            remaining_count: rows.length - end,
            remaining_high_impact_count: rows.slice(end).filter(r => r.impact === "high").length
        },
        next_step: end < rows.length ? "Repeat the same scope with next_cursor; source text is compacted, not complete." : null
    });
    let end = Math.min(rows.length, start + limit);
    while (end > start && JSON.stringify(response(end)).length > maxChars)
        end--;
    const result = response(end);
    if ((end === start && start < rows.length) || JSON.stringify(result).length > maxChars)
        throw new Error("Context item/metadata exceeds maxChars; increase maxChars or narrow scope. No items were skipped.");
    return result;
}
export function buildNewsContext(snapshot, rows, input, now = new Date(), responseMetadata = {}) {
    const scope = resolveScope(snapshot, input);
    const window = windowFor(input, now, readCursor(input.cursor));
    let outOfScope = 0, unmapped = 0, outside = 0, invalid = 0;
    let unmappedHigh = 0, invalidHigh = 0, outsideHigh = 0;
    const selected = [];
    for (const row of rows) {
        const id = scope.canonical(row.player_id);
        if (!id) {
            unmapped++;
            if (row.impact === "high")
                unmappedHigh++;
            continue;
        }
        if (!scope.ids.has(id)) {
            outOfScope++;
            continue;
        }
        const time = Date.parse(row.published_at);
        if (!Number.isFinite(time)) {
            invalid++;
            if (row.impact === "high")
                invalidHigh++;
            continue;
        }
        if (time < Date.parse(window.since) || time > Date.parse(window.until)) {
            outside++;
            if (row.impact === "high")
                outsideHigh++;
            continue;
        }
        selected.push({ ...row, player_id: id });
    }
    selected.sort((a, b) => rank[b.impact] - rank[a.impact] || Date.parse(b.published_at) - Date.parse(a.published_at) || a.news_id.localeCompare(b.news_id) || hash(a).localeCompare(hash(b)));
    const compact = selected.map(row => ({
        news_id: row.news_id, player_id: row.player_id, full_name: clip(scope.players.get(row.player_id)?.full_name, 120), source: clip(row.source, 80),
        headline: clip(row.headline, 240), summary: clip(row.summary, 600), impact: row.impact,
        published_at: row.published_at, ingested_at: row.ingested_at, source_url: clip(row.source_url, 400),
        text_truncated: row.headline.length > 240 || row.summary.length > 600 || (row.source_url?.length ?? 0) > 400 || row.source.length > 80
    }));
    const covered = new Set(selected.map(row => row.player_id));
    return boundedPage(compact, "news", input, window, { snapshot: snapshot.snapshot_id, team: scope.team.map(t => t.team_id), players: [...scope.ids].sort(), unresolved: [...scope.unresolved].sort() }, {
        coverage: { basis: "persisted_player_linked_items_only", scoped_player_count: scope.ids.size, players_with_news_count: covered.size, players_without_observed_news_count: scope.ids.size - covered.size, unresolved_player_count: scope.unresolved.size, source_completeness: "unknown", no_news_is_not_clearance: true },
        scope: { league_id: snapshot.league.league_id, team_id: scope.team[0]?.team_id ?? null, selection: input.teamId ? "roster_plus_explicit_candidates" : input.playerIds || input.candidatePlayerIds ? "explicit_players" : "snapshot_players" },
        omissions: { out_of_scope_count: outOfScope, unmapped_item_count: unmapped, unmapped_high_impact_count: unmappedHigh, outside_window_count: outside, outside_window_high_impact_count: outsideHigh, invalid_timestamp_count: invalid, invalid_timestamp_high_impact_count: invalidHigh, compacted_item_count: compact.filter(row => row.text_truncated).length },
        snapshot_id: snapshot.snapshot_id
    }, responseMetadata);
}
/** Read historical canonical/external league buckets without lexical date filtering. */
export async function readPersistedNews(store, snapshot) {
    const buckets = await Promise.all([...new Set([snapshot.league.league_id, snapshot.league.external_id])].map(id => store.getNews(id)));
    const canonical = resolveScope(snapshot, {}).canonical;
    const rows = new Map();
    for (const row of buckets.flat()) {
        const key = JSON.stringify([row.source, row.news_id, canonical(row.player_id) ?? row.player_id]);
        const previous = rows.get(key);
        if (!previous || Date.parse(row.ingested_at) > Date.parse(previous.ingested_at))
            rows.set(key, row);
    }
    return [...rows.values()];
}
export function buildInjuryContext(snapshot, input, now = new Date()) {
    const scope = resolveScope(snapshot, input);
    const window = windowFor(input, now, readCursor(input.cursor));
    const watched = new Set(["out", "injured_reserve", "doubtful", "questionable"]);
    const scoped = [...scope.ids].flatMap(id => scope.players.get(id) ? [scope.players.get(id)] : []);
    const unknown = scoped.filter(p => !p.status || !p.injury_status || p.status === "unknown" || p.injury_status === "unknown").length;
    // Current statuses must not disappear just because their last update predates since.
    const alerts = scoped.filter(p => watched.has(p.status) || watched.has(p.injury_status)).map(p => ({
        player_id: p.player_id, full_name: clip(p.full_name, 120), team: clip(p.team, 40), positions: p.positions,
        status: p.status, injury_status: p.injury_status, updated_at: p.updated_at,
        stale: !Number.isFinite(Date.parse(p.updated_at)) || Date.parse(p.updated_at) < Date.parse(window.since) || Date.parse(p.updated_at) > Date.parse(window.until),
        impact: ([p.status, p.injury_status].some(s => ["out", "injured_reserve", "doubtful"].includes(s)) ? "high" : "medium")
    })).sort((a, b) => rank[b.impact] - rank[a.impact] || a.player_id.localeCompare(b.player_id));
    return boundedPage(alerts, "players", input, window, { snapshot: snapshot.snapshot_id, team: scope.team.map(t => t.team_id), players: [...scope.ids].sort(), unresolved: [...scope.unresolved].sort() }, {
        snapshot_id: snapshot.snapshot_id,
        scope: { league_id: snapshot.league.league_id, team_id: scope.team[0]?.team_id ?? null, selection: input.teamId ? "roster_plus_explicit_candidates" : input.playerIds || input.candidatePlayerIds ? "explicit_players" : "snapshot_players" },
        coverage: { basis: "snapshot_status_not_live_injury_feed", scoped_player_count: scope.ids.size, unresolved_player_count: scope.unresolved.size, unknown_status_count: unknown, source_completeness: "unknown", no_news_is_not_clearance: true, stale_alert_count: alerts.filter(p => p.stale).length },
        omissions: { out_of_scope_count: scope.players.size - scoped.length, non_alert_status_count: scoped.length - alerts.length },
        window_semantics: "Freshness only; stale current injury statuses remain visible."
    });
}

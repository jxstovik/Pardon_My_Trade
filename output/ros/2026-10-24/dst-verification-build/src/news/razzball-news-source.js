import { cleanNewsText, filterNewsSince, inferNewsImpact, newsContentHash, normalizePlayerName, parseNewsDate } from "./news-utils.js";
export const DEFAULT_RAZZBALL_NEWS_URL = "https://football.razzball.com/feed/";
/**
 * Public Razzball WordPress RSS source. The feed contains player names as
 * categories, not stable player ids, so an explicit resolver/map is required
 * for player-linked NewsItems. Articles without a resolvable player are skipped.
 */
export class RazzballNewsSource {
    fetchImpl;
    feedUrl;
    playerIdsByName;
    playerIdResolver;
    constructor(options = {}) {
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.feedUrl = options.feedUrl ?? DEFAULT_RAZZBALL_NEWS_URL;
        this.playerIdsByName = options.playerIdsByName;
        this.playerIdResolver = options.playerIdResolver;
    }
    async fetchNews(_leagueId, since) {
        try {
            const response = await this.fetchImpl(this.feedUrl, {
                headers: {
                    accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
                    "user-agent": "pardon-my-trade/0.2 (+fantasy-news)"
                }
            });
            if (!response.ok)
                return [];
            const body = await response.text();
            return parseRazzballNews(body, {
                since,
                playerIdsByName: this.playerIdsByName,
                playerIdResolver: this.playerIdResolver
            });
        }
        catch {
            return [];
        }
    }
}
export function parseRazzballNews(xml, options = {}) {
    if (!xml || typeof xml !== "string")
        return [];
    const ingestedAt = options.ingestedAt ?? new Date().toISOString();
    const items = [];
    for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
        const itemXml = match[1] ?? "";
        const headline = cleanNewsText(readTag(itemXml, "title"));
        const summary = cleanNewsText(readTag(itemXml, "description") ?? readTag(itemXml, "content:encoded")) || headline;
        const publishedAt = parseNewsDate(readTag(itemXml, "pubDate") ?? readTag(itemXml, "published"));
        const sourceRecordId = cleanNewsText(readTag(itemXml, "post-id") ?? readTag(itemXml, "guid") ?? readTag(itemXml, "link"));
        const sourceUrl = cleanNewsText(readTag(itemXml, "link"));
        if (!headline || !publishedAt || !sourceRecordId)
            continue;
        const playerIds = resolvePlayerIds(itemXml, options);
        for (const playerId of playerIds) {
            const newsId = playerIds.length === 1 ? sourceRecordId : `${sourceRecordId}:${playerId}`;
            items.push({
                schema_version: "1.0.0",
                created_at: ingestedAt,
                updated_at: ingestedAt,
                source_system: "razzball-news",
                source_record_id: sourceRecordId,
                news_id: newsId,
                player_id: playerId,
                source: "razzball",
                headline,
                summary,
                impact: inferNewsImpact(headline, summary),
                published_at: publishedAt,
                ingested_at: ingestedAt,
                ...(sourceUrl && /^https?:\/\//i.test(sourceUrl) ? { source_url: sourceUrl } : {}),
                content_hash: newsContentHash(headline, summary),
                parser_version: "razzball-news-v1"
            });
        }
    }
    return filterNewsSince(items, options.since);
}
function resolvePlayerIds(itemXml, options) {
    const ids = new Set();
    addPlayerId(ids, readTag(itemXml, "player_id"));
    addPlayerId(ids, readTag(itemXml, "playerId"));
    const categories = [...itemXml.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
        .map((match) => cleanNewsText(match[1]))
        .filter((category) => Boolean(category));
    for (const category of categories) {
        const resolved = options.playerIdResolver?.(category) ?? lookupPlayerId(options.playerIdsByName, category);
        addPlayerId(ids, resolved);
    }
    return [...ids];
}
function lookupPlayerId(lookup, name) {
    if (!lookup)
        return undefined;
    const normalized = normalizePlayerName(name);
    if (lookup instanceof Map) {
        return lookup.get(normalized) ?? lookup.get(name);
    }
    for (const [key, value] of Object.entries(lookup)) {
        if (normalizePlayerName(key) === normalized)
            return value;
    }
    return undefined;
}
function addPlayerId(ids, value) {
    const normalized = value?.trim();
    if (normalized && normalized !== "0")
        ids.add(normalized);
}
function readTag(xml, tag) {
    const escapedTag = tag.replace(":", "\\:");
    return new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i").exec(xml)?.[1];
}

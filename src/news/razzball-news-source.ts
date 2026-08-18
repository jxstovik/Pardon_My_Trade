import type { NewsItem } from "../models/types.js";
import { cleanNewsText, filterNewsSince, inferNewsImpact, newsContentHash, normalizePlayerName, parseNewsDate } from "./news-utils.js";
import type { NewsSource } from "./news-source.js";

export type PlayerIdLookup = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export interface RazzballNewsSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly feedUrl?: string;
  /** Resolve Razzball's player-name categories to canonical/external player ids. */
  readonly playerIdsByName?: PlayerIdLookup;
  readonly playerIdResolver?: (name: string) => string | undefined;
}

export interface RazzballNewsParseOptions {
  readonly since?: string;
  readonly ingestedAt?: string;
  readonly playerIdsByName?: PlayerIdLookup;
  readonly playerIdResolver?: (name: string) => string | undefined;
}

export const DEFAULT_RAZZBALL_NEWS_URL = "https://football.razzball.com/feed/";

/**
 * Public Razzball WordPress RSS source. The feed contains player names as
 * categories, not stable player ids, so an explicit resolver/map is required
 * for player-linked NewsItems. Articles without a resolvable player are skipped.
 */
export class RazzballNewsSource implements NewsSource {
  private readonly fetchImpl: typeof fetch;
  private readonly feedUrl: string;
  private readonly playerIdsByName?: PlayerIdLookup;
  private readonly playerIdResolver?: (name: string) => string | undefined;

  constructor(options: RazzballNewsSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.feedUrl = options.feedUrl ?? DEFAULT_RAZZBALL_NEWS_URL;
    this.playerIdsByName = options.playerIdsByName;
    this.playerIdResolver = options.playerIdResolver;
  }

  async fetchNews(_leagueId: string, since?: string): Promise<NewsItem[]> {
    try {
      const response = await this.fetchImpl(this.feedUrl, {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
          "user-agent": "pardon-my-trade/0.2 (+fantasy-news)"
        }
      });
      if (!response.ok) return [];
      const body = await response.text();
      return parseRazzballNews(body, {
        since,
        playerIdsByName: this.playerIdsByName,
        playerIdResolver: this.playerIdResolver
      });
    } catch {
      return [];
    }
  }
}

export function parseRazzballNews(xml: string, options: RazzballNewsParseOptions = {}): NewsItem[] {
  if (!xml || typeof xml !== "string") return [];
  const ingestedAt = options.ingestedAt ?? new Date().toISOString();
  const items: NewsItem[] = [];

  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const itemXml = match[1] ?? "";
    const headline = cleanNewsText(readTag(itemXml, "title"));
    const summary = cleanNewsText(readTag(itemXml, "description") ?? readTag(itemXml, "content:encoded")) || headline;
    const publishedAt = parseNewsDate(readTag(itemXml, "pubDate") ?? readTag(itemXml, "published"));
    const sourceRecordId = cleanNewsText(readTag(itemXml, "post-id") ?? readTag(itemXml, "guid") ?? readTag(itemXml, "link"));
    const sourceUrl = cleanNewsText(readTag(itemXml, "link"));
    if (!headline || !publishedAt || !sourceRecordId) continue;

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

function resolvePlayerIds(itemXml: string, options: RazzballNewsParseOptions): string[] {
  const ids = new Set<string>();
  addPlayerId(ids, readTag(itemXml, "player_id"));
  addPlayerId(ids, readTag(itemXml, "playerId"));

  const categories = [...itemXml.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
    .map((match) => cleanNewsText(match[1]))
    .filter((category): category is string => Boolean(category));
  for (const category of categories) {
    const resolved = options.playerIdResolver?.(category) ?? lookupPlayerId(options.playerIdsByName, category);
    addPlayerId(ids, resolved);
  }
  return [...ids];
}

function lookupPlayerId(lookup: PlayerIdLookup | undefined, name: string): string | undefined {
  if (!lookup) return undefined;
  const normalized = normalizePlayerName(name);
  if (lookup instanceof Map) {
    return lookup.get(normalized) ?? lookup.get(name);
  }
  for (const [key, value] of Object.entries(lookup)) {
    if (normalizePlayerName(key) === normalized) return value;
  }
  return undefined;
}

function addPlayerId(ids: Set<string>, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized && normalized !== "0") ids.add(normalized);
}

function readTag(xml: string, tag: string): string | undefined {
  const escapedTag = tag.replace(":", "\\:");
  return new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i").exec(xml)?.[1];
}

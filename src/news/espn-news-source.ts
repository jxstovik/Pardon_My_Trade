import type { NewsItem } from "../models/types.js";
import { filterNewsSince, cleanNewsText, inferNewsImpact, newsContentHash, parseNewsDate } from "./news-utils.js";
import type { NewsSource } from "./news-source.js";

export interface EspnNewsSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly limit?: number;
}

export interface EspnNewsParseOptions {
  readonly since?: string;
  readonly ingestedAt?: string;
}

export const DEFAULT_ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";

/**
 * Public ESPN NFL news source. ESPN occasionally returns video or league-only
 * articles, so records without a stable athlete id are deliberately omitted.
 * Network, JSON, and payload-shape failures degrade to an empty result.
 */
export class EspnNewsSource implements NewsSource {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly limit: number;

  constructor(options: EspnNewsSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_ESPN_NEWS_URL;
    this.limit = options.limit ?? 50;
  }

  async fetchNews(_leagueId: string, since?: string): Promise<NewsItem[]> {
    try {
      const url = new URL(this.baseUrl);
      if (Number.isFinite(this.limit) && this.limit > 0) {
        url.searchParams.set("limit", String(Math.floor(this.limit)));
      }
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "pardon-my-trade/0.2 (+fantasy-news)"
        }
      });
      if (!response.ok) return [];
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        return [];
      }
      return parseEspnNews(data, { since });
    } catch {
      return [];
    }
  }
}

export function parseEspnNews(data: unknown, options: EspnNewsParseOptions = {}): NewsItem[] {
  const root = asRecord(data);
  const articles = root?.articles;
  if (!Array.isArray(articles)) return [];

  const ingestedAt = options.ingestedAt ?? new Date().toISOString();
  const items: NewsItem[] = [];
  for (const value of articles) {
    const article = asRecord(value);
    if (!article) continue;

    const articleId = asId(article.id ?? article.newsId ?? article.guid);
    const headline = cleanNewsText(asText(article.headline ?? article.title));
    const summary = cleanNewsText(asText(article.description ?? article.summary ?? article.story)) || headline;
    const publishedAt = parseNewsDate(article.published ?? article.publishedAt ?? article.date);
    if (!articleId || !headline || !publishedAt) continue;

    const playerIds = extractPlayerIds(article);
    const sourceUrl = extractSourceUrl(article);
    for (const playerId of playerIds) {
      const newsId = playerIds.length === 1 ? articleId : `${articleId}:${playerId}`;
      items.push({
        schema_version: "1.0.0",
        created_at: ingestedAt,
        updated_at: ingestedAt,
        source_system: "espn-news",
        source_record_id: articleId,
        news_id: newsId,
        player_id: playerId,
        source: "espn",
        headline,
        summary,
        impact: inferNewsImpact(headline, summary),
        published_at: publishedAt,
        ingested_at: ingestedAt,
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        content_hash: newsContentHash(headline, summary),
        parser_version: "espn-news-v1"
      });
    }
  }

  return filterNewsSince(items, options.since);
}

function extractSourceUrl(article: Record<string, unknown>): string | undefined {
  const links = asRecord(article.links);
  const web = asRecord(links?.web);
  const value = article.link ?? web?.href ?? web?.url;
  const text = asText(value)?.trim();
  return text && /^https?:\/\//i.test(text) ? text : undefined;
}

function extractPlayerIds(article: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  addId(ids, article.playerId);
  addId(ids, article.athleteId);
  addId(ids, asRecord(article.player)?.id);
  addId(ids, asRecord(article.athlete)?.id);

  const categories = article.categories;
  if (!Array.isArray(categories)) return [...ids];
  for (const value of categories) {
    const category = asRecord(value);
    if (!category || asText(category.type)?.toLowerCase() !== "athlete") continue;
    addId(ids, category.athleteId);
    addId(ids, asRecord(category.athlete)?.id);
  }
  return [...ids];
}

function addId(ids: Set<string>, value: unknown): void {
  const id = asId(value);
  if (id) ids.add(id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function asId(value: unknown): string | undefined {
  const text = asText(value)?.trim();
  return text && text !== "0" ? text : undefined;
}

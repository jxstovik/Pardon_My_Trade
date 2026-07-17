import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NewsItem } from "../models/types.js";

export interface NewsSource {
  fetchNews(leagueId: string, since?: string): Promise<NewsItem[]>;
}

interface RawNewsItem {
  news_id: string;
  player_id: string;
  source: string;
  headline: string;
  summary: string;
  impact: "low" | "medium" | "high";
  published_at: string;
  ingested_at: string;
}

export class FixtureNewsSource implements NewsSource {
  constructor(private readonly fixturePath: string) {}

  async fetchNews(_leagueId: string, since?: string): Promise<NewsItem[]> {
    const absolutePath = resolve(this.fixturePath);
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as RawNewsItem[];
    const base = new Date().toISOString();

    const items: NewsItem[] = parsed.map((item) => ({
      schema_version: "1.0.0",
      created_at: base,
      updated_at: base,
      source_system: "news-fixture",
      source_record_id: item.news_id,
      news_id: item.news_id,
      player_id: item.player_id,
      source: item.source,
      headline: item.headline,
      summary: item.summary,
      impact: item.impact,
      published_at: item.published_at,
      ingested_at: item.ingested_at
    }));

    if (!since) return items;
    return items.filter((item) => item.published_at >= since);
  }
}

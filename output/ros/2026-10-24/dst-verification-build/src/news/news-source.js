import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export class FixtureNewsSource {
    fixturePath;
    constructor(fixturePath) {
        this.fixturePath = fixturePath;
    }
    async fetchNews(_leagueId, since) {
        const absolutePath = resolve(this.fixturePath);
        const raw = await readFile(absolutePath, "utf8");
        const parsed = JSON.parse(raw);
        const base = new Date().toISOString();
        const items = parsed.map((item) => ({
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
        if (!since)
            return items;
        return items.filter((item) => item.published_at >= since);
    }
}

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PmtError } from "../errors.js";
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * File-backed cache for raw recommendation fetches (Razzball, FFToday,
 * FantasyPros HTML/JSON). Each entry lives in two files:
 *
 *   cache-{sha1(url)}.json  -> metadata + body
 *
 * The cache is keyed by URL (sha1, 40 hex chars). TTL is checked on read;
 * stale entries are transparently refreshed. Disk eviction (`--clear-cache`)
 * removes everything in the directory.
 */
export class RecommendationCache {
    dir;
    ttlMs;
    clock;
    constructor(options) {
        this.dir = options.directory;
        this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
        this.clock = options.clock ?? (() => new Date());
    }
    keyFor(url) {
        return createHash("sha1").update(url).digest("hex");
    }
    pathFor(url) {
        return join(this.dir, `cache-${this.keyFor(url)}.json`);
    }
    async get(url) {
        const path = this.pathFor(url);
        let raw;
        try {
            raw = await readFile(path, "utf8");
        }
        catch {
            return undefined;
        }
        let entry;
        try {
            entry = JSON.parse(raw);
        }
        catch (cause) {
            throw new PmtError({
                code: "CACHE_CORRUPT",
                message: `Cache entry at ${path} could not be parsed as JSON.`,
                source: "projection_source",
                retryable: false
            });
        }
        if (this.isStale(entry))
            return undefined;
        return entry;
    }
    async set(url, entry) {
        await mkdir(this.dir, { recursive: true });
        const full = { ...entry, fetched_at: this.clock().toISOString() };
        await writeFile(this.pathFor(url), JSON.stringify(full, null, 2), "utf8");
        return full;
    }
    async clear() {
        await mkdir(this.dir, { recursive: true });
        const files = await readdir(this.dir).catch(() => []);
        let removed = 0;
        for (const file of files) {
            if (!file.startsWith("cache-"))
                continue;
            try {
                await rm(join(this.dir, file));
                removed += 1;
            }
            catch {
                // best-effort
            }
        }
        return removed;
    }
    async stats() {
        await mkdir(this.dir, { recursive: true });
        const files = await readdir(this.dir).catch(() => []);
        let sizeBytes = 0;
        let entries = 0;
        for (const file of files) {
            if (!file.startsWith("cache-"))
                continue;
            entries += 1;
            try {
                const info = await stat(join(this.dir, file));
                sizeBytes += info.size;
            }
            catch {
                // ignore
            }
        }
        return { entries, sizeBytes, ttlMs: this.ttlMs };
    }
    isStale(entry) {
        const fetched = Date.parse(entry.fetched_at);
        if (Number.isNaN(fetched))
            return true;
        return this.clock().getTime() - fetched > this.ttlMs;
    }
}
export async function fetchWithCache(url, options) {
    if (!options.force) {
        const cached = await options.cache.get(url);
        if (cached)
            return cached;
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const headers = {
        "User-Agent": "pardon-my-trade/0.2 (+fantasy-recommendations)",
        Accept: "text/html,application/json,text/markdown;q=0.9,*/*;q=0.5",
        ...options.headers
    };
    if (options.cookies)
        headers["Cookie"] = options.cookies;
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
        const status = response.status;
        const retryable = status === 429 || status >= 500;
        throw new PmtError({
            code: "EXTERNAL_FETCH_FAILED",
            message: `Fetch of ${url} failed with status ${status}.`,
            source: "projection_source",
            retryable
        });
    }
    const contentType = response.headers.get("content-type") ?? "text/plain";
    const body = await response.text();
    return options.cache.set(url, {
        url,
        source: options.source,
        body,
        content_type: contentType
    });
}

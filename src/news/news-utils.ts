import { createHash } from "node:crypto";
import type { NewsItem } from "../models/types.js";

export function parseNewsDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value !== "string" || value.trim() === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return parseNewsDate(numeric);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function cleanNewsText(value: string | undefined): string {
  if (!value) return "";
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const decoded = withoutCdata
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, " ");
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
}

export function inferNewsImpact(headline: string, summary: string): NewsItem["impact"] {
  const text = `${headline} ${summary}`.toLowerCase();
  if (/season[- ]ending|injured reserve|\bir\b|\bout\b|surgery|suspended|released|waived|cut/.test(text)) {
    return "high";
  }
  if (/injur|questionable|doubtful|limited|practice|hamstring|concussion|illness/.test(text)) {
    return "medium";
  }
  return "low";
}

export function filterNewsSince(items: NewsItem[], since?: string): NewsItem[] {
  if (!since) return items;
  const sinceTime = Date.parse(since);
  if (Number.isNaN(sinceTime)) return items;
  return items.filter((item) => Date.parse(item.published_at) >= sinceTime);
}

export function normalizePlayerName(value: string): string {
  return cleanNewsText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function newsContentHash(headline: string, summary: string): string {
  return createHash("sha256").update(`${headline}\n${summary}`, "utf8").digest("hex");
}

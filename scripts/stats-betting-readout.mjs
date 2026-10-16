#!/usr/bin/env node
/** Advisory-only readout of a supplied raw-stat sample bundle and league rules. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { scorePlayerSamples, evaluatePlayerProp } = await import(resolve(root, "dist/src/stats-betting/bridge.js"));
const bundleArg = process.argv.indexOf("--bundle");
if (bundleArg < 0 || !process.argv[bundleArg + 1]) {
  throw new Error("Usage: node scripts/stats-betting-readout.mjs --bundle bundle.json [--quote archived-quote.json]");
}
const bundle = JSON.parse(readFileSync(process.argv[bundleArg + 1], "utf8"));
if (!bundle.player_id || !["QB", "RB", "WR", "TE"].includes(bundle.position) ||
    !bundle.scoring || !Array.isArray(bundle.samples) || bundle.status !== "conditional_on_recorded_game") {
  throw new Error("Bundle requires a GSIS player ID, valid skill position, scoring rules, samples and conditional status");
}
const points = scorePlayerSamples(bundle.scoring, [bundle.position], bundle.samples);
const sorted = [...points.pointSamples].sort((a, b) => a - b);
const quantile = (p) => sorted[Math.floor(p * (sorted.length - 1))];
const result = {
  player_id: bundle.player_id, position: bundle.position, season: bundle.season, week: bundle.week,
  source: bundle.source, status: bundle.status,
  fantasy: { sample_count: points.pointSamples.length, mean_points: points.meanPoints,
             p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9) },
  betting: { status: "no_timestamped_quote" }
};
const quoteArg = process.argv.indexOf("--quote");
if (quoteArg >= 0) {
  if (!process.argv[quoteArg + 1]) throw new Error("--quote requires a JSON file");
  const quote = JSON.parse(readFileSync(process.argv[quoteArg + 1], "utf8"));
  if (!quote.book || !quote.observed_at || !bundle.forecast_cutoff ||
      Number.isNaN(Date.parse(quote.observed_at)) || Number.isNaN(Date.parse(bundle.forecast_cutoff)) ||
      Date.parse(quote.observed_at) > Date.parse(bundle.forecast_cutoff)) {
    throw new Error("Quote requires book, timestamp and an observed time no later than the forecast cutoff");
  }
  const evaluation = evaluatePlayerProp(bundle.samples, quote.stat, quote.line, quote.odds);
  result.betting = { status: "conditional_ev_only_not_roi", book: quote.book, observed_at: quote.observed_at,
                     stat: quote.stat, line: quote.line, ...evaluation };
}
console.log(JSON.stringify(result, null, 2));

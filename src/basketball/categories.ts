import { z } from "zod";
import { CATEGORIES, type Category } from "./contracts.js";

const nonnegative = z.number().finite().nonnegative();
export const StatLineSchema = z.object({
  PTS: nonnegative, REB: nonnegative, AST: nonnegative, ST: nonnegative, BLK: nonnegative,
  "3PTM": nonnegative, FGM: nonnegative, FGA: nonnegative, FTM: nonnegative, FTA: nonnegative
}).strict().refine(s => s.FGM <= s.FGA && s.FTM <= s.FTA && s["3PTM"] <= s.FGM, "Makes cannot exceed attempts; threes cannot exceed field goals")
  .refine(s => Math.abs(s.PTS - (2 * s.FGM + s["3PTM"] + s.FTM)) < 1e-6, "Points must agree with field goals, threes and free throws");
export type StatLine = z.infer<typeof StatLineSchema>;
export type CategoryTotals = StatLine & {"FG%": number | null; "FT%": number | null};

/** Complete counted appearances only. Missing rows/DNP/eligibility are an upstream responsibility. */
export function aggregateCategories(lines: unknown[]): CategoryTotals {
  const stats = lines.map(line => StatLineSchema.parse(line));
  const sum: StatLine = {PTS: 0, REB: 0, AST: 0, ST: 0, BLK: 0, "3PTM": 0, FGM: 0, FGA: 0, FTM: 0, FTA: 0};
  for (const stat of stats) for (const key of Object.keys(sum) as (keyof StatLine)[]) sum[key] += stat[key];
  if (Object.values(sum).some(value => !Number.isFinite(value))) throw new Error("Category aggregation overflow");
  return {...sum, "FG%": sum.FGA === 0 ? null : sum.FGM / sum.FGA, "FT%": sum.FTA === 0 ? null : sum.FTM / sum.FTA};
}

export type ComparisonPolicy = {kind: "synthetic-exact"; minimumFGA: number; minimumFTA: number};
export type CategoryResult = "win" | "loss" | "tie" | "unsupported";
/** No real Fantrax W/L/T until precision, equality and minimum rules are reconciled. */
export function compareCategories(a: CategoryTotals, b: CategoryTotals, policy: ComparisonPolicy | null): Record<Category, CategoryResult> {
  const results = Object.fromEntries(CATEGORIES.map(c => [c, "unsupported"])) as Record<Category, CategoryResult>;
  if (policy === null) return results;
  if (policy.kind !== "synthetic-exact" || !Number.isFinite(policy.minimumFGA) || !Number.isFinite(policy.minimumFTA) || policy.minimumFGA < 0 || policy.minimumFTA < 0) throw new Error("Unsupported category comparison policy");
  const {"FG%": aFG, "FT%": aFT, ...aStats} = a;
  const {"FG%": bFG, "FT%": bFT, ...bStats} = b;
  StatLineSchema.parse(aStats); StatLineSchema.parse(bStats);
  for (const c of CATEGORIES) {
    let left: number, right: number;
    if (c === "FG%" || c === "FT%") {
      const [made, attempted, minimum] = c === "FG%" ? ["FGM", "FGA", policy.minimumFGA] as const : ["FTM", "FTA", policy.minimumFTA] as const;
      if (a[attempted] === 0 || b[attempted] === 0 || a[attempted] < minimum || b[attempted] < minimum) continue;
      left = a[made] * b[attempted]; right = b[made] * a[attempted];
    } else {left = a[c]; right = b[c];}
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error("Category comparison overflow");
    results[c] = left > right ? "win" : left < right ? "loss" : "tie";
  }
  return results;
}

import type { BasketballCapture } from "./contracts.js";

type Period = BasketballCapture["leagueInfo"]["scoringPeriods"][number];
export function validatePeriods(periods: Period[]): Period[] {
  const ordered = [...periods].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const seen = new Set<number>();
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    if (seen.has(p.number) || !Number.isFinite(Date.parse(p.startDate)) || !Number.isFinite(Date.parse(p.endDate)) || Date.parse(p.endDate) < Date.parse(p.startDate)) throw new Error("Invalid or duplicate basketball period");
    if (i > 0 && (p.number <= ordered[i - 1]!.number || Date.parse(p.startDate) <= Date.parse(ordered[i - 1]!.endDate))) throw new Error("Overlapping or out-of-order basketball periods");
    seen.add(p.number);
  }
  return ordered;
}

export function resolveCalendar(capture: BasketballCapture, asOf: Date) {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Invalid basketball as-of instant");
  const periods = validatePeriods(capture.leagueInfo.scoringPeriods);
  validatePeriods(capture.leagueInfo.rosterPeriods);
  const current = periods.find(p => Date.parse(p.startDate) <= asOf.getTime() && Date.parse(p.endDate) >= asOf.getTime()) ?? null;
  const next = periods.find(p => Date.parse(p.startDate) > asOf.getTime()) ?? null;
  const state = current ? "in-period" : asOf < new Date(periods[0]!.startDate) ? "before-first-period" : next ? "between-imported-periods" : "after-last-period";
  return {state, current, next, importedPeriods: periods.length, accumulationStart: capture.leagueInfo.startDate,
    accumulationEnd: capture.leagueInfo.endDate, finalPeriodEnd: periods.at(-1)!.endDate,
    accumulationAndPeriodDatesDiffer: periods.at(-1)!.endDate.slice(0, 10) !== capture.leagueInfo.endDate,
    lockInstant: null, note: "Period boundaries are not verified lineup locks. Accumulation dates are a separate constraint; date/timezone reconciliation is required."};
}

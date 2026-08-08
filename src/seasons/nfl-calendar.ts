/**
 * Maps a date to an NFL fantasy scoring period (`YYYY-Wnn` or `YYYY-ROS`).
 *
 * The NFL regular season kicks off on the Thursday after Labor Day (the first
 * Monday of September). We use that as week 1 and count forward. Anything
 * outside the regular season (preseason, postseason, the Mar–Aug offseason)
 * resolves to a rest-of-season (`ROS`) period so the projection pipeline never
 * hardcodes a week number.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const REGULAR_SEASON_WEEKS = 18;

/** The calendar year a fantasy season is labelled by, given a date. */
export function seasonYearForDate(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan
  // Sept–Dec belong to the season starting that Sept; Jan–Feb belong to the
  // season that started the previous Sept; Mar–Aug is the offseason before
  // the season that starts that Sept.
  if (month >= 8) return year;
  if (month <= 1) return year - 1;
  return year;
}

/** Thursday of kickoff week for a given season year (first Thursday after Labor Day). */
export function firstGameDate(season: number): Date {
  const sept1 = new Date(Date.UTC(season, 8, 1));
  const dow = sept1.getUTCDay(); // 0 = Sun ... 1 = Mon
  // Days until the first Monday of September.
  const daysToMonday = (8 - dow) % 7;
  const laborDay = new Date(sept1.getTime() + daysToMonday * 24 * 60 * 60 * 1000);
  // Kickoff is the Thursday after Labor Day (Monday + 3).
  return new Date(laborDay.getTime() + 3 * 24 * 60 * 60 * 1000);
}

/** 1-based week number for a date within a season, or 0 before kickoff / >18 after. */
export function weekNumberForDate(date: Date, season: number): number {
  const kickoff = firstGameDate(season).getTime();
  const diffWeeks = Math.floor((date.getTime() - kickoff) / MS_PER_WEEK);
  return diffWeeks + 1;
}

/** True when the date falls outside the fantasy regular season. */
export function isOffseason(date: Date): boolean {
  const month = date.getMonth();
  if (month >= 2 && month <= 7) return true; // Mar–Aug
  const season = seasonYearForDate(date);
  const week = weekNumberForDate(date, season);
  return week < 1 || week > REGULAR_SEASON_WEEKS;
}

/**
 * Resolve the scoring period for a date. When `seasonOverride` is supplied the
 * week is computed against that season's kickoff (used when a league's stored
 * season should drive the period rather than the calendar).
 */
export function getCurrentScoringPeriod(date: Date = new Date(), seasonOverride?: string): string {
  const season = seasonOverride ?? String(seasonYearForDate(date));
  if (isOffseason(date)) return `${season}-ROS`;
  const week = weekNumberForDate(date, Number(season));
  if (week < 1 || week > REGULAR_SEASON_WEEKS) return `${season}-ROS`;
  return `${season}-W${week}`;
}

/** Parse the week number out of a scoring period string, or undefined for ROS. */
export function weekFromScoringPeriod(scoringPeriod: string): number | undefined {
  const match = /-W(\d+)$/.exec(scoringPeriod);
  return match ? Number(match[1]) : undefined;
}

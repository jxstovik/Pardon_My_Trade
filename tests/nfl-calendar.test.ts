import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentScoringPeriod,
  firstGameDate,
  isOffseason,
  seasonYearForDate,
  weekFromScoringPeriod,
  weekNumberForDate
} from "../src/seasons/nfl-calendar.js";

function d(s: string): Date {
  return new Date(s);
}

test("seasonYearForDate labels the season by its starting autumn", () => {
  assert.equal(seasonYearForDate(d("2025-09-10")), 2025);
  assert.equal(seasonYearForDate(d("2026-01-04")), 2025); // still 2025 season
  assert.equal(seasonYearForDate(d("2026-03-15")), 2026); // offseason before 2026
  assert.equal(seasonYearForDate(d("2026-09-10")), 2026);
});

test("firstGameDate is the Thursday after Labor Day", () => {
  // 2025 Labor Day = Sep 1 (Mon) -> kickoff Sep 4 (Thu)
  assert.equal(firstGameDate(2025).toISOString().slice(0, 10), "2025-09-04");
  // 2026 Labor Day = Sep 7 (Mon) -> kickoff Sep 10 (Thu)
  assert.equal(firstGameDate(2026).toISOString().slice(0, 10), "2026-09-10");
});

test("weekNumberForDate counts from kickoff", () => {
  assert.equal(weekNumberForDate(d("2025-09-04"), 2025), 1);
  assert.equal(weekNumberForDate(d("2025-09-11"), 2025), 2);
  assert.equal(weekNumberForDate(d("2026-01-04"), 2025), 18);
  assert.equal(weekNumberForDate(d("2025-09-01"), 2025), 0); // before kickoff
});

test("getCurrentScoringPeriod resolves ROS in the offseason", () => {
  assert.equal(getCurrentScoringPeriod(d("2025-09-04"), "2025"), "2025-W1");
  assert.equal(getCurrentScoringPeriod(d("2025-09-11"), "2025"), "2025-W2");
  assert.equal(getCurrentScoringPeriod(d("2026-01-04"), "2025"), "2025-W18"); // final regular-season week
  // Offseason (Mar–Aug) and postseason (Feb) -> ROS
  assert.equal(getCurrentScoringPeriod(d("2026-03-15"), "2026"), "2026-ROS");
  assert.equal(getCurrentScoringPeriod(d("2026-02-10"), "2025"), "2025-ROS");
});

test("getCurrentScoringPeriod without override uses the calendar season", () => {
  // A mid-September date resolves to the season that started that autumn.
  assert.equal(getCurrentScoringPeriod(d("2026-09-17")), "2026-W2");
});

test("isOffseason and weekFromScoringPeriod helpers", () => {
  assert.equal(isOffseason(d("2026-07-01")), true);
  assert.equal(isOffseason(d("2025-09-04")), false);
  assert.equal(weekFromScoringPeriod("2026-W07"), 7);
  assert.equal(weekFromScoringPeriod("2026-ROS"), undefined);
});

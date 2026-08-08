# 21 — In-Season Daily/Weekly Workflow (DraftKat)

Status: Phases 1–5 implemented.

This document tracks the work to run the Razzball/FFToday/ESPN projection
tooling as an automated, during-the-season loop. It is the implementation plan
discussed for the `feature/DraftKat` work and is meant to be picked up day-to-day.

## Goals
- Pull fresh projections every day without re-importing the league.
- Feed those projections into the Bayesian model + FF_Orchestrator so lineup,
  waiver, and trade recommendations stay current.
- Run on a schedule (daily/weekly) with human approval gating real moves.

## Current state (as of this doc)
- ✅ `pmt projections <razzball|razzball-premium|fftoday|espn> <pos>` — one-off
  pull + dated markdown to `data/recommendations/`, cached 1h, `--ppr`/`--week`/
  `--no-save`/`--max`/`--persist` flags.
- ✅ `pmt razzball-login` — premium cookie storage.
- ✅ `pmt projections --clear-cache` / `--cache-stats`.
- ✅ `pmt season-refresh [season] [week]` — pulls every configured source
  (`PMT_PROJECTION_SOURCES`), matches to the imported roster, persists to the
  SQLite store, and rebuilds model priors.
- ✅ `pmt projections --persist` — push an ad-hoc pull into the store.
- ✅ Projection persistence: `upsertProjections` / `getProjections` on
  `KnowledgeRepository` (SQLite + in-memory); `getLeagueSnapshot` now attaches
  the latest stored projections for the league's season.
- Engine room already present: `refresh` (news/injuries/notifications/weekly
  report), `ff-orchestrator` (action queue + human approval), `InMemoryScheduler`.

## Phase 1 — Make pulled data actionable (DONE)
- [x] `saveProjection`/`upsertProjections` + `getProjections` in
  `SqliteKnowledgeRepository` and `InMemoryKnowledgeRepository`.
- [x] `getLeagueSnapshot` attaches stored projections for the season.
- [x] `pmt season-refresh [season] [week]` (see `src/season-refresh.ts`).
- [x] `pmt projections --persist` bridge.

## Phase 2 — Season calendar (DONE)
- [x] `src/seasons/nfl-calendar.ts`: `getCurrentScoringPeriod(date)` → `YYYY-Wnn`
  (bye weeks / offseason handling). Used by `season-refresh` and URL/week args so
  nothing hardcodes the week. `pmt projections --auto` resolves the current week
  from the calendar.

## Phase 3 — Wire the scheduler (daily/weekly) (DONE)
- [x] `src/scheduler/scheduler.ts`: `ScheduledJob.days` (0 = Sunday) so jobs can
  be day-scoped, plus a `keepAlive` poll timer for headless runs.
- [x] `src/seasons/season-jobs.ts`: the three in-season jobs, each guarded by
  `isOffseason` (skips with a reason instead of running):
  - `season-daily` 06:00 (Mon–Sat): `razzball-login` → `season-refresh` at the
    calendar week → `refresh` → FF_Orchestrator (advisory; queues
    lineup/waiver/trade) → notifications.
  - `season-lineup-lock` Sunday 11:00: final start/sit lineup-lock notification.
  - `season-waiver-sweep` Tuesday 13:00: projection pull + waiver/trade sweep.
  - Times override via `PMT_SEASON_DAILY_TIME`, `PMT_SEASON_LINEUP_LOCK_TIME`,
    `PMT_SEASON_WAIVER_TIME`.
- [x] `src/seasons/season-orchestration.ts`: runs FF_Orchestrator against the
  last imported snapshot (which now carries persisted projections).
- [x] `pmt daemon [--run-now]` (headless) and `pmt serve --scheduler`.
- [x] Every step is fault-isolated: one failure is recorded in
  `SeasonJobResult.steps`/`errors`; the remaining steps still run.

## Phase 4 — Notifications & safety (DONE)
- [x] `src/notifications/season-alerts.ts` adds the doc 10 event types the loop
  needs: `lineup_lock_reminder`, `waiver_deadline_reminder`,
  `approval_request`, `projection_source_degraded`. Delivered through the
  existing `NotificationProvider`s and persisted to the V1 store.
- [x] Human-approval gate kept: jobs always run with
  `autoApproveLowRisk: false`, and every queued action emits an
  `approval_request` naming `pmt action-approve <actionId>` /
  `pmt action-reject <actionId>`. Nothing executes on its own.

## Phase 5 — Resilience (DONE)
- [x] `razzball-login` failure → free-tier fallback plus a
  `projection_source_degraded` alert; absent credentials are skipped quietly.
- [x] Sources take `optional: true` (default for the multi-source registry
  fan-out): FFToday 404s / parse breaks and missing premium sessions record
  `lastSkipReason` and return no candidates instead of throwing.
  `SeasonRefreshSummary.skipped` reports them, one alert per source.
- [x] `--force` bypasses the 1h cache: `pmt projections ... --force`,
  `pmt season-refresh [season] [week] --force`.

## End-state daily loop
`06:00` login → pull Razzball+FFToday+ESPN → persist → refresh news/injuries →
orchestrator queues lineup/waiver/trade → notifications. `Sun 11:00` lock
reminder. `Tue 13:00` waiver + trade sweep. User approves/rejects from the queue.

## Running it
```bash
pmt import-espn <leagueId> <season>   # once, seeds the snapshot pointer
pmt daemon                            # headless scheduler
pmt daemon --run-now                  # run the daily loop immediately, then schedule
pmt serve --scheduler                 # GUI + scheduler in one process
pmt action-queue                      # review what the loop proposed
pmt action-approve <actionId>         # the only path to a real move
```
Notifications land on the console, in `data/notifications.log`, and in the V1
store. Job runs are logged as one JSON line per run (`SeasonJobResult`).

# College basketball workflow

League: **Banging 3s** on Fantrax; team **jxstovik**; initial strategy **Balanced**.

- [Committee synthesis and operating plan](workflow-plan.md)
- [Progress and verified outputs](progress.md)
- [Implementation checklist](implementation-checklist.md)
- [Exact league evidence and authenticated observations](league-evidence.md)
- [Latest readiness report](../../artifacts/basketball/2026-10-27/readiness.md)
- [Critical planning judgment](committee/04-critical-judge.md) and [Luna implementation review](committee/06-luna-final-review.md)

## Current capability

The isolated `src/basketball/` module imports validated field-level evidence, stores immutable snapshots and policy revisions, resolves the explicit calendar, aggregates category statistics, and creates JSON/Markdown readiness reports. It also imports original official player CSV exports into immutable named identity/history revisions. It does not load the football database or orchestrator. No basketball model, legal optimizer, live platform writer or continuous ingestion service exists yet.

`banging-3s.capture.json` is a documented transcription of selected official fields, not a complete original API response. Its hash describes those fields. Real W/L/T comparisons are gated until category minimum/equality/precision semantics are reconciled. The synthetic demo declares its own exact comparison policy.

## Run locally

Use Node 26. This checkout has a local runtime:

```bash
export PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH"
npm run build
node dist/src/basketball/cli.js import --bundle config/basketball/banging-3s.capture.json
node dist/src/basketball/cli.js doctor
node dist/src/basketball/cli.js report
node dist/src/basketball/cli.js pool-import --csv data/basketball/mmioj1mvmvgsc3io/exports/2026-10-26/players-2025-26-per-game.csv --metadata data/basketball/mmioj1mvmvgsc3io/exports/2026-10-26/source.json
node dist/src/basketball/cli.js pool-report
node dist/src/basketball/cli.js strategies
node dist/src/basketball/cli.js demo --out artifacts/basketball/synthetic-demo
```

The default config is `config/basketball/banging-3s.json`; default storage is `data/basketball/mmioj1mvmvgsc3io/`. Both are independent of football configuration. The JSON snapshot/current/policy store is intended for one local writer; a production job/lease runner is a later milestone.

`refresh` reruns analysis on saved evidence. It does **not** fetch new source observations. `probe --endpoint getTeamRosters --period 1` separately attempts the documented GET endpoint and never imports or silently falls back to fixtures. Browser reads currently work; ordinary HTTP clients returned 403 during investigation.

To save a user-selected future pivot:

```bash
node dist/src/basketball/cli.js strategy-set --profile bigs
node dist/src/basketball/cli.js strategy-set --profile guards --overlay must-win --period 3
node dist/src/basketball/cli.js strategy-set --profile balanced
```

These commands save preferences and an audit chain. They do not create forecast benefits, abandon a category, submit moves or activate a model. A tactical overlay is active only in its declared period; its base profile persists.

## Validate

```bash
npm run lint
npm run build && node --test --test-isolation=none dist/tests/basketball-workflow.test.js dist/tests/basketball-player-pool.test.js dist/tests/basketball-history.test.js
```

Build before targeted compiled tests. See the progress report for real results and sandbox-sensitive existing regression checks.

## Recurring continuation

The app automation **Banging 3s basketball workflow** is active as a daily thread heartbeat intended for 08:00 America/New_York, through March 15. Its [saved prompt](daily-followup-prompt.md) resumes evidence checks and reversible implementation/research. The desktop/app must be available for local work. The October 26 and October 27 scheduled invocations were observed around 08:00 UTC, including after the persisted America/New_York change. That attempted correction did not establish 08:00 Eastern firing. The active schedule now explicitly targets 12:00 UTC during daylight time, with DST adaptation retained in the prompt. The next intended check is October 27 at 08:00 EDT; actual firing remains to be observed. This is not a deadline-monitoring service. Keep exact lock-relative jobs disabled until the underlying rules and transport are verified.

## Official player export

The [October 26 audit](../../artifacts/basketball/2026-10-26/player-pool-audit.md) covers 5,689 named IDs. In the authenticated league Players view select **All Available Players**, **2025-26 Reg Season - YTD**, **Tracked (Per-Game)**, then **Download all as CSV**. The control is desktop-only; use a temporary desktop viewport if needed and reset it afterward. A download event timed out even though the normal Downloads file was written; inspect the expected file before retrying. A hidden-control click also stalled this run, so do not click a nonvisible export control.

Retain original bytes privately, label the exact displayed source/season/basis and record the observation time of the actual download. Do not advance it on replay. The current importer accepts this specific prior-season export schema, not arbitrary forecasts. This history lacks GP/minutes/makes/attempts; all-zero rows have unresolved coverage. Player ranks, scores and ADP are preserved provider fields. There is no personal eight-category ranking yet.

## Standard history and schedule acquisition

The [October 27 history audit](../../artifacts/basketball/2026-10-27/history-audit.md) adds GP and rounded minutes/makes/attempts. Select the same history season and **Standard**; Standard displays per-game rates even after selecting Tracked totals. Check visible sample values and exported fields rather than inferring units from the button label. The download completes asynchronously; inspect the new file after the click instead of immediately repeating it. No download-event wait was necessary on October 27.

```bash
node dist/src/basketball/cli.js history-import --csv data/basketball/mmioj1mvmvgsc3io/exports/2026-10-27/players-2025-26-standard-per-game.csv --metadata data/basketball/mmioj1mvmvgsc3io/exports/2026-10-27/standard-source.json
node dist/src/basketball/cli.js history-report
```

History has its own immutable raw/normalized revisions, current pointer and per-ingestion receipts. It does not overwrite the earlier tracked pool. `usableForBaselineResearch` excludes zero-GP and quarantined rows; future consumers must honor it. Passing that screen establishes neither current-season coverage nor a forecast. The one-decimal rates cannot be converted into exact season totals.

The **Schedule** view also exports all matching rows. Original first-period schedule bytes and metadata are archived privately under `schedule-exports/`, with a [public local summary](../../artifacts/basketball/2026-10-27/schedule-summary.json). Dates have no year/verified timezone and CSV rows omit game IDs. One Sunday-column entry is labeled Monday midnight; no legal counted starts are inferred from this capture. The Stats selector exposed no projections option during this inspection.

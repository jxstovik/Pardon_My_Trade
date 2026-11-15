# Deterministic Tuesday projection persistence

## Invocation

Use Node 26 from the repository with an up-to-date compiled server:

```sh
npm run build
node scripts/refresh-tuesday-projections.mjs
```

The default is intended for Tuesday at **03:00 America/New_York**. The caller owns scheduling; this script neither installs nor changes cron jobs. It uses real published kickoff timestamps, so its selection is independent of the machine timezone and DST. No arguments selects the **first whole upcoming NFL week**, not a remaining game in an already-started week and not `calendar week + 1`.

For an explicitly requested current-week refresh:

```sh
node scripts/refresh-tuesday-projections.mjs --week 7
```

`--week=7` also works. Only the current in-progress week or first whole upcoming week is permitted. After first kickoff, the receipt is labeled `in_progress_refresh_not_pregame`; this is **not** a pregame archive. There is no historical `--as-of` switch on the live command. Tests inject their own clock without making live requests.

## Scope and target validation

The wrapper loads the existing `.env`, ESPN read credentials, and shared runtime configuration. Both runtime configuration and credentials must identify ESPN league **98806880**, team **7**, season **2026**. It does not change configuration, source selection, approved artifacts, or model pins.

Before refreshing it:

- Uses `EspnPlatformReader.getLeagueFresh()` and verifies the returned league/season, uniquely identified team, and authenticated SWID ownership. Credentials and owner identifiers are not written to the receipt.
- Reads ESPN's published `proTeamSchedules_wl` season feed. All 32 NFL teams must be present. Each non-bye team must have exactly one verified timed game in a requested week, and each game must agree across both teams' schedules. TBD or inconsistent weeks fail closed. Explicit `byeWeek` is retained as evidence; absence of a game alone is not assumed to be a bye.
- Finds the first week whose **first** kickoff is after the current instant. A delayed remaining Monday game does not make the preceding week a whole upcoming week. On October 20, 2026 at 03:00 ET the target is Week 7; on October 27 at 03:00 ET it is Week 8.
- Accepts fresh ESPN scoringPeriodId equal to the target or its immediately preceding week, accommodating ESPN's rollover lag. Larger discrepancies fail rather than guessing. It also verifies a unique single-week mapping through `settings.scheduleSettings.matchupPeriods` and exactly one owned-team matchup for that period. Multiweek/ambiguous matchups are intentionally unsupported.
- Reads `last-snapshot.json` and its exact SQLite snapshot with a **read-only independent connection**, verifies league/team/season scope, checks every required current starting slot, and resolves players by stable ESPN IDs, never display names.

The original failure was a period-selection problem: a Tuesday calendar resolver still returned the preceding NFL week, and an explicit refresh correctly persisted that wrong requested period. This wrapper removes the calendar decision from the persistence path.

## Refresh and verification contract

One fresh MCP stdio child loads the latest `dist/src/mcp/stdio.js` with `PMT_MCP_ROLE=read` and `PMT_EXECUTION_ENABLED=false`. Its only tool request is:

```json
{"name":"pmt_refresh_projections","arguments":{"season":"2026","week":7,"force":true}}
```

The week is the resolved target, not hardcoded to 7. The existing MCP refresh may perform its normal local league sync first, so the newly imported snapshot ID is accepted **only when it matches the independent post-refresh snapshot readback**. The child is always closed.

There is **no** separate `pmt_rebuild_models` call: that endpoint resolves an advisory period and could undo target-week priors. There is no weekly-scout subprocess, candidate promotion, advisory orchestration, action preparation, approval, ESPN lineup edit, or transaction submission.

A run succeeds only when all checks pass:

1. The result's season, scoring period, and snapshot match the independently read state.
2. `projectionsStored` and `modelsRebuilt` are positive integers and `errors` is an empty array. Skipped optional sources remain visible in the receipt.
3. The exact `scoped_projections` rows for league 98806880 and the target period were written **during this run**. Their database `updated_at` values must also advance compared with the pre-refresh rows. Fresh count and per-source counts must match the refresh result exactly; old stored rows cannot manufacture success. The JSON row period and finite points are checked separately from the table's period key.
4. Every current starter has a fresh positive projection or a fresh explicit zero projection. An explicitly published bye is separately named, and may omit a projection row. Missing data is never replaced with zero. Each starter also needs a finite persisted model. Coverage confirms storage, **not** medical availability or a lineup recommendation.
5. `models.json` has a valid new `saved_at`, a filesystem timestamp from this refresh, enough nonzero model records, and a recorded content SHA-256.

Failures exit **1**, print the precise error and receipt path when a receipt can be written, and must stop downstream work. Refresh writes are not rolled back if a later verification fails; such a run is a failed/partial refresh, not a verified completion. Do not infer success from an older receipt after a nonzero exit or failed preflight.

## Receipt and reruns

The successful stdout is one JSON summary containing `status`, `targetWeek`, `scoringPeriod`, `timing`, counts, coverage, and `receiptPath`. The complete receipt is atomically replaced using a unique temporary file plus rename:

```text
$PMT_DATA_DIR/weekly-projections/2026-W7.json
```

It contains scope, read/start/completion timestamps, published games and source hash, ESPN period/mapping evidence, source counts and skips, exact SQLite readback timestamps, named starter coverage, model path/saved time/mtime/size/hash/count, and zero platform-write/proposal counters. A failure after target resolution replaces that target's receipt with `status: failed`; an unresolved target uses `2026-unresolved.json`.

Repeat runs upsert existing projection identities and replace the same period receipt rather than duplicating projection rows. Do not overlap this job with another projection/model writer; unexpected snapshot/count changes fail verification rather than being treated as success. The wrapper does not restart a long-lived MCP server because it always starts its own fresh read child.

## Installed Tuesday automation

The existing Hermes job `38da0b12383e` remains scheduled at **03:00 America/New_York every Tuesday** (`0 3 * * 2`), next scheduled October 27, 2026. Its pre-run script is `pmt-tuesday-projections.sh` under the active default profile's `scripts/` directory. That launcher calls the repository's `scripts/hermes-tuesday-projections.sh`, which uses the pinned repository Node 26 runtime and starts the tested wrapper with no hardcoded week.

The agent receives the wrapper's JSON result and must verify the current receipt before continuing. Any pre-run failure, missing result, stale receipt, wrong period, zero fresh rows, or incomplete starter coverage stops downstream work and produces a failed-run report. Avoid unscoped model rebuilds and bulk advisory orchestration after this refresh; analytics must request the receipt's exact period. Runtime prior refresh is not learned-outcome training or candidate promotion.

The separate daily scan `1f1f59bfc60d` now runs at 03:00 on Sunday, Monday, Wednesday, Thursday, Friday and Saturday (`0 3 * * 0,1,3,4,5,6`). Tuesday is handled by the weekly job, preventing simultaneous scheduled snapshot/model writers. Both jobs retain their existing weekly-thread delivery and model pins. The thread-rotation job remains responsible for changing their delivery targets.

The installed profile launcher was exercised with `--week 7` and its resulting SQLite rows, receipt, model hash and starter coverage were independently read back. This verifies the execution path, not a claim that the next scheduled Tuesday fire has already occurred. The fresh read-role child loads the compiled fix each run; a long-lived interactive MCP process predating the build still needs `/reload-mcp` for its own in-memory service code.

## Tests

```sh
npm run build
node --test dist/tests/tuesday-projections.test.js
npm run lint
node --test dist/tests/*.test.js
```

Tests are compiled, per `AGENTS.md`. They cover the two Tuesday regressions, ESPN lag/rollover, delayed Monday game, Saturday explicit/current behavior, incomplete/TBD/ambiguous schedules, scope and ownership, single-week matchup mapping, forced explicit refresh, read-role MCP isolation, a legitimate synced snapshot change, exact-league SQLite readback, zero/wrong-period/old/wrong-league data, starter/model coverage including explicit zero/bye, invalid model time, atomic receipt replacement, and repeat-run upsert behavior. Network/provider calls are injected; SQLite, model files, and receipt I/O are real temporary filesystem operations.

## Live verification — October 24, 2026

Command, from `/home/jordan-stovik/Pardon_My_Trade`:

```sh
node scripts/refresh-tuesday-projections.mjs --week 7
```

Exit status: **0**. Exact stdout:

```json
{"status":"complete","targetWeek":7,"scoringPeriod":"2026-W7","timing":"in_progress_refresh_not_pregame","projectionsStored":668,"freshRows":668,"modelsRebuilt":1054,"starterCoverage":"9/9","receiptPath":"/home/jordan-stovik/Pardon_My_Trade/data/weekly-projections/2026-W7.json"}
```

Receipt readback verified 668 newly persisted ESPN rows at `2026-10-24T10:17:53.439Z`, no refresh errors, all nine starters covered, and 1,054 models saved at `2026-10-24T10:17:53.658Z`. This was a late current-week refresh, not a pregame refresh. At this verification point, all **23 wrapper tests** and all **339 compiled project tests** passed, and `npm run lint` passed. No ESPN transaction or proposal was submitted.

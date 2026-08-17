# Code Review and Recommended Improvements

Review branch: `code-review`

Review date: 2026-08-17

## Bug Branch Changes

Pull request [#6](https://github.com/jxstovik/Pardon_My_Trade/pull/6) fixed the ESPN league import workflow.

- ESPN league reads now use `lm-api-reads.fantasy.espn.com` with segment `0`, which returns JSON instead of the HTML response from the web host.
- `import-espn` now honors its league ID and season arguments.
- `import-espn` falls back to `ESPN_LEAGUE_ID` and `ESPN_SEASON` loaded from `.env` when arguments are omitted.
- Current ESPN responses with roster players nested under `playerPoolEntry.player` are normalized into the canonical player list.
- Current ESPN team names, roster slot counts, and league names are mapped.
- Client and reader regression tests assert the read endpoint and existing write behavior.
- A live 2025 ESPN import was verified with 10 teams and 160 roster players.

## Findings

### Critical: GUI refresh is still fixture-backed

`src/cli.ts` wires `serve` refresh and scheduler execution to the fixture path and hard-coded `pmt-demo-football` and `team-001` identifiers. An imported ESPN snapshot can be displayed initially, but a GUI refresh can replace it with fixture recommendations.

Recommended fix: make refresh dependencies use the active snapshot's platform, league ID, season, and selected team. Keep the fixture reader only for explicit fixture commands and tests.

### Critical: Approved actions do not execute platform mutations

`src/agents/action-queue.ts` changes action status, while `action-approve` in `src/cli.ts` does not call `setRoster`, `addDrop`, or `proposeTrade`. An approved action can therefore look complete without changing ESPN.

Recommended fix: persist a typed platform action payload, resolve the configured adapter during approval, execute once with an idempotency key, record the provider response, and transition to `executed` only after success. Keep trades and drops behind the existing human approval gate.

### High: Projection persistence is not league-scoped

`src/knowledge/sqlite-knowledge-repository.ts` stores projections with an empty `league_id` and retrieves them by season. The in-memory repository follows the same pattern.

Recommended fix: require league ID in projection writes and reads, add a composite uniqueness constraint for league/season/period/player/source, and test two leagues in the same season for isolation.

### High: Package test execution is not portable

`package.json` runs `node --test dist/tests/`. On the local Node 26 environment, Node treats the directory as a module and exits before running tests. Builds also do not clean stale compiled output, which leaves old tests referring to missing model artifacts.

Recommended fix: use an explicit compiled test glob, add a cross-platform clean step before build/test, and make generated model artifacts reproducible or skip artifact tests when their inputs are absent.

### High: ESPN adapter coverage is mostly synthetic

The ESPN tests use a hand-built flat response. They do not cover the real response shape for scoring items, free agents, pagination, missing views, authentication failures, or provider error bodies.

Recommended fix: retain sanitized response fixtures captured from ESPN, add schema normalization tests for both legacy and current shapes, and add a credentialed smoke test that is opt-in and never runs in CI.

### High: Sleeper roster mapping can duplicate reserves

`src/adapters/sleeper/sleeper-platform-reader.ts` derives bench players by removing starters but does not remove reserve/IR players. It also maps every starter to `FLEX`, losing actual slot assignments.

Recommended fix: map roster slot IDs directly, make starter/bench/IR sets mutually exclusive, and add tests for IR, superflex, and position-specific starting slots.

### High: API file serving and refresh endpoints need hardening

`src/api/server.ts` joins static paths without proving the result remains inside `publicDir`. The refresh endpoint also has no authentication, authorization, request limit, or concurrency protection.

Recommended fix: resolve and compare the final path against the resolved public root, bind explicitly to localhost by default, and require an application token plus a refresh mutex before exposing refresh beyond a trusted local process.

### Medium: Manager profiles cross league boundaries

`src/history/sqlite-v1-store.ts` accepts a league ID but does not use it when selecting manager profiles.

Recommended fix: filter by league ID in both SQLite and in-memory implementations and add a cross-league test.

### Medium: Name-only projection fallback can misassign players

`src/projections/projection-matching.ts` chooses the first same-name player when team matching fails.

Recommended fix: return an ambiguity result when multiple candidates remain, normalize traded team data, and require an explicit confidence threshold before persistence.

### Medium: Source schema failures can look successful

The Razzball source can return an empty candidate list without setting a skip reason when the expected table disappears. The season refresh then reports no failure.

Recommended fix: distinguish an intentionally empty result from a parse/schema failure and emit a degraded-source notification with the URL and parser reason.

### Medium: Refresh persistence is not transactional

`src/pipeline/refresh.ts` saves a snapshot before validating the selected team and persists later records in several independent steps.

Recommended fix: validate all identifiers before persistence and use a transaction or staged commit so a failed refresh cannot leave a partially updated recommendation state.

### Medium: Scheduled jobs can overlap

Season jobs do not use a per-job or global mutex. A slow projection refresh can overlap a later scheduler tick or a manually started command.

Recommended fix: add a durable run lock with an expiry, expose skipped-overlap status, and make notifications/actions idempotent.

## Priority Order

1. Prevent GUI and scheduler refreshes from using fixture data after a real import.
2. Implement and test approval-to-platform execution with idempotency and failure handling.
3. Scope projections and historical data to league IDs.
4. Repair the portable clean/build/test workflow.
5. Add real-provider smoke tests and sanitized response fixtures.
6. Harden API path handling and refresh authorization.
7. Correct Sleeper roster-slot and reserve mapping.
8. Improve matching ambiguity, source failure reporting, transactionality, and scheduler locking.

## Fix Status

The priority findings were addressed on `code-review` after the review. Status below records what is implemented and what still requires provider or deployment validation.

### 1. Imported GUI and scheduler refresh

**Status: implemented with a caveat.** Serve and scheduled refresh now resolve the active imported snapshot, league, season, platform identity, and team instead of hard-coding the demo league. The existing refresh engine still consumes a temporary snapshot through its fixture-shaped interface; it no longer substitutes demo data, but a future adapter-native refresh would remove that compatibility bridge.

### 2. Approval-to-platform execution

**Status: implemented for ESPN CLI approval.** Queue records now retain execution attempts, stable idempotency keys, provider responses, and structured errors. `action-approve` resolves the active ESPN snapshot and calls `setRoster`, `addDrop`, or `proposeTrade` only after approval; failed approved actions can be retried, and successful actions are replay-safe inside the queue.

**Caveat:** ESPN provider writes do not currently accept or persist the queue idempotency key server-side. A process crash after ESPN accepts a write but before the queue records success could still duplicate a provider operation. Sleeper and fixture actions are explicitly rejected because they have no write adapter.

### 3. League-scoped persistence

**Status: implemented.** SQLite and in-memory projections are scoped by league, snapshot hydration filters by league, and refresh callers pass the active league ID. Manager profiles now carry league IDs and are filtered in both stores. Existing callers that omit a projection league ID retain an explicitly documented legacy unscoped mode.

### 4. Portable test workflow

**Status: implemented.** Builds clean `dist` with a cross-platform Node clean command, and `npm test` uses an explicit compiled test glob. Verification completed with `181` passing tests and `0` failures.

### 5. Provider response coverage

**Status: substantially implemented.** ESPN current nested roster-player normalization is covered by the live 2025 import and endpoint regression coverage; Razzball schema failures now report degraded status; and `tests/live-provider-smoke.test.ts` provides opt-in ESPN, Razzball, and FFToday smoke tests. The smoke tests passed in this workspace with the existing provider access. Free-agent pagination, ESPN scoring-item conversion, write response variations, live NFL schedule data, and live Sleeper data still require targeted validation.

### 6. API hardening

**Status: implemented for the local-server threat model.** Static file paths are constrained to the public root, refresh is loopback-only, refresh calls are serialized, the CLI binds to `127.0.0.1`, and `PMT_API_TOKEN` can require a bearer token. The API remains intentionally local and has no general user authentication or multi-user authorization model.

### 7. Sleeper roster mapping

**Status: implemented.** Starter positions now follow the league roster slots, reserve players are excluded from bench duplication, and taxi/reserve slots are represented separately. Superflex and reserve regression tests were added.

### 8. Matching, source errors, refresh validation, and scheduler overlap

**Status: implemented with deployment caveats.** Ambiguous name matches are skipped instead of guessed, Razzball invalid schemas are reported, refresh validates the team before saving a snapshot, and season jobs share an in-process overlap guard.

**Caveats:** refresh persistence across multiple stores is not a single cross-store transaction, and the scheduler lock is process-local rather than durable across multiple processes or machines. A durable lock and provider-specific source smoke tests remain appropriate before unattended deployment.

## Remaining Recommended Work

- Add opt-in live ESPN, Razzball, and FFToday smoke tests with sanitized assertions.
- Add provider-side idempotency or reconciliation before enabling unattended retries for ESPN writes.
- Replace the fixture-shaped refresh bridge with a platform-native refresh pipeline.
- Add durable cross-process scheduler/action locks if more than one PMT process can run against a data directory.
- Add a migration for existing manager-profile rows so legacy rows without `league_id` are explicitly quarantined or backfilled.

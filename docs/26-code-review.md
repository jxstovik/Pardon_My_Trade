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

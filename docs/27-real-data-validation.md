# Real-Data Validation and User Test Plan

This document separates functionality covered by fixtures, stubs, or theory from functionality verified against real provider data. The automated test suite is valuable for deterministic business rules, but it does not establish that external APIs, credentials, live schemas, markup, rate limits, or production workflows work end to end.

## Fixture or Stub Coverage

The following areas are currently tested without live provider requests:

- ESPN league reads and writes use fake fetch handlers in `tests/espn-platform-reader.test.ts` and `tests/espn-platform-client.test.ts`.
- ESPN projections use `tests/fixtures/espn-projections.json`.
- Sleeper tests use fake API responses.
- Razzball and FFToday tests parse checked-in HTML fixtures.
- News, refresh, recommendation, and most orchestration tests use fixture league data.
- ESPN draft polling uses hand-built response objects.
- Database tests use in-memory repositories or temporary SQLite databases, not upgrades of an existing production database.
- Model artifact tests depend on generated files that are not reproducible from the normal build.

No automated test currently makes a real ESPN, NFL, Sleeper, Razzball, or FFToday request. The following remain unverified until user testing is performed:

- ESPN cookie authentication and authorization for private leagues.
- ESPN current response shape beyond the imported 2025 league path.
- ESPN free-agent discovery, pagination, scoring-item conversion, write responses, and provider-side rejection messages.
- 2026 league behavior before and after draft/start of season.
- NFL schedule, scoring-period, bye-week, postseason, and week 18 behavior against current data.
- Razzball login, premium session handling, redirects, throttling, and markup changes.
- FFToday availability, page structure, season/week URLs, and rate limiting.
- Real projection matching against current player names, trades, rookies, and duplicate names.
- Live draft feed timing, reconnect behavior, and conflict resolution.
- Cross-process SQLite, model, notification, and action-queue behavior.

## Recommended User Tests

Use a disposable data directory for each provider test. Never commit `.env`, cookies, database files, raw provider payloads, or private league exports.

### 1. ESPN import smoke test

Configure `.env` with `ESPN_LEAGUE_ID`, `ESPN_S2`, `SWID`, and optionally `ESPN_SEASON`. Then run:

```bash
npm run build
npm run pmt -- import-espn
```

For a historical-season check:

```bash
ESPN_SEASON=2025 npm run pmt -- import-espn
```

Verify that output contains the expected league name, team count, roster-player count, and selected team. Compare several teams, starters, bench players, IR players, standings, roster slots, and league scoring rules against ESPN. Confirm no cookie values appear in stdout, `data/models.json`, `data/last-snapshot.json`, SQLite, or logs.

### 2. ESPN failure and season tests

Run the import with an invalid league ID and with invalid or missing cookies. Confirm that the command returns a clear non-success error and does not replace the last valid snapshot. Repeat for 2025 and 2026, noting differences caused by draft/offseason state. Confirm that an invalid team ID cannot create a new persisted snapshot.

### 3. ESPN write-gate test

Use a disposable league. Queue a low-risk roster action and a high-risk add/drop or trade. Run the approval command and inspect both the local queue and ESPN. Confirm that high-risk actions remain blocked until approval, that approved actions execute exactly once, and that provider failure leaves a retryable, auditable state. This test is especially important because the current review found that approval status changes are not yet connected to ESPN write methods.

### 4. Imported league GUI and scheduler test

Import ESPN data, start the server, open the GUI, and run refresh. Confirm that the displayed league, teams, players, recommendations, and notifications still refer to the imported ESPN league rather than `pmt-demo-football`. Enable the scheduler and confirm that its jobs use the imported platform and team. Repeat after restarting the process.

### 5. ESPN projections and matching test

Run the projection command with ESPN enabled and `--force`. Inspect source, candidate count, period, player IDs, and matched roster names. Manually check a traded player, rookie, injured player, duplicate-name possibility, and a free agent. Confirm that a provider outage or changed response is reported as degraded rather than as a successful zero-player result.

### 6. Sleeper live import test

Use a public league and isolated data directory:

```bash
PMT_DATA_DIR=/tmp/pmt-sleeper-test npm run pmt -- import-sleeper <leagueId> <season>
```

Compare users, teams, starters, bench, IR/reserve players, scoring settings, matchups, and free agents with Sleeper. Test a superflex or position-specific league to expose slot mapping issues. Verify that reserve players are not duplicated in the bench.

### 7. Razzball and FFToday provider test

With provider access configured, run projections for the current season and an explicit historical week. Check HTTP status, redirects, table detection, player count, position, projected points, and cache behavior. Repeat with `--force`, then simulate or observe a provider outage. Confirm that markup changes and empty tables produce an explicit degraded-source result.

### 8. NFL season-calendar test

During preseason, opening week, a bye week, week 18, and postseason, compare the CLI scoring period and active season against an authoritative NFL schedule. Test local time zones and a daylight-saving transition. Confirm that offseason mode does not accidentally run in-season waiver or lineup jobs.

### 9. Draft feed durability test

Run the manual draft writer and watcher in separate terminals. Start the watcher immediately after process startup, restart it with existing picks, write malformed input, and write picks while polling. Verify that no picks disappear, the parent directory is created, duplicates resolve consistently, and ESPN feed errors leave the manual feed available.

### 10. Data isolation and concurrency test

Import two leagues for the same season into one data directory and compare projections, models, manager profiles, alerts, and recommendations. Run two refreshes concurrently and interrupt one midway. Verify that data remains league-scoped, snapshots remain immutable, no duplicate notifications/actions are created, and the database is recoverable.

## Evidence to Record

For each user test, record the command, season, provider, timestamp, counts, expected-versus-actual results, and sanitized error text. Store only metadata and conclusions in the repository. Keep credentials, cookies, raw ESPN payloads, and private league details outside Git.

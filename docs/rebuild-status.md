# Rebuild status and rollout

The first release runs autonomous **reads, analysis, and recommendations**. ESPN
writes remain paused, including CLI automatic lineup execution. The repository
now contains the persistent-host packaging and portable web application; no
remote host, Hermes gateway, or private ESPN league has been deployed or verified
in this session.

## Delivered

- A configured league/team identity, read-only ESPN doctor, fantasy player/stat
  projection reads with native identity matching, pagination, bounded safe-read
  retries, redacted request records, and corrected scoring/eligibility/locks.
- One `PMT_DATA_DIR/pmt.sqlite` database for CLI, API, and Hermes MCP processes.
  Immutable snapshots and latest pointers, league-scoped projections, legacy
  database/queue migration, transactional proposal deduplication and execution
  receipts, and durable leased refresh jobs survive restarts.
- Server-enforced MCP `read` and `operator` roles. The read role can sync the
  configured league, inspect roster distributions, compare hypothetical free
  agents, and propose actions. It cannot approve, reject, or execute actions.
  Write adapters are constructed only for an explicitly enabled operator.
- Legal expected-value lineup assignment using player eligibility rather than
  bench placement, with locked starters and locked bench players preserved.
- Repeatable normal-sample player, roster, current-lineup and recommended-lineup
  distributions, plus fixed-lineup paired add/drop simulations. Missing weekly
  starter forecasts block analytics instead of silently supplying zero.
- An authenticated, responsive PWA with current/recommended lineup views,
  individual and aggregate histograms, free-agent comparisons, source/model
  assumptions, freshness, and agent job/proposal activity. Its offline cache
  contains static assets only; private league responses are never cached.
- Node 26 Docker/Compose packaging with Caddy TLS, persistent storage, external
  Hermes configuration and advisory scheduler examples, and SQLite online backup
  and stopped-service restore scripts.

The default fixture is `tests/fixtures/demo-roster-distributions.json`.
**Every forecast in that fixture is synthetic demonstration data**. Live modes
never use it as a fallback. The original sparse fixture remains for regression
checks that verify uncovered projections are visible blockers.

## Modeling limits

Current-period source point estimates drive the means. Persisted learned model
state contributes uncertainty when its target metadata is compatible; this
release does not claim to deploy learned means or a calibrated, promoted model.
Future-period or wrong-season state is ignored when that metadata is available.
Legacy model files have incomplete provenance and are labeled accordingly.
Forecast metadata includes a reproducible scoring/model-state fingerprint.

Samples currently assume independent normal outcomes. Cold-start spreads and
source display bounds are estimates, not evidence of calibrated coverage.
Paired scenarios preserve shared-player outcomes, optimize each expected-value
lineup once, and then sample those fixed lineups. They do not select a lineup
with knowledge of simulated future outcomes. Work is bounded to prevent a large
player pool from exhausting a small host.

A scenario assumes acquisition of a currently unowned player. Waiver processing,
transaction budgets, cannot-drop lists, custom roster rules, opponent win
probabilities, game/team correlations, and actual-plus-remaining scoring are not
fully modeled. Counterfactual analysis never submits a transaction.

## Verification and remaining gates

The final integrated Node 26 compiled suite passed **271 of 271 tests**, and
TypeScript lint passed. Coverage includes adapter contracts, concurrent SQLite
stores, lease recovery, auth/CSRF, eligibility, scoring-period equivalence,
causal model state and paired simulations. Browser checks against the shipped
synthetic demo passed for password sign-in, current/recommended lineup totals,
player histograms, add/drop comparisons and a 390px mobile viewport with no
horizontal overflow. Actual MCP stdio exposed 29 read-role tools from the
32-tool contract, excluded operator actions, and successfully ran league sync,
roster analytics and a scenario. The running GUI observed the new MCP snapshot
without a restart. A SQLite online backup and temporary restore passed integrity
checks.

The verified changes are committed locally on
`rebuild/reliable-agent-platform`. Publishing a GitHub branch/PR was attempted
through the connected integration, but GitHub returned **HTTP 403: Resource not
accessible by integration** for branch creation. No remote branch or PR was
created. Portable source/commit artifacts accompany the delivery so the changes
can be reviewed and imported through an authorized GitHub session.

Docker build verification reached image retrieval but was blocked by the
external registry's HTTP 429 rate limit pulling `node:26-bookworm-slim`.
The full container image has not yet been verified. The TypeScript/web runtime
was verified separately under Node 26.

| Original phase | Status / remaining gate |
| --- | --- |
| 0–1: diagnosis and ESPN correctness | Implemented contract-tested reads. Private league/cookie validity, current ESPN schema and league scoring still require live read validation. |
| 2: shared reliable core | First single-host implementation delivered. Operational restore/restart and missed-job catch-up must be exercised on the selected host; only refresh jobs currently use durable scheduling. |
| 3: persistent agent deployment | Packaging and gateway examples ready. Host, DNS/TLS, provider access, exact Hermes version and cron setup remain unconfigured. |
| 4: portable projection app | Delivered and browser-verified against synthetic data. Real roster/projection coverage must pass before the UI is treated as live. |
| 5: controlled execution | Paused by the user's first-release preference. Future manual write canary and ESPN read-back contracts are not validated; no automatic lineup policy is activated. |
| 6: model/operating improvements | Deferred: automated league outcome ingestion, calibrated residuals and correlations, governance-backed active model resolution, evaluation-driven promotion/rollback and production operating targets. |

## Recommended setup and inputs

Use one Ubuntu/Debian VPS with approximately 2 vCPU and 4 GB RAM, persistent
local storage, Docker Compose and Caddy. Serve the PWA and API at the same domain.
Run a separately installed, version-recorded Hermes gateway with the read-role
stdio configuration in `deploy/hermes/mcp-config.example.yaml`. Follow
[deployment instructions](deployment-rebuild.md).

Configure these locally on the selected host, rather than in chat or tracked
files:

1. ESPN league, season and explicit team identifiers. Supply `ESPN_S2` and `SWID`
   through the backend environment if the league is private. Run the read-only
   doctor, import, and refresh and compare the roster/settings with ESPN.
2. A VPS/domain and DNS access; choose a strong web password and session secret.
   Retry the Docker build after registry access recovers.
3. The installed Hermes version, model/provider configuration and API credentials.
   Start its advisory jobs against the same PMT data volume, then verify both
   Hermes and the web app observe a new snapshot without a web-server restart.

Keep `PMT_EXECUTION_ENABLED=false` and the operator gateway disabled throughout
this rollout. No additional approval is needed to use the synthetic demo or run
read-only diagnostics with locally configured credentials.

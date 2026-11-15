# College basketball architecture and automation proposal

Committee role: architecture and automation. Written 2026-10-25 from the current workspace and updated with the chair's successful first-party API investigation. This is a proposal, not a claim that a model, live writer, or running service is already complete.

## Recommendation

Build a bounded basketball module in this repository, with its own league configuration, domain contracts, storage, report directory, and CLI entrypoint. Reuse reliable infrastructure and engineering patterns after compatibility checks; do not route college basketball through the football orchestrator, NFL calendar, ESPN writer, global league pointer, or shared football projections table.

The first release should automate acquisition where access is supported, normalization, data checks, schedule analysis, lineup advice, waiver shortlists, reporting, and evaluation. Platform mutations remain a separate capability. With an export-only reader the workflow is automatically analytical after each new export, but cannot truthfully be called an unattended live manager. A live read integration and an always-on execution host are separate milestones.

## What the repository actually supports

The inspection covered `AGENTS.md`, architecture/testing/coding standards, ADRs 0001/0004/0005, `docs/21-inseason-workflow.md`, and the current source below. The workspace already contains substantial unrelated uncommitted football work. Implementation should add new basketball files and avoid rewriting those changes.

| Existing boundary | Useful pattern | Why direct reuse is unsafe or incomplete |
| --- | --- | --- |
| `src/models/types.ts` | Versioned league/player/roster/evidence concepts | `Sport` includes basketball, but `Platform` omits Fantrax and `PlayerPosition` omits basketball guard/forward positions. Scoring type and waiver settings cannot represent all league formats/limits. |
| `src/adapters/platform-reader.ts` | External service behind a read interface | Contract assumes existing shared types and has no explicit acquisition completeness or per-field provenance. |
| `src/config/runtime-config.ts` | Explicit league/team/storage identity | Only accepts fixture, ESPN, or Sleeper and may use football environment defaults. |
| `src/knowledge/sqlite-knowledge-repository.ts` | Immutable snapshot rows; transactional latest pointers | Explicitly rejects a second live platform/league in the same runtime store. `getLeagueSnapshot` attaches latest stored projections dynamically, so replay requires pinning projections separately. |
| `src/seasons/season-jobs.ts` | Fault-isolated steps; degraded-source events; advisory actions | NFL-specific times, offseason guard, scoring periods, Razzball login, and refresh pipeline. |
| `src/seasons/season-orchestration.ts` | Required starter coverage; all scheduled actions await approval | Football model/orchestrator inputs and NFL period fallback. |
| `src/scheduler/scheduler.ts` | Injectable clock and a small scheduling interface | Host-local `getHours()` matching; no IANA timezone, durable execution claim, restart catch-up, overlap guard, or persisted next-run state. Repeated calls in one matching minute can run a job repeatedly. |
| `src/agents/action-queue.ts` and SQL stores | Canonical payload hashes, approval states, expiry, compare-and-swap, duplicate proposal prevention | Action payloads use football/shared roster types and preconditions lack basketball game caps, lock scopes, and strategy revisions. |
| `src/agents/action-executor.ts` | Fresh revalidation; SQL receipt reservation before submission; unknown result blocks retries | Reader/writer contracts are platform-specific. An ESPN execution path cannot imply a Fantrax execution capability. |
| `src/notifications/notification-provider.ts` | Provider interface; local console/file delivery | External delivery and successful arrival are additional capabilities; current providers alone do not imply push/email delivery. |

Preserve the accepted architecture: business rules live in deterministic code, platform adapters stay read-only initially, and every recommendation records exact immutable inputs. LLMs can summarize, critique, or explain; they cannot invent settings or decide legality.

## Observed league facts and remaining unknowns

The supplied URL identifies league `mmioj1mvmvgsc3io`. The chair's successful documented read API investigation found `Banging 3s`, eight teams, `seasonYear=2026`, `HEAD_TO_HEAD_ROTI_MULTI_WIN` (one W/L/T per category), and eight equally weighted categories: PTS, REB, AST, ST, BLK, 3PTM, FG%, FT%. Turnovers are absent. Roster constraints are G maximum active 4, F/C maximum active 4, Flx maximum active 2, with maximum total 14, active 10 and reserve 4. Weekly roster/scoring periods run November 1 to March 15, and playoffs have four teams in periods 18/19 beginning March 1/March 8. Current evidence is the chair's field-level transcription of browser-rendered JSON in [league-evidence.md](../league-evidence.md), not a complete saved raw API response. Preserve that provenance distinction. The API advertises v1.8 Beta in the [official developer documentation](https://www.fantrax.com/developer).

The private home link redirects to login, but the documented settings read succeeds in the browser without authentication. Shell HTTP access returns 403, so browser access is proven and unattended HTTP transport is not. User-confirmed team is `jxstovik` / `wwc1n3o4mvn1c6hk`, and the user selected Balanced starting mode. Period-one roster responses contain empty `rosterItems` for all teams; draft results show `running` plus 112 pick shells without player selections. Neither observation proves a completed draft, an active clock, or an empty league needing pickups. Period transition timestamps do not establish actual lineup-lock instants or their scope. Preserve observed numeric offsets across DST rather than assuming a single fixed UTC offset.

Remaining discovery includes men's/women's player pool and eligible competitions; category tie/minimum-attempt rules and playoff 4-4 treatment; complete roster and positional eligibility constraints beyond observed maxima; actual lineup-change and lock policy; scoring-period timezone; game/start/position limits; waiver mode, processing times, bid precision, FAAB balances, weekly/season acquisition limits and drop restrictions; trade deadline/review; playoff qualification/reseeding/tiebreaks; postseason eligibility; draft clock/current selection state; complete current roster and player name/ID mapping; transactions; game schedule; settings revision. Verify each observed fact against saved raw data as ingestion matures. The user can sign in shortly; use that to resolve private rules while continuing the local import/report slice.

Represent unknowns explicitly with a reason and required evidence. `null`, missing, zero, empty, unlimited, and false are different states. A missing acquisition cap must never become unlimited. A missing lock rule must never become daily unlocked. Rules may block only dependent capabilities: a points formula omission blocks points optimization; missing trade rules need not block an otherwise verified lineup report.

## Proposed file and CLI boundaries

Add, initially without changes to the root CLI or package scripts:

```text
src/basketball/
  cli.ts
  contracts.ts                  # Zod boundary schemas and discriminated states
  config.ts                     # League identity, profile, source refs, no football env fallback
  ports.ts                      # BasketballReader, SnapshotStore, Clock, Delivery
  adapters/fantrax-export.ts     # Validated official export/capture bundles
  adapters/fantrax-reader.ts     # Later, only after an acquisition path is verified
  ingest.ts                     # Normalization, IDs, completeness, rule diff
  store.ts                      # Independent versioned storage
  scoring.ts                    # Category definitions, aggregate ratios, outcomes and ties
  calendar.ts                   # Imported periods and actual game instants
  gates.ts                      # Capability/readiness and freshness checks
  projections.ts                # Typed source/model revisions, uncertainty
  lineup.ts                     # Legal matching with locks, caps, remaining games
  strategies.ts                 # Explicit profiles; evaluate alternatives from one manifest
  workflow.ts                   # Acquire -> pin -> validate -> analyze -> report
  jobs.ts                       # Persistent run ledger, lock-relative due work
  report.ts                     # Machine JSON + human Markdown
  audit.ts                      # Recommendations, approvals, observed outcomes
tests/basketball-*.test.ts       # Root glob compatible with current npm test
tests/fixtures/basketball/       # Clearly synthetic and captured sanitized cases
config/basketball/              # Versioned public nonsecret league/profile configs
data/basketball/<leagueId>/     # Gitignored raw captures, normalized state, manifests
artifacts/basketball/<leagueId>/# Deliberate report/evaluation outputs, no session data
```

Initial CLI: `node dist/src/basketball/cli.js <command>`. Proposed commands are `init`, `import`, `doctor`, `refresh`, `report`, `strategies`, `strategy-set`, `jobs`, `evaluate`. `refresh` performs safe local analysis and read acquisition only. Do not expose a successful-looking `execute` stub. Later root CLI aliases may delegate to the module in a small reviewed change.

Use college season labels such as the observed `2026-27` as opaque values, plus a separate provider season key. Avoid a hard-coded calendar-year derivation. Use canonical IDs containing sport/competition/provider scope; identical names are not identifiers. Keep all JSON schemas versioned, reject unsupported versions, and use NodeNext `.js` import suffixes.

## Acquisition, provenance, and storage

Implement a `BasketballReader` that returns separate resources with metadata and capability state: settings, team directory, rosters, standings, matchups, scoring calendar, games, player pool/eligibility, free agents, and transactions. Each resource carries league/team scope, captured time, source observation/update time if supplied, parser version, raw content hash, source URL or local evidence reference, pagination counts, and completeness. Collection failure must not silently replace current state with an empty list.

Acquisition order:

1. Use the now-observed documented API read path through the working browser or imported official JSON. The chair found `getLeagueInfo?leagueId=...&excludePlayerInfo=true`, `getTeamRosters?leagueId=...&period=N`, `getStandings`, and `getMatchupScores` in the official developer documentation, plus observed draft results. Exact URLs are in `league-evidence.md`. Shell HTTP currently receives 403: do not ship a transport that claims live success or imitate a browser fingerprint to bypass that response. Record verified methods/parameters/response schemas and transport status. Verify pagination, period semantics, status errors, and response completeness. A transcription bundle must identify itself as transcribed evidence rather than raw official JSON.
2. If the signed-in browser has visible league settings and rosters, capture read-only evidence with the existing authorized session. Preserve structured values with page/time references and require ambiguity resolution rather than guessing.
3. If unattended reads are unavailable, accept versioned local export/capture bundles and clearly report `awaiting_new_capture`. Build everything else against fixtures and those bundles.

Do not store passwords, session cookies, tokens, headers, or browser storage in committed fixtures or reports. Do not introduce a login bypass or claim access from public Fantrax marketing pages. Rate limiting, bounded retries/backoff, acquisition completeness, and any usage limitations belong in the adapter. A transport method name alone is not proof of read-only semantics; maintain an explicit allowlist of verified read operations.

Pin every analysis in an immutable `run-manifest.json`: league snapshot hash; rules hash; roster hash; player identity map version; game schedule revision; injury/news observation versions; projection/stat input hashes; model artifact/version/training cutoff; strategy version; optimizer version; as-of time; source freshness; execution mode; gate results. Projection refresh creates a new manifest instead of altering a previous run's meaning.

An isolated SQLite database is appropriate for durable jobs/audit once implemented. A first slice may use immutable JSON snapshots plus an atomically replaced current pointer, provided there is one writer and concurrency is explicitly unsupported. Never share `data/pmt.sqlite`, legacy JSON queue files, or the football `last-snapshot` pointer. Every record, lookup, filename, action and notification must be league scoped.

## Readiness, freshness, lock, and legality gates

Return typed readiness states: `unconfigured`, `awaiting_capture`, `partial`, `ready_for_advice`, `stale`, `blocked`, and later a separate `ready_for_execution`. An authentic imported snapshot can remain partial. A synthetic fixture can be ready for simulation but never ready for live advice.

The first league-specific optimizer must target category outcomes. Counting-stat aggregation is a sum of eligible games; FG% and FT% come from aggregate made/attempted totals with uncertain attempts, never an average of player percentages. Simulate coherent game outcomes, category ties and the observed standings mapping. Shared minutes/pace/opponents create correlated stats; simulation cannot independently draw each stat without checking coherence. A sum of invented fantasy-point weights is not this league's objective. Do not infer a turnover penalty from other basketball defaults.

Before producing actionable advice verify:

- Exact league/team/season and supported scoring format. Numeric coefficients are finite and every scoring condition is implemented or explicitly unsupported.
- Full roster/eligibility, current slot assignment, target period and lock policy. Never move a locked starter or a locked bench player. Time boundaries use UTC instants with the observed league IANA timezone for local dates and DST.
- Game inventory with status and updated start times. Postponed/cancelled games are separate from unplayed games; missing schedule coverage is not zero games. College games are not inferred from an NFL week or a weekday heuristic.
- Remaining starts/games/acquisitions/budget, including already consumed and pending actions. Caps apply to the correct period, position, or season scope.
- Source freshness assessed separately for rules, roster, availability, schedule, free agents and projections. Record both ingestion age and source observation age; re-fetching an old file does not make it fresh.
- Required player coverage and identity confidence. Unknown status is not healthy, missing projection is not a zero-point estimate, and fuzzy name matches cannot authorize a transaction.
- Strategy horizon fits the real target period/playoffs and no profile overrides roster legality or approval policy.

Suggested starting freshness policy, explicitly tunable engineering defaults rather than observed league rules: daily rules check plus immediate rule-diff invalidation; roster/free-agent/remaining-cap refresh within 15 minutes for advice; schedule/availability refresh within 30 minutes on game days and within 10 minutes near a relevant lock; projection refresh daily and upon material role/injury changes. A first offline import should surface age, not pretend those targets are satisfied. Live actions later require a fresh read immediately before submission, tighter policy, and independent post-action confirmation.

Fail closed for executable actions on any relevant stale/ambiguous fact. Advisory reports may still show provisional scenarios with the failed gates and omitted actions clearly named. A degraded optional source should not prevent an unrelated health report; a failed required source must stop the dependent recommendation.

## Jobs and operating rhythm

Basketball has moving game times and league-specific locks; use a calendar-driven rhythm, not football's Sunday/Tuesday constants.

| Trigger | Work | Report/alert |
| --- | --- | --- |
| Daily morning, proposed 07:00 America/New_York pending league timezone | Read settings/rosters/results/schedule, refresh availability/projections, re-evaluate horizon and strategies | One digest: changes, best legal lineup, remaining games/caps, waiver candidates, current strategy and blockers |
| Before the verified scoring-period lineup deadline | Reacquire live state and compare with planned lineup | Deadline-relative actionable delta with expiry |
| For daily changes: about 60 and 15 minutes before relevant game locks | Update status/schedule and re-optimize unlocked slots only | Alert only for material lineup change or coverage failure |
| Before the verified waiver/claim deadline | Refresh available pool, budget and acquisition capacity; score claim sequences | Ranked exact claim proposals for approval |
| Material injury, postponement, role change, roster transaction or rules diff | Invalidate affected recommendation and rerun dependent steps | Deduplicated change alert; rules changes block affected action types |
| Following completed games, daily | Ingest final observed outcomes and score stored pregame predictions | Calibration, error and stale-data attribution |
| Before each new matchup and weekly model review | Recompute available games, opponent outcome distribution, playoff horizon and tradeoffs | Strategy comparison and an optional profile pivot suggestion |

If weekly locks are observed, stop suggesting mid-period lineup edits and focus on next-period moves and approved transactions. If the league is rotisserie, replace matchup win probability with standings/category utility; do not run points-only objectives.

Persist job claims with a unique key `(leagueId, jobType, targetPeriodOrLock, scheduledAt, policyVersion)`. Claim atomically with a renewable lease; record started/completed/skipped/failed attempts and typed failure reason. Same-minute polling, process restart and overlapping daemon instances must not duplicate work. Catch up missed read/report jobs within a configured window; missed lock checks become an alert, never retroactive actions. Retry network reads with bounded jitter; do not retry an ambiguous future platform write.

The basketball job runner can be invoked by an existing always-on supervisor or OS scheduler after its host, timezone and environment are verified. A local process ending is not successful deployment. Health includes next run, last successful acquisition, last successful analysis, delivery state, active source capabilities, and missed deadlines. External notifications require an authorized connected channel; local file/console output is the first verifiable delivery target.

Notification idempotency includes league, event/player, material state transition, target lock, and strategy revision. Send one morning digest plus urgent changes, use quiet hours for nonurgent events, and include a direct source reference, proposed benefit, risk, expiry and the exact local review command. Store a durable outbox with provider receipts, bounded retry and deduplication.

## Strategy pivots and approval boundary

Keep league facts separate from strategy preferences. Every profile is schema validated, versioned, effective-dated, and reversible. Profiles describe objective weights, evaluation horizon, risk tolerance, acquisition reserve, protected players, minimum improvement threshold, and scenario assumptions; they cannot change scoring, locks, eligibility or budget.

Evaluate at least `balanced-categories`, `schedule-volume`, `category-concentration`, and `playoff-investment` on the same pinned inputs when implemented. Here the verified category format means category concentration is a relevant option, but it requires the category model before quantitative claims. Profile choices are strategies to test, not promised winning plans. Display expected category outcomes, per-category win/tie probabilities when supported, downside, acquisition cost, rest-of-season opportunity cost, model uncertainty and sensitivity to missing inputs. Show FG%/FT% attempts exposure explicitly. The modeling committee owns quantitative definitions and validation.

`strategy-set` records the explicit user choice and effective period; re-analysis supersedes incompatible queued proposals and explains the difference. The user selected Balanced, so persist that as the chosen analytical profile; no action authority is inferred. Automatic strategy suggestions can trigger from playoff odds, opponent strength, injuries or measured forecast error, but automatic risk escalation or high-risk transactions are never implied by choosing a profile.

Preserve PMT's mandatory approval of trades, drops and waiver claims. Basketball phase one produces an advisory queue only. A later Fantrax writer requires a verified supported submission path, exact payload preview and human approval bound to league/team/period/rules/profile/input hashes, a deadline-derived expiry, fresh legality/cap/budget checks, atomic submission receipt reservation, immutable audit, and observed post-submit confirmation. Approval and submission stay separate. Unknown submission results require reconciliation before any retry.

Even future low-risk roster automation needs an explicit enabled policy and observed supported Fantrax capability. Scheduled jobs must not inherit football `--auto` flags. Profile changes do not authorize platform actions. Human completion can be recorded only from observed platform state or an explicit completion acknowledgement, distinct from an executor receipt.

## First executable vertical slice

Ship a small useful, truth-preserving loop before a custom model or live writer:

1. Add a league seed for `mmioj1mvmvgsc3io` with the supplied URL, verified API facts/references, confirmed team identity, selected Balanced profile, observed-empty roster/draft state, unknown distinctions, and no credentials.
2. Add basketball contracts, isolated storage, official JSON/capture bundle reader and provenance validation. Include a conspicuously synthetic eight-category fixture for engine testing; never label it the user's league. Keep browser acquisition versus future unattended HTTP acquisition as separate capabilities.
3. Implement `doctor --config <path>` and `import --bundle <path>`. Produce a machine-readable readiness report and a human report with known facts, required missing fields, source ages and supported capabilities. Persist observed settings and roster completeness, preserving whether a capture is full raw official JSON or a transcription. Do not treat current empty rosters as a ready personalized lineup or free-agent universe. Report HTTP 403 as a transport limitation rather than a successful live refresh.
4. Implement category aggregation/ratio validation and a weekly schedule/roster opportunity audit. Legal lineup recommendations and strategy probabilities follow only when locks, eligibility, game caps, team mapping and category forecasts are complete. An unsupported or incomplete format returns an explicit gate and still writes the health report. Do not spend the first slice implementing points-only optimization for this category league.
5. Implement `refresh --config <path> --as-of <instant>` to pin one run manifest and atomically write JSON/Markdown reports. It performs no platform writes and does not silently use fixtures when live data is unavailable.
6. Add durable job/outbox behavior before enabling unattended runs. Run the real evidence import/health report and the explicit synthetic end-to-end example. Record separate results: browser rules observed, captured/transcribed evidence imported, empty roster/draft state preserved, fixture scoring proven, real league remaining gaps listed, HTTP transport blocked, recurring host not yet verified.

This slice gives immediate, inspectable progress even if the private league blocks acquisition. The critical judge should reject any progress claim that equates that state with a deployed Fantrax automation or a trained college-basketball model.

## Acceptance criteria and verification

- No existing football file or database is changed by the initial basketball commands; basketball config never falls back to ESPN identity or NFL periods.
- Real supplied league ID and URL plus observed eight-category rules appear in the seed, but unknown team/locks/limits remain unknown; incomplete real seed produces a clear readiness report and no actionable lineup or transaction.
- Import rejects wrong league/season, unsupported schema, conflicting IDs, incomplete required pages, invalid scoring values and ambiguous player joins. Source hashes and observation times survive import/export.
- Repeating an import is idempotent; reusing a snapshot ID with changed content is rejected. Historical run manifests reproduce previous advice even after new projections or rules arrive.
- Synthetic fixture scores and FG%/FT% made/attempted aggregation are independently hand-calculated; legal lineup cases cover multi-position eligibility, locked starter/bench, partial days, postponed games, hard game caps, missing starter projections, weekly locks and target-period boundaries.
- Strategy changes affect objective weights and supersession state while retaining legality and approval requirements. Missing category simulation, tie rules or forecasts are explicit until implemented.
- Concurrent run claims, restart recovery, duplicate notifications, missed jobs, expiry and DST are exercised once the job runner is introduced. A failed required acquisition leaves the previous snapshot intact and blocks relevant advice.
- Every phase-one read/report command has zero platform write capability. A test dependency intentionally fails if a writer is called.
- Reports distinguish actual versus synthetic data, imported versus inferred facts, ready versus stale advice, and local report generation versus delivered notification or running service.
- Follow repository compilation rules: build before targeted compiled tests, e.g. `npm run build && node --test dist/tests/basketball-*.test.js`. Keep tests directly under `tests/` or adjust the root test glob deliberately; nested tests alone are not selected by the current `npm test` command.
- Run `npm run lint`, the basketball compiled tests and relevant existing regression checks after implementation. Existing unrelated dirty-workspace failures must be reported with evidence and not silently attributed to basketball.

## Implementation sequence after the first slice

First resolve actual league access/settings/team identity; then prove full read acquisition and schedule freshness; then build the statistical baseline and legal optimizer; then add durable read/report scheduling and alerts; then replay historical decisions and calibrate uncertainty; then compare strategy policies on held-out periods; and only then consider a separately approved Fantrax action adapter. Each milestone has an observable result and explicit remaining limitations. Model sophistication cannot compensate for the wrong scoring rules, stale game schedule, or unobserved remaining game caps.

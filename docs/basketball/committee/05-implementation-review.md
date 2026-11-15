# Independent implementation review

Reviewed 2026-10-25. Scope: read-only inspection of `src/basketball/{contracts,categories,calendar,store,fantrax-reader,report,cli}.ts`, the two `config/basketball/banging-3s*.json` files, and `tests/basketball-workflow.test.ts`. The chair owns builds and execution; this reviewer did not run competing builds or edit implementation/tests. Findings were sent promptly to the chair while changes were in progress.

## Updated evidence judgment

Authenticated Fantrax evidence now identifies the roster competition as **NCAAB** and explicitly states that the draft has not taken place and its date has not been set. The authenticated roster is 0/10 active and 0/4 bench. This resolves the earlier draft ambiguity for that observation time: the public API's `running` plus 112 unselected shells is not an active draft clock. Preserve both sources and timestamps, with the explicit home message taking precedence for draft readiness. Do not retain “please sign in” as the remaining blocker after this authenticated inspection has happened.

NCAAB identifies the observed platform competition code; a chosen historical source still requires pool, season and player-ID coverage verification. Empty rosters call for draft preparation and identity/data setup, not waiver recommendations or personal lineup forecasts. These remain observed facts as of the capture, not evergreen assertions after the season advances.

## Release judgment

The implementation is appropriately bounded: no Fantrax writer, no ESPN executor, no football state dependency, no claimed trained model, and no personal win probability. It can qualify as the first local evidence/report milestone after the chair's compiled checks pass and the small remaining validation fixes below are addressed. It does **not** qualify as live advice, a deployed unattended runner, or a completed statistical model.

The most consequential defects found during review were addressed in the source while the review was underway. Re-read observations, rather than initial findings alone, determine the statuses below.

| Priority | Finding | Status / required result |
| --- | --- | --- |
| High | With a null policy and no current period, optional chaining originally made `activeOverlay` undefined, causing the canonical report hash to throw. | **Fixed in reviewed source:** explicit policy/current guards yield `none`. New test covers saving a before-season report without a policy. |
| High | Only league/roster URLs were initially scoped, so another league's rules, authenticated home or draft URL could be accepted as supporting evidence. | **Fixed in reviewed source:** exact HTTPS resource paths and league query/path checks now cover all those resources. New tests reject wrong rules/home/draft sources. |
| High | Synthetic evidence could initially replace a real league capture; report capabilities also claimed browser/403 results independently of actual source kinds. | **Fixed in reviewed source:** synthetic evidence requires a `synthetic-` league identity; real imports reject it. Browser evidence and transport claims are now distinguished. The separate arithmetic demo is explicitly synthetic. |
| Medium | Empty category weight maps pass `every([])` and are mistakenly treated as supported scoring. | **Required fix:** require a nonempty supported mapping, preferably the observed `Default: 1` form, and reject/flag missing or unrecognized per-category weights. Add a report test with eight empty maps. This currently cannot enable advice because readiness is unconditionally false, but it still misstates supported rules. |
| Medium | CLI requires a period for period-scoped endpoints, but the exported `readFantrax` function itself currently permits omitted periods. | **Required fix:** reject missing periods for `getTeamRosters` and `getMatchupScores` before calling the fetcher. Test that the fetcher is not called. Library callers must not reintroduce platform rollover defaults. |
| Medium | Authenticated draft text in an empty-roster blocker is conditional on evidence existence now, but still reads as a current statement after that evidence becomes stale. | **Required wording:** “Authenticated home observed at [timestamp] reported…”; retain the separate stale-source gate. Do not imply a newly checked draft state from a later import/report of old fields. |

## What the implementation gets right

- The category engine aggregates the six counts, calculates shooting ratios from made/attempted totals, rejects missing/incoherent stat lines, and returns unsupported real W/L/T without an explicit comparison policy. Synthetic exact comparisons use cross-products instead of rounded displayed percentages. This proves arithmetic, not forecast quality.
- Calendar parsing preserves the explicit offsets, separate accumulation dates and March 14/March 15 discrepancy. It does not emit a fabricated lock instant. Exact period endpoints and DST offset changes have direct expected-value tests. No NFL week or fixed-Monday fallback is used.
- Scope validation checks league/name/season, team directory consistency, complete team roster keys and roster-period membership. Missing collection rows are not silently replaced with empty lists.
- Content-addressed snapshots reject inconsistent prior content; failed imports leave the prior pointer untouched. Strategy policies are league/team scoped, hashed and chained to the previous revision. A tactical overlay becomes inactive outside its declared period while the underlying roster preference persists.
- `refresh` is explicitly saved-evidence analysis, and `probe` is a distinct GET-only allowlisted operation that never imports its result. HTTP errors cannot fall back to successful fixture data. No authentication/session extraction or submission method exists.
- Reports preserve observation age rather than resetting it on import, distinguish the transcription hash from original payload bytes, and explicitly mark personal advice/execution/model/optimizer as unavailable.
- New tests are directly under `tests/`, use `.js` import suffixes and hand-calculated category expectations, and cover the key real/synthetic, immutability, stale-source and policy cases. Execution results must still come from a fresh build of these tests.

## Deferred hardening before unattended operation

These do not require widening the first local single-writer milestone, provided that limitation stays explicit:

1. Snapshot and policy artifacts are written directly with exclusive-create. An interrupted write can leave a partial orphan which blocks a later identical import/selection. Before a persistent runner, add crash-safe immutable publication and orphan recovery while retaining the old current pointer.
2. Report JSON is exclusive-create and compared on repeat, but `report.md` and `manifest.json` are rewritten beneath the same report ID. Either make all supporting artifacts immutable/verified or narrow the immutability claim to JSON and record renderer version separately.
3. Canonical key sorting uses `localeCompare`. Use a fixed code-unit ordering for portable content hashes across runtime locale/ICU environments.
4. Validate stored-envelope metadata on read, including schema version and ingestion instant; validate overlay period membership once the CLI has a real current calendar dependency. Persist source-resource transport receipts separately before reporting actual live refresh health.
5. Add durable leases, concurrency handling, restart/catch-up, source-freshness enforcement and observed delivery tests before deploying recurring ingestion. A Codex interim follow-up alone is not evidence for these capabilities.

## Verification and reporting boundary

The chair must build before targeted compiled tests and run appropriate regression checks. The pre-basketball baseline remains 67 passing and three failing test-file results; the old failures must be compared by identity and cause, rather than converted into either a clean-suite claim or new basketball regressions. This review did not independently execute the new tests and does not certify an unobserved pass.

The user-facing progress report can say that the planning committee, independent critique, exact league research, authenticated draft-status check and local basketball evidence/report implementation have progressed. It must separately state whether compiled checks, real report generation, the synthetic demo, HTTP probe, and interim automation were actually observed to succeed. No platform action, trained model, player forecast or live automation deployment follows from this review.

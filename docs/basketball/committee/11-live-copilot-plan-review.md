# Live copilot plan review — October 27, 2026

## Verdict

The plan is a cautious, useful execution and validation plan. Current readiness remains **unproven**: the observer and adaptive engine are not implemented, the exact browser loop has not passed its hard gate, and identity/selected-history coverage is unresolved. A bounded observer or Coach mode by tomorrow cannot be ruled out in principle, but depends on measured gates passing in time. The plan correctly keeps every real writer disabled in the current October 28 deployment posture.

## Review findings

- **Use the new evidence matrix as an acceptance record, not as a pass report.** The [matrix](../../../artifacts/basketball/2026-10-27/live-copilot-plan/validation-matrix.json) records prior evidence and pending gates. Its 26 compiled tests and 112-pick replay were previously passed; no new code or browser mock ran in the planning turn. The [current draft source](../../../src/basketball/draft.ts) still takes a manually supplied session and sorts a static priority list. The [browser preflight](../../../artifacts/basketball/2026-10-27/live-copilot-plan/browser-preflight.json) is read-only, lacks per-read observation times, and found no active pick, stable row ID, or verified complete selected history. It cannot serve as a live feed.

- **The exact-bridge spike is the right hard stop/go.** Require the specified 100 changing observations over a sustained 10-minute run through the intended supported browser → engine → visible-board integration, with the timing sample count, median, p95 and maximum. Include tool delay, throttling, missed reads and stale-clock behavior. Do not build the full observer/dashboard/actor on an assumed bridge. Passing this gate establishes loop feasibility only; it does not prove stable player identity, complete history, adaptive advice or Fantrax write safety.

- **Keep the synthetic and Fantrax evidence distinct.** The prior local replay validates only the static local flow and roster fit; it made zero platform calls. A future browser-driven simulator can test its own controls and failure recovery. It cannot establish Fantrax DOM stability, queue precedence, server commit, or college player crosswalk. The college mock lobby was empty at inspection, and the NBA venue cannot validate CBB rules or strategy. Without a suitable real test venue, retain the plan's unvalidated status for production writers.

- **Keep all profiles on the same eight-category evaluation.** The plan correctly requires shared inputs and category-by-category results for Balanced, Guards and Bigs. Pin one board revision, forecasted candidate coverage, legal completion method and opponent scenario across paths; preserve attempt-weighted FG%/FT% and conditional per-game labels. Current coverage is 2,209 of 5,687 player IDs with 29 provider supplements, so plausible early omissions and role/status uncertainty must stay visible.

- **The action scopes are now appropriately separate.** Observe/local Coach, queue edits, rank-list import, exact user-confirmed pick and automatic picks have distinct gates. Keep them independent: a passed mock or one authorized mutation does not enable another. The matrix presently marks live Coach not-ready and each real writer disabled/unvalidated; any change requires its own evidence and authorization.

## Go/no-go

The plan supports proceeding with isolated implementation only after its feasibility spike. Today there is no demonstrated live readiness. A bounded observer/Coach may be considered by draft time only if its applicable bridge, identity, complete-history, freshness and reconciliation gates pass; otherwise use the manual Fantrax fallback. Queue/rank/pick/automatic writes remain disabled unless their separate venue-specific gates and authorization are satisfied.

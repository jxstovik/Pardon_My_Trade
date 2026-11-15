# Draft forecast implementation review — October 27, 2026

## Verdict

The current artifact is a transparent experimental preparation board, and the local recommender is useful as a manual prompt for the October 28 draft. It does not have validated predictive accuracy and it is not a complete player-pool forecast. Treat each candidate as a conditional per-game estimate that needs draft-day status and role review. No platform queue, rank list, autopick, or live pick is changed.

The saved board reports 2,208 forecasts from 5,687 available IDs, 28 RotoWire supplements, three provider-backed cold starts, and 3,479 excluded IDs. RotoWire’s displayed publication label is October 20; retrieval is recorded October 27. The status file is explicitly targeted-partial, and absence of a status record is not clearance.

## Remaining material limitations

### High — forecast coverage is not complete enough to treat the board as a full draft ranking

Only 38.8% of the saved available pool has a forecast: 2,208 of 5,687 IDs. The board now prominently reports the denominator and the 3,479 excluded IDs, and `draft-recommend` returns those coverage counts. The excluded review CSV retains every row, while the Markdown and recommender show only a short ADP-sorted subset. That lane already contains players such as Rodney Rice at cached ADP 111.8, so omissions can affect plausible picks before the end of the draft.

This is a transparent coverage limitation rather than a hidden zero forecast. For tomorrow, check the complete excluded-review CSV or Fantrax ADP list before relying on the proposed order. The 28-player public supplement reduces the freshman trap only for selected players; three cold starts are modeled, and the rest of the unmodeled pool remain unresolved.

### Residual operational assumption — `ownTurn` follows the supplied manual order

`DraftSessionSchema` accepts any eight team IDs and validates picks only for internal consistency with that list. The response now labels turn authority `conditional-on-manual-team-order; not platform verified`, and validation wording says “supplied manual snake order.” This is clear about provenance, but a mistyped or stale order can still make `ownTurn` and `nextOwnOverall` wrong. Recheck the entered order and team slot against the league’s displayed draft order before relying on live timing. No live state feed is independently verified.

### Ongoing modeling limit — heuristic ranks are not calibrated draft value

The forecast is per-game and conditional on playing. It has no games-played or availability probability, matchup win probability, schedule, opponent survival, or validated total-season value. The minute-only low/high scenarios are stress tests, not confidence intervals. The historical shrinkage prior uses a high-role cohort (GP ≥15, MIN ≥15, ADP ≤200), with mean minutes around 33 for guards and 30 for F/C; this can pull a low-role player upward. The 40th eligible-player replacement value is a declared positional proxy, not a joint league allocation. These choices are disclosed in the board, but make the order exploratory.

The 24-hour provider freshness gate measures retrieval age; it does not imply that the underlying article was republished recently. The output now shows the original publication label separately and warns about this distinction. The October 20 projection subset may still be useful for preseason expectations, but it does not establish current injury, role, or eligibility status. The current-status overlay blocks known `out` / eligibility-uncertain records such as JT Toppin from default draft priority, while every other player remains unverified unless reviewed. Recommendation candidates preserve their flags and `reviewRequired` state; a high score must not bypass that review.

## Addressed since the prior review

- Provider rows are now checked against Fantrax player name and school (with explicit school aliases and one documented suffix alias), in addition to Fantrax ID and provider-rank uniqueness.
- Known status observations remain in the conditional forecast but are excluded from default draft priority and recommendations. Status coverage is explicitly targeted-partial.
- The live recommender checks pick-state age plus board, history/pool, and provider retrieval ages; stale live inputs suppress recommendations. Board and candidate outputs carry review flags, and exclusions have a named lane.
- `draftRank` is now distinct from category rank and uses an explicit 40th-player positional replacement proxy. This improves draft-readability while remaining labeled approximate.
- The saved board and provider metadata distinguish article publication time from retrieval time. The initial Toppin status concern and provider identity concern are therefore addressed in this version.
- The board Markdown lead now shows forecasted/available and excluded counts, and the recommender returns full coverage counts.
- `draft-recommend` now checks the selected board’s league, team, and season against the loaded config before using it.
- The manual team-order limitation is labeled directly in `turnAuthority`; neither the order nor turn status is presented as platform verified.

## What is working well

- The scoring target is this league’s eight categories; turnovers are ignored. Provider MIN/PTS/REB/AST are retained where supplied, and modeled shooting fields are reconciled to provider points.
- The recipe, source hashes, observation timestamps, source-vs-modeled fields, cold-start flags, status observations, and limitations are present in the board JSON. Markdown and CSV expose per-player flags.
- Unmodeled players are not assigned zero-valued forecasts. Their IDs, names, schools, Fantrax eligibility, ADP, GP, and exclusion reason are available in the review CSV.
- The local recommender rejects invalid/duplicate picks, enforces contiguous snake-pick consistency with the supplied manual order, checks roster-slot feasibility, filters known blocked statuses, and returns `readyForPlatformExecution: false` with zero live actions.
- Tests cover synthetic provider joins, status blocking, cold-start labeling, roster matching, pick sequencing, and stale-input suppression. This review did not run builds or tests, as requested.

## Use boundary

Use the board to compare conditional player profiles and shortlist candidates for human review. Before draft picks, manually reconcile high-ADP unmodeled players, current availability/eligibility, role changes, and the league’s draft order. Do not interpret the candidate list as a cleared autopick order or a complete player pool. Platform rank-list writes and autopick remain unavailable until a supported write path, separately verified capabilities, and exact policy authorization are established.

This final pass inspected the current source and saved board artifacts. It did not run a build or tests, and it made no code changes or live actions. The parent task is rebuilding after its final source changes; no runtime verification claim is made here.

# Draft forecast and automation review — October 27, 2026

## Recommendation

Prepare a clearly labeled experimental, per-game eight-category board for the October 28 draft. Use the October 27 Fantrax Standard export as a historical starting point, Fantrax ADP as a market reference, and the saved RotoWire preseason ranks as a separate forward-looking signal. Show the three sources side by side. The current evidence supports a directional board with explicit source flags and broad uncertainty; it does not support calibrated season totals, matchup probabilities, or a claim that PMT beats either provider.

The draft is scheduled for October 28 at 9:00 PM EDT, with jxstovik sixth in an eight-team, 14-round snake. Picks last one minute and absent managers are autopicked immediately. Recheck the authenticated draft state, slot, player pool, positions, and ADP shortly before the draft. The October 27 observations are preparation evidence, not a live feed.

The board should rank each player’s expected per-game contribution across PTS, REB, AST, ST, BLK, 3PTM, FG%, and FT%, with equal category weight. Use per-game talent as the main ranking view, then show availability and role confidence separately. The current schedule export cannot support verified counted games, so do not turn per-game values into invented season totals. Until Fantrax’s percentage comparison, minimum-attempt, and cap rules are reconciled, percentage impact is a draft heuristic, not a projected category win.

## What the saved evidence supports

The October 27 official Fantrax export covers 5,687 unique available-player IDs and was observed at 08:00:08 UTC. It is a 2025–26 regular-season, per-game Standard view. GP is a season total; displayed per-game statistics, MIN, and makes/attempts are rounded to one decimal. Of the rows, 3,218 have positive GP, 2,469 have unresolved zero-GP coverage, and two are quarantined by the importer’s stated points-coherence screen. The other 3,216 pass that bounded research screen; this does not verify their future role, school stint, pool eligibility, or forecast quality. Keep original values and quarantine flags intact. Multiplying rounded rates by GP does not recover exact season totals.

The saved five-player RotoWire comparison is a small manual sample from its 2026–27 Power Conference preseason board, which is primarily based on DraftKings points. It reports Jeremy Fears at 1, Tyler Tanner at 2, Thomas Haugh at 3, Motiejus Krivas at 5, and freshman Tyran Stokes at 7. Fantrax’s saved ADP values for these same rows are 56.8, 2.4, 33.3, 134.4, and 217.6; Stokes has zero displayed prior GP. The RotoWire scope and scoring differ from Banging 3s, while Fantrax ADP’s calculation and prospective basis are unvalidated. This five-row sample is a useful sanity check and cold-start guardrail, not a consensus, full coverage, or evaluation set. It contains ranks, not a compatible per-stat projection set.

The schedule CSV has textual game labels but no verified game IDs, year/timezone, or UTC tip instants. A current Vanderbilt profile supports one manual Tyler Tanner identity match, not pool-wide crosswalks or role/availability coverage. The current school label in Fantrax does not prove the player’s prior-season school stint. Available-pool membership changed by six IDs between the October 26 and 27 exports for unknown reasons. Refresh the pool and current ADP before relying on a player’s inclusion or expected availability.

League rules provide eight equally weighted W/L/T categories, 10 active and four reserve slots, a 14-player maximum, and active maxima of four G, four F/C, and two Flx. The verified minimums are zero. These are lineup limits, not a requirement to draft a player at each position. Preserve Fantrax eligibility as the authority; do not infer positional eligibility from basketball convention. Exact category comparison precision, shot minima, and game/appearance caps remain unknown, so the board cannot claim to reproduce Fantrax matchup outcomes.

## Forecast construction

Keep each observation and forecast pinned to its source revision, capture time, Fantrax ID, season, and model version. For every projected field, expose one provenance state:

| State | Meaning |
| --- | --- |
| Source history | The value is copied from the 2025–26 Fantrax display, with its one-decimal precision and season scope. |
| Modeled from history | A forecast transforms a sourced historical value using a declared shrinkage or scenario rule. It is not a new source observation. |
| Imputed cohort prior | The player lacks a usable component; a declared position/cohort distribution supplies a modeled prior. |
| External rank signal | A provider supplies an ordinal rank only. It is not a stat line or a projection in this league’s scoring. |
| Unknown / quarantined | Do not substitute zero or include it in the numeric ranking. Show the reason and retain the player for review. |

For a returning player with positive GP and no quarantine, start with the displayed prior-season per-game line. Shrink low-GP rates toward a position/cohort prior; estimate the shrinkage rule from the available cohort distribution and publish the sample size and rule. Since the export has only season aggregates, this does not estimate within-player game variance. Do not silently apply an unexplained “breakout,” team, injury, or transfer adjustment. Where current school matches the historical label, call that a displayed-label match only.

Keep shooting coherent. Forecast FGA and FTA exposure alongside shooting rates; derive expected FGM and FTM from those components. For ranking impact, compare the player’s expected makes with a declared neutral-rate baseline at the same attempts: FGM − baseline_FG × FGA, and FTM − baseline_FT × FTA. This rewards both accuracy and volume without treating a tiny-sample high percentage as equivalent to a high-volume contribution. Derive points from projected made shots (2 × FGM + 3PTM + FTM) in the modeled line. Retain the raw Fantrax PTS and component fields separately; do not repair historical source rows when their rounded values do not add exactly.

For zero-GP players and missing rate components, use a position × class/cohort prior only when both fields are present and their source meaning is clear. If class or position is missing, fall back to a broader prior and widen the uncertainty tier. Estimate the cohort prior from available positive-GP rows, with small cohorts shrunk toward the full pool. A zero-GP row means unresolved coverage, not zero ability or confirmed freshman status. Make expected minutes/role a separate latent component; if there is no sourced role evidence, use broad bench/rotation/starter scenarios from the declared cohort distribution rather than a zero-minute forecast. Label all such output as modeled. Do not invent individual playing-time certainty from a rank.

Use RotoWire as a sidecar signal for the matched players only. A highly ranked player with no usable history, such as Stokes in the saved sample, should be placed in a cold-start review tier rather than buried by a historical-stat-only sort. Display the provider, rank, scope, match method, and observation date. Do not convert a DraftKings-oriented ordinal rank into PTS, categories, minutes, or an arbitrary numeric bonus. Expand the permitted provider sample before considering a numeric blend.

## Ranking and uncertainty

Publish a central per-game score and all eight component contributions. For the six counting categories, use the projected per-game means. For FG% and FT%, use attempt-weighted make impact as described above. Center each category against a declared replacement-level reference pool and scale it by a robust spread from that same pool; give all eight components equal weight for the saved Balanced profile. Recompute replacement levels as picks are made and show eligibility constraints. The sum is a transparent draft heuristic, not expected category wins, a fantasy-points total, or a probability.

Keep market and uncertainty signals distinct from that score:

- Display Fantrax ADP and its capture age. A market-gap note can compare a player’s current overall pick with ADP, but it is not a probability the player will survive to a later pick. Missing or stale ADP means no market-gap claim.
- Display RotoWire rank beside the score for the matched sample; use it as a review prompt for cold starts and major disagreements, not as a source of Banging 3s category data.
- Show a low/base/high scenario band built from explicit cohort and role scenarios, the assumptions behind each scenario, positive-GP count, and a low/medium/high uncertainty label. Call it a scenario band, not a calibrated confidence interval. Source rounding bounds can be propagated separately from role/sample uncertainty.
- Do not collapse uncertainty into a hidden penalty. Offer the expected-value order and a cautious order based on the lower scenario side by side. This lets the user decide how much risk to take while retaining upside names.
- Keep an “unranked / needs review” group for unknown eligibility, ambiguous identity, missing required inputs, or quarantined history. Do not force every one of the 5,687 IDs into a numeric rank.

The board should state whether a value is per-game talent or season opportunity. Add expected games only after schedule identities, dates, and league period assignment are reconciled; add availability adjustments only when current evidence supports them. With no validated game-level archive or rolling-origin study, scenario widths and ranking quality are experimental. No accuracy, calibration, ADP-beating, or win-rate claim is warranted.

## Draft-day checks and local recommendation mode

Before publishing the board, capture a fresh authenticated home/draft state, exact pick slot/order, current available pool, current Fantrax position eligibility, and ADP observation. Confirm the RotoWire name/school matches individually and preserve ambiguous matches as unknown. Verify the six recently changed pool IDs rather than assigning a draft or transaction cause. Re-run source bounds and point/component coherence checks without modifying the raw CSV. Spot-check that positive RotoWire-ranked zero-history players remain in the cold-start review tier and are not forecast as zero. Show source age, missing coverage, top category contributions, scenarios, ADP, and a clear experimental label on every output.

The safe first automation mode is a local live recommendation assistant. It may read verified draft state and picks, update the local remaining-player board, calculate which candidates can be legally assigned to the remaining active/reserve structure, and recommend the next pick. The user places the pick in Fantrax. It must recompute against current drafted/owned IDs, exact available IDs, eligibility and current pick number. It should display the remaining active slots and reserve capacity, not require filling a position because the league has zero minimums. A proposed player is eligible only if adding them leaves a feasible legal assignment under the verified G/F-C/Flx maxima and the 14-player/10-active/four-reserve limits.

If draft state, player identity, availability, eligibility, or read freshness is uncertain, label the output stale or stop the live recommendation and provide the last timestamped board as preparation only. The current authenticated browser observations and saved export do not establish a reliable unattended live poller. A one-minute pick clock makes this reliability check material; a static board should be ready before the draft as a fallback.

## Platform rank-list or autopick mode

Writing a rank list or configuring platform autopick is a separate capability and authorization. No supported Fantrax writer is present in the basketball implementation, and a readable browser session or guessed endpoint is not proof of a supported write path. Before enabling either operation, independently verify the documented/authorized write mechanism, its exact effect and limits, account permission, safe failure behavior, and a way to read back and confirm the saved result. Treat rank-list editing and automatic pick submission as separate permissions.

Require exact policy authorization for the league and team, named draft and rounds/pick range, permitted player set, category/risk approach, protected/excluded IDs, maximum reach or other pick constraints, tie-breaking, expiry, and behavior when state or a source is stale. Revalidate draft order, selected/owned IDs, legal eligibility, current player availability, roster capacity, and policy immediately before each write. Use idempotent receipts and read-after-write confirmation; if submission outcome is unknown, reconcile platform state before any retry. If any prerequisite is unavailable, retain local recommendations and manual Fantrax submission. The user’s request to prepare the board or plan draft automation does not authorize platform rank-list changes or picks.

## Major issues

1. Historical inputs are one-season rounded per-game aggregates, with unresolved zero-GP coverage, no exact totals, no game-level variance, and no verified current role or schedule. They are a baseline input, not a season forecast.
2. The RotoWire evidence is only five manually matched ordinal ranks from a scoring- and conference-mismatched source. The saved rows do not include compatible stat projections or enough coverage for a numeric source blend.
3. Fantrax ADP is a market reference whose exact basis is unknown and whose October 27 snapshot will age before draft time. Refresh it or mark it stale.
4. Fantrax W/L/T, percentage thresholds/rounding, appearance caps, current eligible pool, and several player identities remain unresolved. Do not advertise legal season-value or matchup optimization.
5. The draft flow has a one-minute timer and immediate absent-manager autopicks, while no verified live polling or supported write path exists. Local recommendation and platform automation must remain distinct.

The recommended deliverable for tomorrow is therefore an auditable experimental per-game board with eight category contributions, a conservative scenario order, a cold-start/provider sidecar, Fantrax ADP context, verified remaining eligibility, and prominent data-age/uncertainty labels. It can guide the human’s pick; it cannot claim a validated forecast or act on Fantrax without the separate checks and exact authorization above.

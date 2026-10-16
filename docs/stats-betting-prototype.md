# Raw-stat fantasy + betting research branch (advisory, not promoted)

## Decision summary

This branch adds two **candidate** skill-position raw-stat models and a deterministic bridge from joint stat samples to the existing league scoring rules and to player-prop probability/EV. The models are **not** superior to the existing 2024 replay on its original observed-game cohort. The opportunity×rate candidate does beat a simpler rolling-points baseline for 2025 QB and TE, but that is **not** evidence of profitable betting, nor a reason to replace the existing QB/TE production models. No bet placement, ESPN transaction, roster update or model promotion occurs.

NFLverse supplies player-level weekly box-score-like stats, not a complete pregame player/availability universe.[1] Its documented update schedule is not a historical capture timestamp for our local files.[2] Every artifact here is a retrospective, **conditional-on-an-observed-player-game** experiment. Missing rows are unknown, not automatic DNP zeros; the 2025 example uses *the current stored 2026 league rules as a what-if*, not proof that the same rules applied in 2025.

## What changed

- `python/stats_betting/raw_stats.py`: position-pool shrinkage + prior-season/last-N raw-stat means (`RawStatModel`) and an opportunity×conditional-efficiency challenger (`OpportunityRateModel`). The latter forecasts QB attempts, RB carries, and WR/TE targets first; completions, catches, yards, TD and interception rates use a prior-16-game player rate shrunk toward a **prior-season-only** position rate. Fumbles, two-point conversions and special-team TDs remain separate stat forecasts. Scenarios apply whole historical stat-residual vectors so a player's stat components co-move, with physical caps for completions/receptions/lost fumbles. These are **within-player** shocks only; no correlated team/game simulation exists yet.
- `python/stats_betting/evaluate_raw.py`, `evaluate_opportunity.py`, `evaluate_props.py`: 2023 hyperparameters, 2022 calibration residuals for illustrative threshold events, 2024 replay comparison and 2025 held-out rolling comparisons. Regular-season QB/RB/WR/TE games only. Opponent, injury, bookmaker line and future-week label are not input features. Both model scripts persist raw predictions locally and source-file SHA-256 in their reports. The direct model's `residuals-2023.json` is only a diagnostic; the threshold Brier evaluation uses the earlier 2022 opportunity-model residuals.
- `src/stats-betting/bridge.ts`: explicit nflverse-to-league stat mapping (`passing_tds → passing_touchdowns`, `passing_interceptions → interceptions`, `rushing_tds`, `receiving_tds`, `fumbles_total → fumbles`, `fumbles_lost_total → fumbles_lost`), position-aware scoring through the existing rule engine, prop win/loss/push frequencies from supplied samples, American-odds expected net profit per unit stake, and same-index joint fantasy-team scenario totals. Missing or conditional league scoring rules fail closed instead of silently producing zeros. It **does not** construct team correlation or supply odds. Do not equate `fumbles_total` with `fumbles_lost_total`; the 2025 local feed has rows where phased fumble-loss counts differ from the total.
- `python/stats_betting/build_bundle.py` + `scripts/stats-betting-readout.mjs`: executable historical example using a GSIS ID, current stored ESPN scoring rules, raw-stat draws and a readout that says `no_timestamped_quote` rather than inventing a wagering EV. A quote can be supplied **only** with book, observed timestamp and a verified forecast cutoff; the historical example intentionally lacks the last item and cannot compute EV.

### Existing strategy audit (do not treat prior report labels as validation)

`python/chatpft_modeling/plan26_metamodel.py` forecasts generic PPR points, not component stats; it blends 2023-fitted weights and reports 2024 skill-position metrics. Its header says the Bayesian component updates through 2023, but its code creates 2024 states from `<2023` and only iterates 2024 weeks. Its 2023 residuals are used both to select weights and to calibrate intervals. `plan26_models.py` fits its GBM with 2023 in the training period and calibrates on in-sample 2023, while labeling a q05–q95 span “80%.” Several preprocessing paths fill missing features from the entire position table target mean. The metamodel's Parquet inputs are absent in this checkout, so its Plan 26 reports have **not** been independently reproduced here. The immutable 2024 replay JSONL is independently readable; even its eligible prediction universe contains future observed participants, so it is not a verified all-eligible pregame forecast.

## Measured results; lower is better

All MAEs are fantasy PPR points per observed game. 2024 comparisons use the **original replay outcomes**, on exactly the common GSIS ID/season/week/position rows; the raw forecast is built from a newer nflverse release. That release has extra mostly-zero rows: comparing against *all* of its player-game rows would make the raw model appear better on the wrong denominator. WR has 2,132 legacy observed replay rows, 2,130 common rows, and three changed common-key labels. The 2024 paired differences below use the legacy target on both forecasts and a week-block bootstrap (2,000 draws; approximate, not an independent season replication).

| Comparison | Common n | Opportunity×rate MAE | Comparator MAE | Paired improvement 95% interval |
|---|---:|---:|---:|---:|
| 2024 QB vs frozen-weights adaptive-feature replay | 664 | 6.341 | 6.290 | −0.172 to 0.069 |
| 2024 RB vs same replay | 1,340 | 4.890 | 4.839 | −0.148 to 0.038 |
| 2024 WR vs same replay | 2,130 | 4.981 | 4.978 | −0.084 to 0.078 |
| 2024 TE vs same replay | 1,083 | 3.804 | 3.794 | −0.081 to 0.059 |
| 2025 QB vs as-of last-four-game PPR | 664 | **6.860** | 7.113 | **0.023 to 0.467** |
| 2025 RB vs rolling PPR | 1,575 | 4.639 | 4.605 | −0.118 to 0.055 |
| 2025 WR vs rolling PPR | 2,511 | 4.501 | 4.457 | −0.175 to 0.074 |
| 2025 TE vs rolling PPR | 1,287 | **3.671** | 3.806 | **0.002 to 0.266** |

The direct raw-stat shrinkage model is retained as an explicit negative control: it is worse than the matched 2024 QB and RB replay, and its initially apparent WR win disappeared when we corrected the observed-game cohort. **The only bounded improvement shown here is 2025 QB/TE versus the simpler rolling PPR baseline, not versus the strongest existing model.** Results are candidate-stage; this is one held-out season, four-position testing, and weak improvement for TE.

For a genuinely raw-stat target, 2025 TE receptions MAE is **1.249** vs **1.289** for rolling receptions (week-block paired improvement interval 0.005–0.074); WR receptions are **worse**, 1.403 vs 1.375 (−0.051 to −0.006). Do not average across unlike stat units or hide losing cohorts. The historical custom league scoring was *not* reconstructed for these PPR benchmarks; only the separate sample bridge uses stored league rules.

Threshold probability tests (`prop-calibration.json`) use **illustrative prespecified lines, not archived bookmaker lines**, and 2022 residual vectors; the 2025 TE receptions >3.5 Brier is 0.130 vs 0.131 for a shrunk player last-eight-games event-rate baseline and 0.176 for a position event-rate baseline. For 2025 QB passing yards >249.5 it is **worse than the stronger player-history event baseline** (0.200 vs 0.195). Brier is a proper probabilistic score, not a measure of realizable betting profit.[4] These examples have no prices or selection/void rules and cannot establish an edge.

### Visual evidence

- [Opportunity model vs existing replay / rolling PPR](../artifacts/stats-betting-raw-v1/opportunity-benchmark.svg) — bars share the same PPR-point scale; 2024 and 2025 have *different* comparators.
- [Raw-stat target MAE](../artifacts/stats-betting-raw-v1/raw-stat-targets.svg) — each row's pair normalized separately; compare within a row, not bar lengths across units.
- [Illustrative threshold Brier](../artifacts/stats-betting-raw-v1/prop-brier.svg) — includes the harder player-event-rate benchmark in gray.
- [2024 actual vs direct raw-stat PPR](../artifacts/stats-betting-raw-v1/scatter.svg) — deterministic observed subset with a 45° reference line, not an in-sample fit. Full metrics, sample counts and source hashes are in `artifacts/stats-betting-raw-v1/{metrics,opportunity-metrics,prop-calibration}.json`.

## Reproduce on this machine

```bash
cd /home/jordan-stovik/.hermes/profiles/chatpft/cache/scratch/pmt-stats-betting
python3 -m unittest discover -s python/stats_betting -p 'test_*.py' -v
npm rebuild better-sqlite3        # on a fresh worktree before SQLite-backed tests
npm test
python3 python/stats_betting/evaluate_raw.py \
  --data-dir /home/jordan-stovik/Pardon_My_Trade/data/nflverse \
  --artifacts artifacts --output artifacts/stats-betting-raw-v1
python3 python/stats_betting/evaluate_opportunity.py \
  --data-dir /home/jordan-stovik/Pardon_My_Trade/data/nflverse \
  --artifacts artifacts --prior-report artifacts/stats-betting-raw-v1/metrics.json \
  --output artifacts/stats-betting-raw-v1
python3 python/stats_betting/evaluate_props.py \
  --data-dir /home/jordan-stovik/Pardon_My_Trade/data/nflverse \
  --prior-report artifacts/stats-betting-raw-v1/metrics.json \
  --output artifacts/stats-betting-raw-v1
python3 python/stats_betting/build_bundle.py \
  --data-dir /home/jordan-stovik/Pardon_My_Trade/data/nflverse \
  --snapshot-db /home/jordan-stovik/Pardon_My_Trade/data/pmt.db \
  --prior-report artifacts/stats-betting-raw-v1/metrics.json \
  --player-id 00-0030061 --position TE --season 2025 --week 1 \
  --output artifacts/stats-betting-raw-v1/example-2025-te.json
node scripts/stats-betting-readout.mjs --bundle artifacts/stats-betting-raw-v1/example-2025-te.json
```

The checked example readout yielded 128 conditional raw-stat samples, 8.900 fantasy points on **currently stored custom scoring rules** with p10 4.06/p50 7.47/p90 14.01, and `no_timestamped_quote`. It was not a historical 2025 league forecast or a bet. Large generated per-row JSONL files and intermediate residuals are local-only and gitignored; the scripts regenerate them from the hashed source files.

## Promotion and betting gates

1. **Causal panel:** archive immutable raw-source snapshots with publication and ingest times, plus scheduled-player roster, opponent/game ID, injury/inactives and bye status. Explicit ESPN athlete ID↔GSIS crosswalk; never use a name-only match. Freeze a decision cutoff relative to kickoff. Group all players in a game in the same chronological fold; training must precede test, as in time-series evaluation.[3]
2. **Two-stage model:** P(active/available | timestamped status), then a distribution of coherent passing/rushing/receiving/kicking/team-defense stats conditional on playing. Integrate to unconditional outcomes only for an actually eligible pregame universe. Joint team-game latent pace and QB↔receiver/defense correlations must be learned from whole-game vectors, not independently sampled player draws. K and D/ST are **not covered** by this candidate and must be separately modeled and reconciled against the exact league scoring items.
3. **Fantasy:** score each raw scenario against the imported league's rules, reject any unsupported stat/conditional/bonus, apply starter slots, bye, waiver/replacement and roster eligibility per scenario, then aggregate matchup/season win distributions. No roster move execution without the existing human approval gate.
4. **Odds:** capture book, market definition, both prices, line, observed time, bet limits/void and settlement; only join quotes known at the forecast cutoff. For American odds, over EV per unit stake = `P(over) × profit_per_unit(over_odds) − P(under)`; exact-line pushes return the stake. Apply prespecified uncertainty and transaction/slippage margin and **abstain** otherwise. Use no-vig prices as a comparator, never as the actual offered break-even price. Without an archived quote set, realized ROI and closing-line value are unknown.
5. **Promotion:** freeze source version, candidate recipe, line selection and metrics *before* a fresh season; compare against existing replay/ESPN/rolling forecasts on the identical eligible cohort and actual scoring rules. Require incremental point accuracy **and** calibrated probability/coverage with week/game-clustered uncertainty and subgroup floors. These reports do not clear that gate. Retain the current champion by default; rollback on coverage/scoring drift or source degradation.

Sources for externally retrieved methodological statements appear below. All numeric results above come from this branch's checked local artifacts, not those web pages.

## Sources

[1] https://nflreadr.nflverse.com/reference/load_player_stats.html
[2] https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
[3] https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
[4] https://scoringrules.readthedocs.io/en/latest/theory.html

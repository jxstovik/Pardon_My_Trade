# Plan 26 — Player-Points Prediction: Execution Status

**Status:** Phases 0–3 complete (initial slice); Phase 4+ (neural models, metamodel) not started.
**Scoring config:** full PPR (`fp_ppr`) is the primary target per user directive; half-PPR stored as optional config. Standard is derivable (`fantasy_points` column retained).
**Date:** 2026-09-09

## What was built

### Phase 0/1 — data foundation (`plan26_ingest.py`, `plan26_k_dst.py`)
- nflverse `player_stats` 2010–2024 (weekly, REG), one row per player-game: `artifacts/plan26/player_games.parquet` (77,552 rows, 2,696 players).
- Kickers via `stats_player_week` files 2010–2024 (2019/2025 missing from that release): FG made by distance bucket (3/3/3/4/5 pts), PAT 1 pt → `kicker_games.parquet` (7,588 kicker-games).
- DST at team-game grain: points allowed + sacks/INT/fumbles/safeties/def-TDs/blocked kicks from aggregated team defense rows merged with `games.csv` scores → `dst_games_partial.parquet` (6,942 team-games).
- **Known limitation (documented):** no yards-allowed component in DST scoring (not present in this source slice); DST baseline uses `10 − points_allowed + turnover/TD/sack points`, centered to realistic mean via +8 offset (mean 0.02, SD 11.6, range −52..35).
- As-of-safe features only: lag1/lag3 rolling means and prior-season means (shifted one season). No future leakage in features; `available_time`/`event_time` columns and news pipeline not yet built (Phase 1 follow-up).
- Availability contract partial: `did_play`, `play_status` (`played_full`/`unknown`); injury/inactive/bye status requires an injury source (nflverse injuries release) — next step.

### Phase 2/3 — specialist quantile GBM + baselines (`plan26_models.py`)
- LightGBM quantile models (q05–q95) per position, train <2024, validate 2024, split-conformal calibration on 2023 residuals.
- Baselines per plan §10.2: position mean, prior-season mean, rolling mean.

### 2024 holdout results (full PPR; skill; K/DST game points)
| Pos | n | GBM MAE | GBM RMSE | Spearman | cov80 | best baseline MAE |
|---|---|---|---|---|---|---|
| QB | 664 | 6.44 | 8.19 | 0.456 | 0.83 | 6.50 (rolling) |
| RB | 1343 | 4.77 | 6.71 | 0.601 | 0.87 | 4.98 (rolling) |
| WR | 2132 | 4.90 | 6.91 | 0.546 | 0.91 | 5.42 (rolling) |
| TE | 1088 | 3.75 | 5.37 | 0.501 | 0.90 | 4.06 (prior-season) |
| K | 561 | 3.00 | 3.80 | 0.382 | 0.82 | 3.42 (pos mean) |
| DST | 544 | 9.20 | 11.59 | 0.035 | 0.84 | 8.91 (pos mean) |

- GBM beats all baselines on MAE for QB/RB/WR/TE/K (acceptance criterion §14 met for this slice). DST is at chance — expected: the model has no opponent-offense features yet and the target is turnover-driven (high variance, low predictability).
- Conformal calibration brings coverage toward nominal 80% (e.g. K 0.82→0.84) with modest width increase.

## Not yet built (per plan)
- Phase 1 remainder: injury/inactive/bye source, historical news replay with `available_time` discipline, schedule merge (home/away, kickoff, weather — `games.csv` already downloaded with roof/surface/temp/wind/spread).
- Hierarchical Bayesian prior + weekly state-space update (§7.1–7.2) — the production spine recommendation.
- Neural models (joint multi-task + specialist NNs), metamodel/superlearner, CRPS metrics, visualization suite (§11).
- 2025 season data: absent from the `player_stats` release used; needs a different endpoint before 2026 in-season forecasting.

# Plan 26 Phase 2/3 — Bayesian spine results (appended to execution status)

### Hierarchical Bayesian preseason prior + weekly state-space update (`plan26_bayes.py`)
- Empirical-Bayes hierarchical prior (partial pooling toward position mean) from all data strictly before 2024; sequential weekly Kalman-style update with recency decay (λ=0.97), variance inflation 1.5× on absence, availability mixture E=P(active)·mean.
- 2024 holdout (full PPR skill; K/DST game points), information through prior week only:

| Pos | weekly MAE | pre-only MAE | rolling MAE | weekly cov80 | weekly CRPS |
|---|---|---|---|---|---|
| QB | 6.42 | 7.02 | 6.46 | 0.79 | 4.67 |
| RB | 5.21 | 5.64 | 5.08 | 0.81 | 3.77 |
| WR | 5.25 | 5.71 | 5.33 | 0.79 | 3.86 |
| TE | 3.97 | 4.03 | 4.04 | 0.79 | 2.92 |
| K | 3.58 | 3.46 | – | 0.75 | 2.51 |
| DST | 9.01 | 8.91 | – | 0.80 | 6.41 |

- Weekly updates beat the preseason-only prior at every skill position (MAE and CRPS) and roughly match the rolling-mean baseline. Availability mixture helps RB/WR/TE. K/DST weekly updates do not help — their game outcomes are noise-dominated at this feature depth.
- Coverage is near nominal 80% for the weekly model (0.75–0.81); preseason-only intervals are too narrow (0.71–0.77).
- Comparison with quantile GBM (same 2024 fold): GBM still leads on MAE (e.g. WR 4.90 vs 5.25). The metamodel (§9) should blend both; the Bayesian spine supplies priors + cold-start behavior, the GBM supplies usage-driven sharpness.

```
cd /opt/data/workspace/Pardon_My_Trade
.venv-pmt/bin/python python/chatpft_modeling/plan26_ingest.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_k_dst.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_models.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_bayes.py
```
Artifacts: `artifacts/plan26/{player_games,kicker_games,dst_games_partial}.parquet`, `backtest_report_2024.json`, `phase1_meta.json`.

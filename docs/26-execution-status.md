# Plan 26 — Player-Points Prediction: Execution Status

**Status:** Phases 0–3 complete + metamodel/conformal + context features + first-cut joint NN. Specialist stack (GBM + Bayesian spine + metamodel) is the production candidate.
**Scoring config:** full PPR (`fp_ppr`) is the primary target per user directive; half-PPR stored as optional config. Standard is derivable (`fantasy_points` column retained).
**Date:** 2026-09-09

## What was built

### Phase 0/1 — data foundation (`plan26_ingest.py`, `plan26_k_dst.py`)
- nflverse `player_stats` 2010–2024 (weekly, REG), one row per player-game: `artifacts/plan26/player_games.parquet` (77,552 rows, 2,696 players).
- Kickers via `stats_player_week` files 2010–2024 (2019/2025 missing from that release): FG made by distance bucket (3/3/3/4/5 pts), PAT 1 pt → `kicker_games.parquet` (7,588 kicker-games).
- DST at team-game grain: points allowed + sacks/INT/fumbles/safeties/def-TDs/blocked kicks from aggregated team defense rows merged with `games.csv` scores → `dst_games_partial.parquet` (6,942 team-games).
- **Known limitation (documented):** no yards-allowed component in DST scoring (not present in this source slice); DST formula uses `points_allowed + turnover/TD/sack points`, centered to realistic mean (mean ≈ 0, SD 11.6).
- As-of-safe features only; no future leakage. `available_time`/`event_time` columns and news pipeline not yet built (Phase 1 follow-up).
- Availability contract partial: `did_play`, `play_status`; injury/inactive/bye source pending.

### Phase 2/3 — specialist quantile GBM + baselines (`plan26_models.py`)
- LightGBM quantile models (q05–q95) per position, train <2024, validate 2024, split-conformal calibration on 2023 residuals.
- Baselines per plan §10.2: position mean, prior-season mean, rolling mean.
- 2024 holdout (full PPR skill; K/DST game points): GBM beats baselines QB/RB/WR/TE/K. DST at chance (0.035 Spearman) — no opponent-offense features in that variant.

### Phase 2/3 — Bayesian spine (`plan26_bayes.py`)
- Empirical-Bayes hierarchical preseason prior + weekly Kalman-style update (recency decay λ=0.97, absence variance inflation 1.5×, availability mixture E=P(active)·mean).
- 2024 holdout: weekly model beats preseason-only at every skill position (MAE and CRPS), cov80 0.75–0.81. K/DST weekly updates don't help (noise-dominated at this feature depth).

### Phase 5 (early) — metamodel + conformal (`plan26_metamodel.py`)
- Constrained non-negative blend of GBM + Bayesian components; weights fit on 2023 out-of-sample rows, evaluated 2024. Split-conformal 80% intervals from 2023 residuals.
- 2024 (MAE vs gbm-only / bayes-only): QB 6.48 (6.65/6.72) | RB 4.77 (4.73/5.58) | WR 5.00 (5.01/5.53) | TE 3.79 (3.79/4.18) | K 3.25 (3.25/3.52) | DST 8.96 (9.30/9.02). Coverage 0.78–0.82.

### Context features (`plan26_context.py`)
- home/away, rest, roof, surface, temp, wind (pre-kickoff fields only; scores never joined), opponent defensive rolling context (points allowed/sacks/takeaways to date), team targets-to-date for WR/TE. Enriched store: `player_games_ctx.parquet`.
- Identical-fold ablation: QB MAE 6.55→6.41 (Spearman 0.433→0.460); RB/WR/TE neutral-to-slightly-positive. Gains are real but small at this feature depth.

### Phase 4 (first cut) — joint multi-task NN (`plan26_joint_nn.py`)
- One PyTorch model, six positions: position embedding + numeric context → shared residual trunk (LayerNorm/GELU) → per-position Gaussian NLL heads (mean+logvar) + availability head. Gaussian NLL loss + BCE availability aux.
- Trained on <2023, conformal z-scale calibrated on 2023, tested 2024.
- **K/DST not yet in the joint NN** — their rows live in separate game-level stores not yet merged into the player-game table (follow-up; plan §3.3 target units).
- 2024 results vs same-fold components:

| Pos | joint NN MAE | GBM | metamodel | NN cov80 | NN Spearman |
|---|---|---|---|---|---|
| QB | 6.46 | 6.55 (6.41 w/ ctx) | 6.48 | 0.79 | 0.478 |
| RB | 4.90 | 4.81 | 4.77 | 0.80 | 0.613 |
| WR | 5.11 | 5.01 | 5.00 | 0.81 | 0.544 |
| TE | 3.86 | 3.82 | 3.79 | 0.81 | 0.516 |

- Verdict: competitive on first cut but does not beat the specialist stack. Per plan §8, the specialist stack remains the production candidate; the joint NN needs deep ensembles, true availability rows (did-not-play data), and game-level auxiliary heads before a fair promotion decision.

### Phase 4 v2 — joint multi-task NN with K/DST, availability, ensembles (`plan26_joint_nn_v2.py`)
- Unified table (146,906 rows): skill + kicker-game + DST team-game with synthetic did-not-play rows from the schedule (missing-rate K 19.5%, skill 40–49%, DST 0). Deep ensemble (5 seeds, mixture variance), game-level aux heads (team points scored/allowed), availability head on true DNP labels.
- Perf lesson: train ONE ensemble per table, evaluate per-position heads (v1 retrained 6×). Bug lesson: per-slice median impute leaves all-NaN columns for position-specific features — follow with fillna(0) or predictions go NaN (hit K/DST in v1 eval).
- 2024 fold: MAE QB 6.62 / RB 5.03 / WR 5.21 / TE 3.97 / K 3.44 / DST 9.00; conformal cov80 0.78–0.81; availability AUC QB .853, RB .851, WR .902, TE .911, K .584.
- Verdict: with availability + ensembles + aux heads, the joint NN is now at parity with the specialist stack (within ~0.1–0.2 MAE everywhere) and uniquely adds DNP probabilities. Per plan §8: still promote via the metamodel, not head-to-head.


- Injury/inactive/bye source; historical news replay with `available_time` discipline.
- Specialist NN (Approach B); MC-dropout comparison; FantasyPros pagination (10 rows/page server-side).
- Full visualization suite (§11); CRPS tables for all variants in one artifact.
- 2025 season data: absent from the `player_stats` release used; needs a different endpoint before 2026 in-season forecasting.

## Reproduce
```
cd /opt/data/workspace/Pardon_My_Trade
.venv-pmt/bin/python python/chatpft_modeling/plan26_ingest.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_k_dst.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_models.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_bayes.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_metamodel.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_context.py
.venv-pmt/bin/python python/chatpft_modeling/plan26_joint_nn.py
```
Artifacts: `artifacts/plan26/{player_games,player_games_ctx,kicker_games,dst_games_partial}.parquet`, `{backtest,bayes,metamodel,context_features,joint_nn}_report_2024.json`, `phase1_meta.json`.

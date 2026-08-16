# ChatPFT Development Manifest

Branch: `feature/ChatPFT`

## Goal

Build local, historical-statistics-driven probabilistic metamodels for fantasy
players. Subjective commentary is context only and must not be used as a
prediction feature. Razzball is the preferred external benchmark and the
per-player fallback when a metamodel or stronger source is unavailable.

## Completed In This Branch

- Added `ProbabilisticProjection` with mean, standard deviation, quantiles, model version, and provenance.
- Added source comparison metrics: MAE, RMSE, bias, sample count, and optional P10-P90 coverage.
- Added deterministic per-player fallback resolution with widened Razzball uncertainty.
- Added fixture-friendly pure contracts so historical backtests can be added without changing the refresh pipeline.
- Added historical position baselines, ensemble variance aggregation, rolling backtests, and interval calibration metrics.
- Added real-data QB/WR training from nflverse outcomes with Razzball projection/ranking provenance and SQLite model artifacts.

## Grand Scheme

1. Contracts and provenance: complete initial slice.
2. Historical source evaluation and Razzball fallback: complete initial slice; integrate into refresh next.
3. Probabilistic baselines and backtesting: initial historical baseline, ensemble, rolling backtest, and calibration implementation complete.
4. Real QB/WR training: complete initial model run; replace conditional player-week data with a full availability panel and add historical point-level Razzball snapshots next.
5. Position models: QB, RB, WR, TE, K, DST using historical usage, team context, and explicit cross-position dependencies.
6. Ensembles: hierarchical Bayesian, distributional boosting, bootstrap trees, regularized baselines, stacking, and Monte Carlo simulation.
7. Calibration: rolling time splits, pinball loss, CRPS/log score, bias, interval coverage, and conformal adjustments.
8. Runtime integration: persist distributions, expose metrics, update recommendations and draft valuation.

## Data Rules

- Use only information available before the prediction period.
- Compare every metamodel against Razzball and other sources on identical player/period rows.
- Report both point accuracy and distribution calibration.
- Preserve source, model version, cutoff timestamp, and fallback reason.
- Never silently replace missing model predictions with a confident point estimate.

## Follow-On Agent Work

- Integrate fallback resolution and probabilistic outputs into `season-refresh.ts`.
- Replace fixture-only history with persisted historical observation fixtures and rolling backtest runner.
- Add source-specific uncertainty estimates from past Razzball errors.
- Implement a Bayesian hierarchical baseline, then a distributional tree baseline.
- Add position workers with shared feature contracts.
- Add correlated Monte Carlo simulation for workload, team scoring, and QB/pass-catcher dependencies.
- Add calibration reports and persistence migration tests.

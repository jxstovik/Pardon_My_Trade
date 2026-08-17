# ChatPFT Development Manifest

Branch: `feature/chatpft-wr-replay`

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
- Added the real-data 2024 WR preseason replay, archive-first source snapshots,
  leakage-safe features, and source benchmark artifacts.

## Grand Scheme

1. Contracts and provenance: complete initial slice.
2. Historical source evaluation and Razzball fallback: complete initial slice; integrate into refresh next.
3. Probabilistic baselines and backtesting: initial historical baseline, ensemble, rolling backtest, and calibration implementation complete.
4. Real QB/WR training: initial run complete; the 2024 WR replay now uses real nflverse rows and archive-first Razzball captures. Full weekly availability and source snapshots remain follow-up work.
5. Position models: WR walk-forward replay is implemented; broader position models remain future work.
6. Ensembles: hierarchical Bayesian, distributional boosting, bootstrap trees, regularized baselines, stacking, and Monte Carlo simulation.
7. Calibration: pinball loss, interval coverage, cluster bootstrap metadata, subgroup metrics, and promotion gates are implemented; CRPS and conformal adjustments remain future work.
8. Runtime integration: approved WR artifact loading, API metrics, and explicit season-refresh opt-in are implemented; recommendation/draft valuation wiring remains future work.

## Data Rules

- Use only information available before the prediction period.
- Compare every metamodel against Razzball and other sources on identical player/period rows.
- Report both point accuracy and distribution calibration.
- Preserve source, model version, cutoff timestamp, and fallback reason.
- Never silently replace missing model predictions with a confident point estimate.

## Follow-On Agent Work

- Integrate approved WR distributions into recommendation and draft valuation.
- Replace the optional structured-news input with provider-specific historical news adapters.
- Add source-specific uncertainty estimates from past Razzball errors.
- Implement a Bayesian hierarchical baseline, then a distributional tree baseline.
- Add position workers with shared feature contracts.
- Add correlated Monte Carlo simulation for workload, team scoring, and QB/pass-catcher dependencies.
- Add calibration reports and persistence migration tests for weekly checkpoint tables.

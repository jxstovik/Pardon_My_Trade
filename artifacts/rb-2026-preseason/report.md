# ChatPFT 2026 RB Preseason Predictions

This artifact uses real nflverse outcomes through 2025 and compares predictions with current Razzball data.

## Model
- Training window: `2018-2025`
- Players predicted: `375`
- Model version: `rb-2026-preseason-hard-stats-ridge-v2`
- Rookie training rows: `3106`
- Context status: `unavailable`

## Razzball Comparison
- Rank samples: `49`
- Rank Spearman: `0.733`
- Top-12 overlap: `0.667`
- Point comparison samples: `136`
- Point MAE versus Razzball: `39.837`

## Takeaways
- The model produces a full `2026-ROS` ranked prediction stream for the draft dashboard.
- Razzball rank correlation is `0.733` on `49` matched players.
- Rookie rows use a separate model and widened uncertainty; matched current Razzball point projections contribute a documented 25% external prior weight.
- Draft capital, college production, and expected role are consumed only when real context records are supplied; missing context is not synthesized.
- Availability, role, and news sources remain the largest unmodeled uncertainty.

## Dashboard Contract
- `predictions.json` contains model and Razzball ranks/points.
- `weekly-predictions.jsonl` is compatible with the modeling API.
- `walkforward-manifest.json` identifies this as a current preseason artifact with one checkpoint.
- Promotion is intentionally false until 2026 outcomes exist.

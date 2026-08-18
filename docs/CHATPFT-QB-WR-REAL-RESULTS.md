# ChatPFT Real QB/WR Model Results

Generated from actual downloaded sources with:

```bash
python3 python/chatpft_modeling/train_real_qb_wr.py \
  --data-dir data \
  --output artifacts/qb-wr-models-real
```

Use `--refresh` to download fresh source files. Raw downloads are intentionally
kept in the ignored `data/` directory. Their URLs, SHA-256 checksums, and file
sizes are stored in each SQLite database's `source_files` table.

## Data Sources

### Historical outcomes

- Source: nflverse `player_stats.csv.gz`
- URL: `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz`
- Seasons used: 2018-2024 regular season
- Training: 2018-2023
- Validation: 2024
- Target: `fantasy_points_ppr` when present, otherwise `fantasy_points`
- Positions: QB and WR

The model evaluates player-weeks present in the nflverse player-stat feed. A
player absent from a weekly row is not currently added as a zero-output
observation; availability modeling is therefore a follow-on data step.

### Razzball projections

- Source: Razzball 2026 projections table
- URL: `https://football.razzball.com/projections/`
- Stored in each database as `current_razzball`
- Matched current names receive both a Razzball projected point total and a
  metamodel mean/standard deviation in `current-predictions.json`.

### Razzball rankings

- Source: published 2025 QB and WR ranking pages
- QB: `https://football.razzball.com/2025-fantasy-football-quarterback-rankings/`
- WR: `https://football.razzball.com/2025-fantasy-football-wide-receiver-rankings/`
- Stored in each database as `razzball_rankings`

The public weekly projection tables are membership-gated. This run does not
attempt to bypass that access control. The accessible published rankings are
stored as ordinal source information; they are not incorrectly converted into
point predictions.

## Model

Model version: `nflverse-bootstrap-ridge-v1`

Features are information available before the player-week:

- Prior player fantasy points, last six observations
- Prior team positional fantasy points, last eight observations
- Availability indicator from the observed player-stat row
- Prior team QB fantasy points for WRs
- Prior player scoring rate as a red-zone proxy

The model is a 30-member bootstrap ridge ensemble trained from up to 5,000
sampled rows per member. The final standard deviation combines model-member
disagreement with a held-in-sample residual estimate. It emits mean, standard
deviation, P10, and P90.

The comparison baseline is the prior-player-history estimate. This is a useful
minimum bar, not a production competitor.

## Held-Out Accuracy

| Position | Split | Model | Samples | MAE | RMSE | Bias | P10-P90 coverage |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| QB | Training | Bootstrap ridge metamodel | 3,799 | 6.490 | 8.096 | -0.007 | 76.8% |
| QB | Training | Prior-history baseline | 3,799 | 6.609 | 8.377 | 0.380 | n/a |
| QB | Validation 2024 | Bootstrap ridge metamodel | 664 | 6.487 | 8.061 | -0.031 | 75.8% |
| QB | Validation 2024 | Prior-history baseline | 664 | 6.539 | 8.277 | 0.086 | n/a |
| WR | Training | Bootstrap ridge metamodel | 12,569 | 5.276 | 6.903 | 0.001 | 83.4% |
| WR | Training | Prior-history baseline | 12,569 | 5.358 | 7.076 | 0.260 | n/a |
| WR | Validation 2024 | Bootstrap ridge metamodel | 2,132 | 5.075 | 6.796 | -0.083 | 84.4% |
| WR | Validation 2024 | Prior-history baseline | 2,132 | 5.104 | 6.933 | 0.078 | n/a |

### Reading The Results

- The metamodel beats the prior-history baseline on held-out 2024 MAE and RMSE
  for both QB and WR.
- Improvements are modest, which is preferable to reporting an inflated gain
  from leakage or a benchmark fixture.
- QB validation RMSE improves from 8.277 to 8.061.
- WR validation RMSE improves from 6.933 to 6.796.
- Validation interval coverage is 75.8% for QB and 84.4% for WR. The nominal
  target is not forced to 80%; calibration should be monitored by position.
- These are conditional player-week metrics for rows present in nflverse, not
  roster-level fantasy-season accuracy.

Razzball current point predictions do not have 2026 actual outcomes yet and
therefore are not assigned a fabricated accuracy score. Razzball rankings are
stored for future rank correlation and top-k evaluation when the corresponding
season outcome is complete.

## Artifacts

Per-position output is under `artifacts/qb-wr-models-real/{qb,wr}/`:

- `model.json`
- `metrics.json`
- `training_predictions.json`
- `validation_predictions.json`
- `current-predictions.json`
- `{qb,wr}-metamodel.sqlite`
- `training-benchmark.svg`
- `validation-benchmark.svg`
- `training-fit.svg`
- `validation-fit.svg`

The SVG files are the committed training and validation images. The benchmark
charts compare the metamodel with the prior-history baseline. Fit charts show
actual versus predicted player-week outputs; the diagonal represents perfect
prediction.

## Limitations And Next Data Work

- Build a complete availability panel from weekly rosters so missed games are
  modeled explicitly rather than omitted.
- Add historical Razzball point projections captured before each week. Current
  public access does not provide the premium weekly table without credentials.
- Add season-specific team and opponent features without using future values.
- Evaluate ranking quality with Spearman correlation, top-12/top-24 hit rate,
  and regret once historical rank snapshots are aligned to outcomes.
- Recalibrate predictive intervals on rolling out-of-time residuals.

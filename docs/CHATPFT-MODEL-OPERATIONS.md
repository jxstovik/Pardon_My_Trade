# ChatPFT Model Operations Guide

This guide covers the historical-statistics-first modeling workflow for
preseason projections and weekly updates. The modeling workbench is available
at `/modeling` when the PMT API server is running.

The completed real-data WR preseason replay is specified in
`docs/CHATPFT-WR-REPLAY-SPEC.md` and recorded in
`docs/CHATPFT-WR-PHASES-0-4.md`. Run it with:

```bash
npm run model:wr:replay
npm run model:wr:walkforward
```

Its outputs are written to `artifacts/wr-2024-replay/`. Historical source HTML
and the nflverse download remain under the ignored `data/` directory; the
artifact manifest records their hashes and archive capture URLs.

The walk-forward output includes `checkpoints.jsonl`, weekly predictions,
attribution, calibration metrics, subgroup metrics, and a promotion decision.
The dashboard reads these files through the modeling API routes.

The position-wide replay commands and feature differences are documented in
`docs/CHATPFT-POSITION-REPLAY.md`. QB, RB, WR, and TE outputs are kept in
separate artifact directories and must not be compared using different source
denominators.

To opt an approved, season-matching WR artifact into an explicit season
refresh:

```bash
PMT_WR_ARTIFACT_DIR=artifacts/wr-2024-replay npm run pmt -- refresh
```

The runtime rejects artifacts without a passing promotion decision and does
not retrain from an HTTP request.

## Principles

- Train only on information available before the prediction cutoff.
- Treat Razzball as the primary external benchmark, not as unquestionable truth.
- Compare Razzball, other sources, and metamodels on the same player-period rows.
- Use commentary to explain a result after modeling; never use subjective commentary as an unmeasured feature.
- Every prediction must include mean, standard deviation, quantiles, provenance, model version, and data cutoff.
- Never narrow uncertainty merely because a source has a confident tone.

## Start The Workbench

Build and start the server:

```bash
npm run build
PMT_PORT=3000 npm run pmt -- serve
```

Open `http://127.0.0.1:3000/modeling`.

On PowerShell:

```powershell
npm run build
$env:PMT_PORT="3000"
npm run pmt -- serve
```

The workbench is a configuration and visualization surface. It does not
silently overwrite production models. Actual refreshes remain controlled by
the CLI and persisted data paths.

## Preseason Workflow

### 1. Prepare historical data

Create a JSON file containing only completed historical observations:

```json
{
  "observations": [
    {
      "playerId": "player-001",
      "position": "WR",
      "scoringPeriod": "2024-W1",
      "points": 18.4,
      "availability": 1
    }
  ]
}
```

Keep the following rules:

- Use stable player IDs whenever possible.
- Keep scoring format and period definitions consistent.
- Do not mix weekly and ROS observations in one target column.
- Record the historical data cutoff and source extraction time.
- Preserve zero-point games; they are valid outcomes, not missing values.

### 2. Establish benchmarks

Collect preseason Razzball projections and any comparison sources for the same
players and scoring period. Store source, fetch time, projection horizon, and
player matching status.

The benchmark report should compare:

- Razzball
- ESPN
- FFToday
- Historical baseline
- Metamodel ensemble

Use MAE, RMSE, bias, and prediction interval coverage. Do not select a model
because it has the highest mean projection.

### 3. Select a position configuration

In `/modeling`:

1. Select QB, RB, WR, TE, K, or DST.
2. Select Historical stats.
3. Select Razzball.
4. Add only features available at the preseason cutoff.
5. Run the preview.
6. Inspect source bars, metamodel MAE/RMSE, mean, standard deviation, and P10-P90 interval.

Recommended starting features:

- Recent points
- Season points
- Availability
- Team pace
- Offensive-line context
- QB dependency for WR and TE

Do not add a feature until its historical availability and leakage behavior are
documented.

### 4. Tune conservatively

Change one modeling choice at a time:

- Position baseline prior weight
- Historical lookback window
- Source inclusion
- Feature inclusion
- Ensemble size
- Residual variance scaling

Use rolling time splits. A preseason model must never train on a later week of
the same season. Compare the new configuration with the previous model using
the same holdout periods.

### 5. Approve a preseason model

Record:

- Model version
- Training cutoff
- Source versions
- Feature list
- Position
- Backtest periods
- MAE/RMSE/bias
- P10-P90 coverage
- Known degraded cases

Only promote a model when it improves or preserves both point accuracy and
calibration. A lower RMSE with badly under-covered intervals is not an
acceptable promotion.

## Weekly Update Workflow

### 1. Freeze the cutoff

Before running the update, record the timestamp. Only use information known at
that timestamp. Late injury or lineup information belongs in the next update,
not retroactively in the current training set.

### 2. Fetch sources

Run the configured projection refresh with Razzball enabled:

```bash
PMT_PROJECTION_SOURCES=espn,razzball,fftoday npm run pmt -- refresh
```

If a source is unavailable, keep the degraded-source record. Do not replace a
missing source with a zero or treat a missing source as evidence against a
player.

### 3. Run the probabilistic layer

Provide historical data when rebuilding runtime distributions:

```bash
PMT_HISTORICAL_DATA_PATH=data/historical-observations.json \
PMT_PROJECTION_SOURCES=espn,razzball,fftoday \
npm run pmt -- refresh
```

The runtime writes `data/probabilistic-projections.json`. Each row contains a
distribution and provenance. Razzball receives widened uncertainty when it is
used as a fallback.

### 4. Review discrepancies

For every material difference between Razzball and the metamodel, inspect:

- Player matching
- Projection horizon
- Recent workload
- Historical sample size
- Availability assumptions
- Team context changes
- Feature freshness
- Model residuals for the position

Do not manually force the metamodel toward Razzball. Instead, classify the
discrepancy as data error, timing difference, legitimate model disagreement, or
fallback behavior.

### 5. Calibrate and promote

After actual results arrive, append the completed observation and run the
rolling backtest. Track:

- Mean absolute error
- RMSE
- Bias
- P10 coverage
- P90 coverage
- P10-P90 interval coverage
- Average standard deviation

Adjust variance before adjusting means when predictions are directionally
correct but intervals are too narrow or too wide. Keep a versioned record of
every promoted change.

## Position-Specific Update Notes

- QB: update rushing role and offensive-line inputs first; pass-catcher models depend on QB changes.
- RB: update workload, goal-line share, committee usage, and injury availability.
- WR: update route participation, target share, QB dependency, and target competition.
- TE: update routes, blocking usage, red-zone targets, and quarterback stability.
- K: update implied team points, weather, and red-zone conversion.
- DST: update opponent QB, offensive-line injuries, pressure rate, and game script.

## Failure Handling

- Missing metamodel: use the strongest available external source.
- Missing primary external source: use Razzball per player.
- Missing Razzball: use a position baseline with widened uncertainty.
- Missing historical rows: reduce confidence and record the degraded feature set.
- Player matching collision: exclude the row and report it; never silently attach it.

## Promotion Checklist

- [ ] Historical data has a documented cutoff.
- [ ] Razzball comparison rows are aligned by player and period.
- [ ] No future information enters features.
- [ ] Point metrics are recorded by source and position.
- [ ] Interval coverage is recorded.
- [ ] Model version and feature set are persisted.
- [ ] Fallback behavior is tested.
- [ ] Production refresh succeeds in degraded-source mode.
- [ ] Recommendations consume the approved model output only.

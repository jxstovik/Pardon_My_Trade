# Season model-performance evaluation

Gateway or terminal-chat prompt: “Use pmt-weekly-scout to evaluate all completed 2026 weeks. Rank top 50/top 150 by pregame model mean, show position breakdowns and every current-roster player, and create 45-degree plots with predictive whiskers. Keep archived forecasts separate from causal replays.”

The existing read connection exposes pmt_start_model_evaluation and pmt_get_model_evaluation. Start returns immediately; status reports completion, metrics, warnings and HTML/PDF/Markdown/CSV paths. The worker forces the read role and disables ESPN execution. It never promotes models.

Terminal command:

```bash
cd /home/jordan-stovik/Pardon_My_Trade
PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH" npm run scout:evaluate
```

Project-local dependencies are in data/scout-pydeps and data/evaluation-pydeps. Python can be set through PMT_SCOUT_PYTHON. Forecasts are reconstructed with 2015–2025 plus only 2026 weeks before each target. Selection uses predicted means; actuals are matched afterward. Today’s roster is evaluated retrospectively, independently of historical ownership. Current-season observed identities and missing historical role/inactive snapshots limit how closely replay reproduces real-time decisions.

The 45-degree plots use actual score on x and projected mean on y, with vertical 10th–90th percentile predictive intervals. Training error is in-sample; forward test is later-week performance. Predictive intervals, bootstrap MAE confidence intervals and residual standard deviations are labeled separately.

Important audit finding: D/ST training-target totals disagree with ESPN league totals. The report flags these separately; repair and validate target construction before interpreting defense forecasts as accurately scored. Do not silently revise or promote models from an evaluation request.

## Target repair and calibration

The evaluation refresh captures ESPN raw stat counts for D/ST and independently applies the league's scoring items (position 16 overrides). It rejects component totals that disagree with ESPN actuals. `data/scout/espn-dst-targets.json` supplies canonical captured 2026 training targets, restricted to each model's causal cutoff. Historical NFLverse reconstruction now credits opponent fumble recoveries, omits the opponent fumble-loss penalty, includes recovered-fumble touchdowns and excludes defensive touchdowns from points allowed. Full historical 2015-2025 parity against ESPN components remains unverified; residual NFLverse differences and offensive returner scoring remain visible. Models stay candidates.

`npm run scout:evaluate` also builds an interval-calibration candidate. Each target week uses only earlier replay weeks' outcomes; the top-50 and rank-51-to-150 bands are fixed by pregame means. The finite-sample conformal order statistic expands (never shrinks) intervals while preserving projected means. Week 1 is uncalibrated; Weeks 2 onward and the final completed week are reported separately. Dependent samples and drift prevent guaranteed coverage. Inspect `calibration-manifest.json`, holdout coverage, interval width and unchanged MAE before requesting any promotion.

## Immutable pregame archives

Use `pmt_archive_pregame_forecasts` with `week` to archive existing candidate forecasts and model weights; `pmt_get_forecast_archives` verifies and lists saved snapshots. Terminal equivalent:

```bash
PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH" npm run scout:archive -- --week 6
```

Weekly scouting refreshes automatically attempt this step. Archives are content-addressed, atomically installed without replacing prior files, and integrity-checked on read. They store capture time, build time, source/model manifest, exact model weights and forecast/report data. Both build and capture must precede the first scheduled kickoff; snapshots after that deadline are rejected. Repeating identical input preserves the original capture time. Changed forecasts create a separate immutable snapshot. Later audits use the latest valid pregame snapshot for each completed week; they never backfill replay forecasts into the archive. Archive failure is shown in weekly workflow status and does not falsely mark the report pregame. Local files can be manually altered, but altered content fails integrity checks; this is application immutability, not a remote tamper-proof timestamp service.

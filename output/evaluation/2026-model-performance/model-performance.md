# 2026 season model-performance audit

Completed Weeks 1-5. **Replay forecasts are reconstructed, not issued at the time.** Saved pregame forecasts are evaluated separately. This tracks today’s roster retrospectively; it does not imply you owned every player every week.

## Cohort results

Top 50 and top 150 are selected each week by pregame model mean, not actual scoring. The all-position and FLEX-only versions are separate. Missing actuals are counted, never filled with zero.

| Group | Scored / selected | MAE | RMSE | Bias | 80% interval coverage |
|---|---:|---:|---:|---:|---:|
| all_top50 | 250 / 250 | 8.24 | 9.97 | 1.15 | 70.0% |
| flex_top50 | 250 / 250 | 7.91 | 9.60 | 0.47 | 71.6% |
| all_top150 | 748 / 750 | 7.32 | 8.92 | 1.44 | 66.8% |
| flex_top150 | 739 / 750 | 6.55 | 8.07 | 1.03 | 68.7% |

## Position breakdowns

| Cohort | Position | N | MAE | RMSE | Bias | 80% coverage |
|---|---|---:|---:|---:|---:|---:|
| Top 50 | QB | 133 | 8.00 | 9.72 | 2.13 | 67.7% |
| Top 50 | RB | 63 | 7.30 | 8.91 | 0.11 | 82.5% |
| Top 50 | WR | 49 | 10.39 | 12.00 | -0.04 | 59.2% |
| Top 50 | TE | 5 | 5.35 | 6.86 | -0.39 | 80.0% |
| Top 50 | K | 0 | N/A | N/A | N/A | 0.0% |
| Top 50 | DST | 0 | N/A | N/A | N/A | 0.0% |
| Top 150 | QB | 215 | 8.33 | 9.78 | 3.30 | 57.7% |
| Top 150 | RB | 168 | 6.91 | 8.36 | 0.93 | 76.8% |
| Top 150 | WR | 241 | 7.41 | 9.22 | 0.79 | 68.5% |
| Top 150 | TE | 90 | 6.63 | 7.97 | 0.52 | 62.2% |
| Top 150 | K | 33 | 4.24 | 5.44 | -0.87 | 75.8% |
| Top 150 | DST | 1 | 1.18 | 1.18 | 1.18 | 100.0% |

![[position-breakdowns.png]]

![[top50-45-degree.png]]

![[top150-45-degree.png]]

![[weekly-accuracy-calibration.png]]

![[training-and-error-variation.png]]

## Your individual players

![[roster-weekly-1.png]]

![[roster-weekly-2.png]]

| Player | Week | Replay prediction | 80% interval | Actual | Error | Actual source |
|---|---:|---:|---|---:|---:|---|
| Ashton Jeanty | 1 | 15.04 | 5.76–24.84 | 32.70 | -17.66 | ESPN league-scored actual |
| Ashton Jeanty | 2 | 20.29 | 6.84–33.89 | 10.30 | 9.99 | ESPN league-scored actual |
| Ashton Jeanty | 3 | 17.46 | 5.87–29.02 | 12.30 | 5.16 | ESPN league-scored actual |
| Ashton Jeanty | 4 | 16.22 | 5.51–28.94 | 18.60 | -2.38 | ESPN league-scored actual |
| Ashton Jeanty | 5 | 16.08 | 6.19–27.93 | 10.70 | 5.38 | ESPN league-scored actual |
| Malik Nabers | 1 | 17.76 | 6.71–31.14 | 12.90 | 4.86 | ESPN league-scored actual |
| Malik Nabers | 2 | 16.81 | 5.62–29.85 | 1.10 | 15.71 | ESPN league-scored actual |
| Malik Nabers | 3 | 12.48 | 4.21–21.38 | 7.60 | 4.88 | ESPN league-scored actual |
| Malik Nabers | 4 | 10.45 | 2.26–18.84 | 23.20 | -12.75 | ESPN league-scored actual |
| Malik Nabers | 5 | 14.11 | 3.91–25.72 | 29.10 | -14.99 | ESPN league-scored actual |
| Josh Allen | 1 | 18.97 | 8.07–28.98 | 35.66 | -16.69 | ESPN league-scored actual |
| Josh Allen | 2 | 22.47 | 11.23–34.05 | 40.82 | -18.35 | ESPN league-scored actual |
| Josh Allen | 3 | 25.02 | 11.45–38.09 | 17.46 | 7.56 | ESPN league-scored actual |
| Josh Allen | 4 | 21.56 | 10.50–32.44 | 18.52 | 3.04 | ESPN league-scored actual |
| Josh Allen | 5 | 19.61 | 9.60–30.39 | 30.50 | -10.89 | ESPN league-scored actual |
| Jameson Williams | 1 | 12.42 | 2.37–23.59 | 8.50 | 3.92 | ESPN league-scored actual |
| Jameson Williams | 2 | 11.67 | 3.25–22.08 | 5.30 | 6.37 | ESPN league-scored actual |
| Jameson Williams | 3 | 10.81 | 3.24–20.73 | 8.90 | 1.91 | ESPN league-scored actual |
| Jameson Williams | 4 | 9.24 | 1.84–18.59 | 16.20 | -6.96 | ESPN league-scored actual |
| Jameson Williams | 5 | 10.32 | 1.92–19.73 | 18.70 | -8.38 | ESPN league-scored actual |
| George Kittle | 1 | 14.70 | 4.75–26.00 | 3.20 | 11.50 | ESPN league-scored actual |
| George Kittle | 2 | 9.50 | 1.87–18.16 | 18.00 | -8.50 | ESPN league-scored actual |
| George Kittle | 3 | 11.24 | 3.04–21.55 | 26.20 | -14.96 | ESPN league-scored actual |
| George Kittle | 4 | 13.29 | 4.04–24.63 | 17.00 | -3.71 | ESPN league-scored actual |
| George Kittle | 5 | 12.57 | 3.34–24.26 | 7.40 | 5.17 | ESPN league-scored actual |
| Wan'Dale Robinson | 1 | 12.90 | 3.71–22.55 | 8.80 | 4.10 | ESPN league-scored actual |
| Wan'Dale Robinson | 2 | 10.52 | 2.98–19.32 | 1.90 | 8.62 | ESPN league-scored actual |
| Wan'Dale Robinson | 3 | 6.65 | 0.81–15.48 | 18.70 | -12.05 | ESPN league-scored actual |
| Wan'Dale Robinson | 4 | 10.45 | 2.80–19.37 | 11.00 | -0.55 | ESPN league-scored actual |
| Wan'Dale Robinson | 5 | 10.44 | 3.16–19.53 | 11.30 | -0.86 | ESPN league-scored actual |
| Tony Pollard | 1 | 11.36 | 3.94–21.24 | 4.40 | 6.96 | ESPN league-scored actual |
| Tony Pollard | 2 | 6.66 | 1.01–14.85 | 7.50 | -0.84 | ESPN league-scored actual |
| Tony Pollard | 3 | 9.32 | 2.20–18.77 | 13.60 | -4.28 | ESPN league-scored actual |
| Tony Pollard | 4 | 10.12 | 1.45–18.78 | 13.00 | -2.88 | ESPN league-scored actual |
| Tony Pollard | 5 | 10.72 | 3.02–19.75 | 5.20 | 5.52 | ESPN league-scored actual |
| Michael Wilson | 1 | 12.39 | 3.60–22.86 | 10.60 | 1.79 | ESPN league-scored actual |
| Michael Wilson | 2 | 12.00 | 3.33–22.48 | 3.80 | 8.20 | ESPN league-scored actual |
| Michael Wilson | 3 | 9.41 | 2.06–18.94 | 25.90 | -16.49 | ESPN league-scored actual |
| Michael Wilson | 4 | 13.50 | 4.21–24.10 | 16.50 | -3.00 | ESPN league-scored actual |
| Michael Wilson | 5 | 14.36 | 4.20–26.16 | 7.28 | 7.08 | ESPN league-scored actual |
| Kenny Gainwell | 1 | 10.91 | 2.25–21.61 | 2.80 | 8.11 | ESPN league-scored actual |
| Kenny Gainwell | 2 | 4.89 | 0.28–11.31 | 4.50 | 0.39 | ESPN league-scored actual |
| Kenny Gainwell | 3 | 4.87 | 0.10–9.69 | 3.00 | 1.87 | ESPN league-scored actual |
| Kenny Gainwell | 4 | 4.76 | 0.65–10.30 | 10.70 | -5.94 | ESPN league-scored actual |
| Kenny Gainwell | 5 | 5.63 | 0.01–13.67 | 5.80 | -0.17 | ESPN league-scored actual |
| RJ Harvey | 1 | 11.94 | 3.41–23.00 | 8.10 | 3.84 | ESPN league-scored actual |
| RJ Harvey | 2 | 8.78 | 1.61–17.29 | 0.00 | 8.78 | ESPN league-scored actual |
| RJ Harvey | 3 | 8.88 | 1.86–17.58 | 10.70 | -1.82 | ESPN league-scored actual |
| RJ Harvey | 4 | 9.14 | 2.06–17.07 | 19.30 | -10.16 | ESPN league-scored actual |
| RJ Harvey | 5 | 11.85 | 2.62–22.22 | 0.70 | 11.15 | ESPN league-scored actual |
| Adonai Mitchell | 1 | 6.95 | 0.23–15.57 | 9.00 | -2.05 | ESPN league-scored actual |
| Adonai Mitchell | 2 | 7.61 | 1.36–16.50 | 12.30 | -4.69 | ESPN league-scored actual |
| Adonai Mitchell | 3 | 9.33 | 1.97–19.07 | 0.00 | 9.33 | ESPN league-scored actual |
| Adonai Mitchell | 4 | 9.48 | 2.23–19.44 | 0.00 | 9.48 | ESPN league-scored actual |
| Adonai Mitchell | 5 | 9.72 | 2.36–20.15 | 0.00 | 9.72 | ESPN league-scored actual |
| Eddy Pineiro | 1 | 8.14 | 2.21–14.13 | 10.00 | -1.86 | ESPN league-scored actual |
| Eddy Pineiro | 2 | 7.93 | 2.07–13.88 | 5.00 | 2.93 | ESPN league-scored actual |
| Eddy Pineiro | 3 | 8.34 | 2.48–13.63 | 6.00 | 2.34 | ESPN league-scored actual |
| Eddy Pineiro | 4 | 8.25 | 2.88–14.84 | 5.00 | 3.25 | ESPN league-scored actual |
| Eddy Pineiro | 5 | 8.15 | 2.84–14.17 | 6.00 | 2.15 | ESPN league-scored actual |
| Tyjae Spears | 1 | 9.04 | 1.61–19.04 | 4.40 | 4.64 | ESPN league-scored actual |
| Tyjae Spears | 2 | 5.90 | 0.52–12.03 | 9.00 | -3.10 | ESPN league-scored actual |
| Tyjae Spears | 3 | 8.72 | 1.68–18.21 | 0.50 | 8.22 | ESPN league-scored actual |
| Tyjae Spears | 4 | 5.59 | 0.50–13.45 | 1.60 | 3.99 | ESPN league-scored actual |
| Tyjae Spears | 5 | 4.81 | 0.20–10.91 | 9.80 | -4.99 | ESPN league-scored actual |
| Rashid Shaheed | 1 | 7.37 | 1.31–16.81 | 1.40 | 5.97 | ESPN league-scored actual |
| Rashid Shaheed | 2 | 6.03 | 0.75–13.12 | 6.90 | -0.87 | ESPN league-scored actual |
| Rashid Shaheed | 3 | 7.99 | 0.25–16.74 | 3.40 | 4.59 | ESPN league-scored actual |
| Rashid Shaheed | 4 | 6.76 | 0.03–15.64 | 12.30 | -5.54 | ESPN league-scored actual |
| Rashid Shaheed | 5 | 7.67 | 1.79–16.43 | 4.30 | 3.37 | ESPN league-scored actual |
| Brian Robinson Jr. | 1 | 4.35 | 0.07–10.44 | 3.10 | 1.25 | ESPN league-scored actual |
| Brian Robinson Jr. | 2 | 5.54 | 0.25–13.45 | 8.70 | -3.16 | ESPN league-scored actual |
| Brian Robinson Jr. | 3 | 9.73 | 2.26–19.32 | 11.00 | -1.27 | ESPN league-scored actual |
| Brian Robinson Jr. | 4 | 8.10 | 1.15–17.77 | 25.70 | -17.60 | ESPN league-scored actual |
| Brian Robinson Jr. | 5 | 10.15 | 1.95–21.34 | 1.60 | 8.55 | ESPN league-scored actual |
| Colts D/ST | 1 | 6.26 | -0.30–14.76 | -5.00 | 11.26 | ESPN league-scored actual |
| Colts D/ST | 2 | 2.97 | -3.83–10.44 | -5.00 | 7.97 | ESPN league-scored actual |
| Colts D/ST | 3 | 3.07 | -2.46–9.80 | 6.00 | -2.93 | ESPN league-scored actual |
| Colts D/ST | 4 | 2.95 | -3.58–10.56 | 7.00 | -4.05 | ESPN league-scored actual |
| Colts D/ST | 5 | 4.53 | -1.92–11.76 | -1.00 | 5.53 | ESPN league-scored actual |

## Saved pregame forecasts

| Player | Saved prediction | 80% interval | ESPN actual | Error |
|---|---:|---|---:|---:|
| Ashton Jeanty | 16.08 | 6.19–27.93 | 10.70 | 5.38 |
| Malik Nabers | 14.11 | 3.91–25.72 | 29.10 | -14.99 |
| Josh Allen | 19.56 | 9.64–30.43 | 30.50 | -10.94 |
| Jameson Williams | 10.32 | 1.92–19.73 | 18.70 | -8.38 |
| George Kittle | 12.57 | 3.34–24.26 | 7.40 | 5.17 |
| Wan'Dale Robinson | 10.44 | 3.16–19.53 | 11.30 | -0.86 |
| Tony Pollard | 10.72 | 3.02–19.75 | 5.20 | 5.52 |
| Michael Wilson | 14.36 | 4.20–26.16 | 7.28 | 7.08 |
| Kenny Gainwell | 5.63 | 0.01–13.67 | 5.80 | -0.17 |
| RJ Harvey | 11.85 | 2.62–22.22 | 0.70 | 11.15 |
| Adonai Mitchell | 9.72 | 2.36–20.15 | 0.00 | 9.72 |
| Eddy Pineiro | 8.15 | 2.84–14.17 | 6.00 | 2.15 |
| Tyjae Spears | 4.81 | 0.20–10.91 | 9.80 | -4.99 |
| Rashid Shaheed | 7.67 | 1.79–16.43 | 4.30 | 3.37 |
| Brian Robinson Jr. | 10.15 | 1.95–21.34 | 1.60 | 8.55 |
| Colts D/ST | 3.16 | -3.47–11.25 | -1.00 | 4.16 |

## Scoring-target audit

D/ST: 0 of 158 training-target totals disagree with ESPN actuals. Mean absolute target discrepancy: 0.00. Captured 2026 targets are independently rescored from ESPN stat counts. Historical 2015-2025 targets use the corrected NFLverse reconstruction and are not fully verified against ESPN components. Offense/kicker cross-check: 12 discrepancies across 1876 compared records.

## Interpretation and provenance

- 45-degree charts: x = actual, y = predicted. Vertical whiskers show the model’s 10th–90th percentiles. They represent game-to-game predictive uncertainty, not confidence intervals for model parameters.
- Training curves are in-sample and optimistic. The later-week replay is the appropriate accuracy check.
- Weekly MAE CIs bootstrap player rows within each week. Residual error whiskers show one standard deviation, not a CI.
- The player universe uses identities observed in this season. Historical pregame roster/role/inactive snapshots are absent; selection and participation bias remain.
- Missing outcomes, cold-start rookies, and inherited matchup-feature conventions limit conclusions.
- No production model was changed or promoted; no roster action was executed.

- **sourceSha256:** bbca0279dc333ebc43877d3dc4cf7433cb3d174fda8f04509f86227ef9474619
- **sourceGamesSha256:** f0bc596b5b5b3b4a8f746ea98b4e59ef6bb9c374e21a2a727226dd6afad07481
- **rosterReadAt:** 2026-10-14T22:12:11.061Z
- **archiveBuiltAt:** 2026-10-07T15:50:11.346047+00:00
- **rankDefinition:** Pregame model mean, all eligible observed-season identities; no outcome-based ranking
- **rankUniverse:** Current-season observed identities, not an archived pregame roster/inactive universe. Conditional participation models lack historical injury/role inputs. Missing actuals remain counted, never silently set to zero.
- **cutoffRule:** 2015–2025 plus 2026 weeks strictly before each target; features built only from that past dataset.
- **replayNote:** Reconstructed weekly forecasts, not forecasts issued at the time. Week 1 uses prior-season usage; zero-history rookies use position priors. Week 5 saved forecasts are evaluated separately.
- **modelStatus:** Isolated evaluation; production artifacts and approved model state unchanged
- **featureLimit:** Inherited matchup-feature conventions; replay is an audit of the weekly model family, not a reconstruction of historical betting lines, roles or injury decisions.
- **actualHistory:** ESPN player-card season history; all 80 current-roster player-week actuals available. Cohort missing coverage reported separately.
- **dstTargetRepair:** Recovered opponent fumbles credited; opponent fumble-loss penalty removed; recovered-fumble TDs and defensive-score exclusions corrected. Captured 2026 ESPN raw stats rescored; historical 2015-2025 component parity incomplete.
- **dstTargetSourceSha256:** c8b67b0fa901ebe7fa4660ed22a164399363aaa7d3cda57a17993a2bacab9ea8
- **modelCodeSha256:** ff9ae18088f1f42bbb3a5a1962c31f603b7dec56af11f0f40a3c3217282e2bd1

## Chronological interval-calibration candidate

No model has been promoted. Each week uses only earlier weeks to fit a non-shrinking conformal interval correction. Mean projections remain unchanged. Week 1 has no prior replay calibration outcomes.

| Cohort | Holdout | N | MAE before/after | Coverage before | Coverage after | Width before | Width after |
|---|---|---:|---:|---:|---:|---:|---:|
| Top 50 | rolling_W2_onward | 200 | 8.28 / 8.28 | 70.0% | 79.0% | 21.65 | 27.89 |
| Top 50 | final_week_holdout | 50 | 8.69 / 8.69 | 66.0% | 74.0% | 21.26 | 27.47 |
| Top 150 | rolling_W2_onward | 599 | 7.39 / 7.39 | 66.3% | 78.0% | 19.26 | 23.63 |
| Top 150 | final_week_holdout | 150 | 8.00 / 8.00 | 61.3% | 72.0% | 18.98 | 23.53 |

![[chronological-calibration.png]]

![[calibrated-top50-45-degree.png]]

Each target week uses only completed earlier replay weeks. Week 1 remains unchanged. Final completed week is never used to fit its own interval correction.

Five completed weeks; only four rolling calibration test weeks Dependent player-week samples and drift: finite-sample exchangeability guarantee does not apply Historical replay identity and availability limitations remain D/ST representation in ranked cohorts is too small to validate defense-specific calibration Promotion requires human request and PMT gates; this workflow never promotes

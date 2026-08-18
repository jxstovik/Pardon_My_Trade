# ChatPFT 2024 TE Preseason Replay

This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.

## Run

- Preseason cutoff: `2024-09-04T08:00:00-04:00`
- Training rows: `6325` real player-weeks from 2018-2023
- 2024 outcome rows: `1088` real player-weeks
- 2024 players with recorded outcomes: `119`
- Feature rows with prior-only construction: `7413`
- Rookie training rows: `1838`

## Sources

- `nflverse_player_stats`: **downloaded**, parsed rows `7413`;
- `razzball_te_preseason_rankings`: **downloaded**, parsed rows `85`; https://web.archive.org/web/20240812100655id_/https://football.razzball.com/2024-fantasy-football-tight-end-rankings/
- `razzball_te_preseason_projections`: **downloaded**, parsed rows `161`; https://web.archive.org/web/20240814033041id_/https://football.razzball.com/projections-te-restofseason/

## Model

- Version: `te-2024-preseason-hard-stats-ridge-v1`
- Features: `prior_points_per_game, prior_usage_per_game, prior_efficiency, prior_share, prior_team_pass_attempts, prior_team_rush_attempts, prior_usage_trend, prior_role_stability, prior_team_pass_trend, prior_games, prior_availability_rate, experience_seasons`
- Residual standard deviation: `5.206`

## Metrics

Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.

| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hard_stats | 119 | 75 | 36.138 | 51.732 | 10.831 | 0.549 | 0.500 | 0.664 |
| prior_baseline | 119 | 75 | 40.310 | 58.533 | 13.302 | 0.526 | 0.583 | 0.702 |
| razzball_rank | 108 | 75 | 26.812 | 39.122 | -10.336 | 0.618 | 0.500 | 0.779 |
| source_rank_blend | 0 | 75 | - | - | - | 0.594 | 0.500 | 0.774 |

## Takeaways

- The hard-stat model improved RMSE versus the historical baseline by `6.801` points.
- The hard-stat model's season bias was `10.831`; positive values indicate overprediction.
- Razzball rank Spearman correlation was `0.618` on `75` matched players.
- A separate rookie model was trained from `1838` prior-only rows; rookie uncertainty is widened, especially for QB.
- Ordinal Razzball ranks were not converted into fabricated point forecasts.
- The position-specific model should receive better availability, role, and team-context features before adding model complexity.

## Interpretation

The hard-stat TE model is trained only on information available before 2024. A missing archived projection is a source-availability result, not a zero projection.

## Limitations

- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.
- The first real feature table uses recorded player statistics and lagged team context; snap-count and route-level sources are future additions.
- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution.

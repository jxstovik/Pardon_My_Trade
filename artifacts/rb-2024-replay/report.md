# ChatPFT 2024 RB Preseason Replay

This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.

## Run

- Preseason cutoff: `2024-09-04T08:00:00-04:00`
- Training rows: `7987` real player-weeks from 2018-2023
- 2024 outcome rows: `1343` real player-weeks
- 2024 players with recorded outcomes: `135`
- Feature rows with prior-only construction: `9330`

## Sources

- `nflverse_player_stats`: **downloaded**, parsed rows `9330`;
- `razzball_rb_preseason_rankings`: **downloaded**, parsed rows `36`; https://web.archive.org/web/20240814031647id_/https://football.razzball.com/2024-fantasy-football-running-back-rankings/
- `razzball_rb_preseason_projections`: **downloaded**, parsed rows `178`; https://web.archive.org/web/20240814032147id_/https://football.razzball.com/projections-rb-restofseason/

## Model

- Version: `rb-2024-preseason-hard-stats-ridge-v1`
- Features: `prior_points_per_game, prior_usage_per_game, prior_efficiency, prior_share, prior_team_pass_attempts, prior_team_rush_attempts, prior_games, prior_availability_rate, experience_seasons`
- Residual standard deviation: `6.852`

## Metrics

Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.

| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hard_stats | 135 | 36 | 50.876 | 73.327 | 8.751 | 0.267 | 0.500 | 0.648 |
| prior_baseline | 135 | 36 | 54.144 | 80.145 | 13.856 | 0.281 | 0.417 | 0.597 |
| razzball_rank | 121 | 36 | 48.437 | 67.858 | -6.436 | 0.597 | 0.750 | 0.787 |
| source_rank_blend | 0 | 36 | - | - | - | 0.595 | 0.667 | 0.755 |

## Takeaways

- The hard-stat model improved RMSE versus the historical baseline by `6.818` points.
- The hard-stat model's season bias was `8.751`; positive values indicate overprediction.
- Razzball rank Spearman correlation was `0.597` on `36` matched players.
- Ordinal Razzball ranks were not converted into fabricated point forecasts.
- The position-specific model should receive better availability, role, and team-context features before adding model complexity.

## Interpretation

The hard-stat RB model is trained only on information available before 2024. A missing archived projection is a source-availability result, not a zero projection.

## Limitations

- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.
- The first real feature table uses recorded player statistics and lagged team context; snap-count and route-level sources are future additions.
- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution.

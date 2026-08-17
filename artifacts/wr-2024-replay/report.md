# ChatPFT 2024 WR Preseason Replay

This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.

## Run

- Preseason cutoff: `2024-09-04T08:00:00-04:00`
- Training rows: `12569` real player-weeks from 2018-2023
- 2024 outcome rows: `2132` real player-weeks
- 2024 players with recorded outcomes: `227`
- Feature rows with prior-only construction: `14701`
- Rookie training rows: `3904`

## Sources

- `nflverse_player_stats`: **downloaded**, parsed rows `14701`;
- `razzball_wr_preseason_rankings`: **downloaded**, parsed rows `60`; https://web.archive.org/web/20240814030914id_/https://football.razzball.com/2024-fantasy-football-wide-receiver-rankings/
- `razzball_wr_preseason_projections`: **unavailable**, parsed rows `0`; capture reports 2023 projection horizon, expected 2024

## Model

- Version: `wr-2024-preseason-hard-stats-ridge-v1`
- Features: `prior_points_per_game, prior_usage_per_game, prior_efficiency, prior_share, prior_team_pass_attempts, prior_team_rush_attempts, prior_usage_trend, prior_role_stability, prior_team_pass_trend, prior_games, prior_availability_rate, experience_seasons`
- Residual standard deviation: `6.777`

## Metrics

Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.

| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hard_stats | 227 | 58 | 51.369 | 70.806 | 7.340 | 0.104 | 0.333 | 0.743 |
| prior_baseline | 227 | 58 | 57.362 | 78.570 | 11.696 | 0.066 | 0.333 | 0.733 |
| razzball_rank | 0 | 58 | - | - | - | 0.443 | 0.583 | 0.854 |
| source_rank_blend | 0 | 58 | - | - | - | 0.312 | 0.500 | 0.834 |

## Takeaways

- The hard-stat model improved RMSE versus the historical baseline by `7.764` points.
- The hard-stat model's season bias was `7.340`; positive values indicate overprediction.
- Razzball rank Spearman correlation was `0.443` on `58` matched players.
- A separate rookie model was trained from `3904` prior-only rows; rookie uncertainty is widened, especially for QB.
- Ordinal Razzball ranks were not converted into fabricated point forecasts.
- The position-specific model should receive better availability, role, and team-context features before adding model complexity.

## Interpretation

The hard-stat WR model is trained only on information available before 2024. A missing archived projection is a source-availability result, not a zero projection.

## Limitations

- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.
- The first real feature table uses recorded player statistics and lagged team context; snap-count and route-level sources are future additions.
- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution.

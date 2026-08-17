# ChatPFT 2024 QB Preseason Replay

This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.

## Run

- Preseason cutoff: `2024-09-04T08:00:00-04:00`
- Training rows: `3799` real player-weeks from 2018-2023
- 2024 outcome rows: `664` real player-weeks
- 2024 players with recorded outcomes: `78`
- Feature rows with prior-only construction: `4463`

## Sources

- `nflverse_player_stats`: **downloaded**, parsed rows `4463`;
- `razzball_qb_preseason_rankings`: **downloaded**, parsed rows `50`; https://web.archive.org/web/20240714130437id_/https://football.razzball.com/2024-fantasy-football-quarterback-rankings
- `razzball_qb_preseason_projections`: **downloaded**, parsed rows `0`; https://web.archive.org/web/20240814033327id_/https://football.razzball.com/projections-qb-restofseason/

## Model

- Version: `qb-2024-preseason-hard-stats-ridge-v1`
- Features: `prior_points_per_game, prior_usage_per_game, prior_efficiency, prior_share, prior_team_pass_attempts, prior_team_rush_attempts, prior_games, prior_availability_rate, experience_seasons`
- Residual standard deviation: `7.934`

## Metrics

Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.

| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hard_stats | 78 | 45 | 90.731 | 115.538 | 34.935 | 0.354 | 0.417 | 0.769 |
| prior_baseline | 78 | 45 | 95.311 | 122.891 | 39.810 | 0.279 | 0.333 | 0.785 |
| razzball_rank | 0 | 45 | - | - | - | 0.713 | 0.500 | 0.815 |
| source_rank_blend | 0 | 45 | - | - | - | 0.531 | 0.500 | 0.829 |

## Takeaways

- The hard-stat model improved RMSE versus the historical baseline by `7.354` points.
- The hard-stat model's season bias was `34.935`; positive values indicate overprediction.
- Razzball rank Spearman correlation was `0.713` on `45` matched players.
- Ordinal Razzball ranks were not converted into fabricated point forecasts.
- The position-specific model should receive better availability, role, and team-context features before adding model complexity.

## Interpretation

The hard-stat QB model is trained only on information available before 2024. A missing archived projection is a source-availability result, not a zero projection.

## Limitations

- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.
- The first real feature table uses recorded player statistics and lagged team context; snap-count and route-level sources are future additions.
- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution.

# ChatPFT 2024 WR Preseason Replay

This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.

## Run

- Preseason cutoff: `2024-09-04T08:00:00-04:00`
- Training rows: `12569` real player-weeks from 2018-2023
- 2024 outcome rows: `2132` real player-weeks
- 2024 players with recorded outcomes: `227`
- Feature rows with prior-only construction: `14701`

## Sources

- `nflverse_player_stats`: **downloaded**, parsed rows `14701`;
- `razzball_preseason_rankings`: **downloaded**, parsed rows `60`; https://web.archive.org/web/20240814030914id_/https://football.razzball.com/2024-fantasy-football-wide-receiver-rankings/
- `razzball_preseason_projections`: **unavailable**, parsed rows `0`; capture reports 2023 projection horizon, expected 2024

## Model

- Version: `wr-2024-preseason-hard-stats-ridge-v1`
- Features: `prior_points_per_game, prior_targets_per_game, prior_receiving_yards_per_game, prior_target_share, prior_team_pass_attempts, prior_games, prior_availability_rate, experience_seasons`
- Residual standard deviation: `6.779`

## Metrics

Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.

| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hard_stats | 227 | 58 | 51.432 | 70.791 | 7.284 | 0.123 | 0.333 | 0.728 |
| prior_baseline | 227 | 58 | 57.362 | 78.570 | 11.696 | 0.066 | 0.333 | 0.733 |
| razzball_rank | 0 | 58 | - | - | - | 0.443 | 0.583 | 0.854 |
| source_rank_blend | 0 | 58 | - | - | - | 0.319 | 0.500 | 0.834 |

## Interpretation

The hard-stat model is trained only on information available before 2024. Razzball ordinal rankings are evaluated as rankings, not converted into fabricated point predictions. A missing archived projection is a source-availability result, not a zero projection.

## Limitations

- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.
- The first real feature table uses player_stats opportunity fields and team quarterback attempts; snap-count and route-level sources are future additions.
- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution.

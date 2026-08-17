# ChatPFT WR Phases 0-4 Completion Record

Status: implemented on the WR replay branch.

## Phase 0: Research Specification

Completed:

- Locked the 2024 preseason cutoff and historical training window.
- Defined the no-lookahead rule and source timestamp requirements.
- Separated 2024 evaluation labels from causal preseason features.
- Defined point, rank, source-availability, and player-matching metrics.
- Defined artifact and SQLite persistence contracts.

Primary specification: `docs/CHATPFT-WR-REPLAY-SPEC.md`.

## Phase 1: Real Historical Data Spine

Completed:

- Downloads or reuses the real nflverse `player_stats` release.
- Loads regular-season WR rows for 2018-2024.
- Preserves recorded targets, receptions, yards, touchdowns, rushing output,
  team, player identity, and PPR points.
- Aggregates team quarterback attempts into prior team pass-volume features.
- Writes a real-data feature file and source manifest.

No synthetic player rows are used. Rows absent from the source remain absent
from the training table rather than being fabricated as zero-production games.

## Phase 2: Time-Locked Source Snapshots and Features

Completed:

- Queries the Internet Archive for a capture at or before the preseason cutoff.
- Downloads and hashes the selected Razzball 2024 WR ranking page.
- Attempts the Razzball WR point-projection page and records unavailable status
  if an appropriate capture cannot be found or parsed.
- Parses ordinal ranks and point projections when present.
- Matches source rows to nflverse players by normalized name and team, with
  explicit unmatched and ambiguous counts.
- Constructs prior-only rolling player and team features.

The implementation does not use the current Razzball page as a substitute for
a historical page. ESPN, FFToday, weekly Razzball, and timestamped news are
reserved for phase 5 source expansion because historical captures are not
guaranteed for every 2024 checkpoint.

## Phase 3: 2024 Preseason WR Model

Completed:

- Fits a regularized hard-stat ridge model on 2018-2023 real nflverse rows.
- Uses prior points, targets, yards, target share, team pass attempts,
  observed games, availability rate, and experience.
- Produces weekly PPR mean, standard deviation, P10, P50, and P90 estimates.
- Converts player-week estimates to preseason season estimates using prior
  expected games.
- Produces a recent-history baseline for comparison.
- Produces a source-rank blend without treating Razzball rank as an outcome.

The model version, feature list, training cutoff, coefficients, residual spread,
and source provenance are persisted in the artifact database.

## Phase 4: Source Benchmark

Completed:

- Compares hard-stat and baseline season estimates with final 2024 PPR totals.
- Compares Razzball preseason rank with final 2024 rank and top-player hits.
- Compares hard-stat, baseline, and source-adjusted ranking order.
- Reports rank correlation, NDCG, hit rates, MAE, RMSE, bias, and sample counts.
- Writes a markdown report, JSON metrics, SQLite data, and an SVG benchmark.

Point-source results are conditional on a valid historical point table. Ordinal
Razzball rankings are never converted into invented point projections.

## Known Limitations

- The first source implementation is Razzball archive-first; weekly ESPN and
  FFToday captures remain unavailable and are reported as source gaps.
- `player_stats` provides player outcomes and derived opportunity fields, but
  the first feature table does not yet include snap-count or route-level data.
- Season estimates are a transparent weekly-rate times expected-games model;
  they are not yet a full hierarchical availability model.
- The archive may not contain a capture for every desired historical source
  date. Availability is reported rather than imputed.

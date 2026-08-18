# ChatPFT WR 2024 Replay Specification

Status: phases 0-4 implemented by `python/chatpft_modeling/replay_wr_2024.py`.

## Purpose

This study reconstructs the information available to a fantasy manager before
and during the 2024 NFL season. It trains a wide receiver model from recorded
NFL outcomes, compares it with external rankings and projections, and keeps
every input tied to an as-of cutoff.

The replay is causal. A 2024 preseason prediction cannot use 2024 game
outcomes. The preseason model is trained on prior seasons and evaluated on
2024. 2024 outcomes become training data only for later weekly checkpoints or
for a separate 2025 preseason model.

## Cutoffs

- Preseason cutoff: `2024-09-04T08:00:00-04:00`.
- Evaluation season: `2024` regular season, weeks 1-18.
- Historical training window: 2018-2023 regular seasons when available.
- Primary scoring: PPR fantasy points supplied by nflverse.
- Missing source data is recorded as unavailable; it is never replaced with a
  current-season page or synthetic values.

The initial implementation evaluates the preseason checkpoint. Later phases
will materialize the weekly checkpoints using the same contract.

## Data Rules

Every source record carries:

- source name and source URL
- original publication or capture time when available
- retrieval time
- as-of cutoff used by the model
- raw-content SHA-256 hash
- parser version
- player identity and matching status

Features for a player-week may use only records whose effective time is before
that prediction cutoff. The current week's statistics are never used to predict
that week's result.

## Real Sources

- NFL outcomes: [nflverse data](https://github.com/nflverse/nflverse-data),
  specifically the `player_stats` release.
- Razzball preseason rankings: the 2024 WR ranking page, retrieved through
  an Internet Archive capture selected before the cutoff.
- Razzball preseason point projections: the Razzball WR projection page, also
  selected from a capture before the cutoff when one exists.
- Future weekly source adapters: Razzball weekly PPR rankings, ESPN weekly
  projections, FFToday weekly projections, and timestamped official/team news.

The live Razzball page is not valid historical evidence for this replay. The
implementation therefore uses the archive-first policy and reports source
availability in `manifest.json`.

## Player-Week Schema

The real-data feature table contains:

- `player_id`, `player_name`, `team`, `position`
- `season`, `week`, `scoring_period`
- recorded `targets`, `receptions`, `receiving_yards`, `receiving_tds`
- recorded `carries`, `rushing_yards`, `rushing_tds`
- recorded PPR fantasy points
- prior targets, prior yards, prior points, prior target share
- prior team pass attempts
- prior games observed and prior availability rate
- experience in seasons
- source rank when a pre-cutoff Razzball row matches

Prior features are rolling historical summaries. They are created before the
current row is appended to the player's history.

## Models

Phase 3 produces three separate preseason views:

- `hard_stats_ridge`: a regularized model using only historical NFL features.
- `prior_points_baseline`: recent historical production without fitted feature
  weights.
- `source_rank_blend`: hard-stat rank adjusted toward a matched Razzball rank;
  it is a ranking blend, not a claim that Razzball is the outcome truth.

The hard-stat model predicts weekly PPR points. A preseason season estimate is
the weekly estimate multiplied by an expected-games estimate from prior
availability. Uncertainty combines fitted residual error with a conservative
model-spread term.

## Evaluation

Point predictions are evaluated against 2024 final PPR totals with MAE, RMSE,
bias, and sample count. Ranking views are evaluated with Spearman correlation,
top-12/top-24/top-36 hit rate, and NDCG at 12/24/36.

Razzball point metrics are reported only when a historical point-projection
table was captured and successfully matched. Razzball ranking metrics remain
valid when only ordinal rankings are available.

The report must state:

- how many source rows were captured
- how many players matched nflverse IDs
- how many rows were excluded
- which sources were unavailable
- whether a metric uses a point projection or ordinal rank

## Artifacts

The real replay writes to `artifacts/wr-2024-replay/`:

- `manifest.json`: source hashes, capture metadata, cutoff, and row counts
- `features.jsonl`: causal real-data feature rows
- `preseason_predictions.json`: model and benchmark predictions
- `metrics.json`: point and rank benchmark metrics
- `report.md`: human-readable results and limitations
- `wr-metamodel.sqlite`: queryable rows, predictions, metrics, and metadata
- `rank-benchmark.svg`: compact benchmark visualization

Raw downloads and archived HTML remain under the ignored `data/` directory.

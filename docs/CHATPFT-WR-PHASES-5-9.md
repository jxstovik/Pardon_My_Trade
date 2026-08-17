# ChatPFT WR Phases 5-9 Integration Specification

Status: implemented in staged form on the WR replay branch. Provider gaps and
runtime promotion limitations remain explicit below.

## Phase 5: 2024 Walk-Forward Replay

Implemented by `python/chatpft_modeling/walkforward_wr_2024.py` and the
`npm run model:wr:walkforward` command.

Create one immutable checkpoint after each 2024 regular-season week.

Each checkpoint will:

- freeze the cutoff before the next game week
- add only completed nflverse outcomes
- add archived or captured Razzball, ESPN, FFToday, and news records available
  before that cutoff
- rebuild prior-only features
- retrain an expanding-window model and update an online model
- emit weekly and rest-of-season predictions
- retain the previous checkpoint for player-level diff views

Acceptance criteria:

- no feature has an effective time after its cutoff
- every checkpoint is reproducible from raw snapshots
- missing external snapshots are visible in the report

The run writes 19 checkpoint records, weekly outcomes and predictions, three
model regimes, immutable source IDs, and a separate
`walkforward-manifest.json` so the preseason artifact is not overwritten.

## Phase 6: News and Source Attribution

The checkpoint pipeline now persists source availability, source IDs, and
stage-attribution rows. Structured news events can be supplied through
`PMT_WR_NEWS_EVENTS_PATH` or `data/chatpft-wr-replay/news-events.jsonl`.
No news events are synthesized when that file is absent.

Add official/team injury reports, ESPN news, and other licensed sources through
structured event extraction. Store the evidence and event time. Model changes
will be decomposed into hard-stat, source, news, team-context, and retraining
effects.

Acceptance criteria:

- no untraceable sentiment feature enters the model
- every news adjustment links to a source record
- late-published articles are excluded from earlier checkpoints

## Phase 7: Progression Workbench

Implemented for the replay artifact through:

- `GET /api/modeling/replay`
- `GET /api/modeling/checkpoints`
- `GET /api/modeling/metrics`
- `GET /api/modeling/predictions`
- allowlisted `/api/modeling/artifact/<name>` downloads
- the real-data `/modeling` dashboard

Extend the existing modeling page with WR replay views:

- preseason training and validation progression
- weekly model checkpoint timeline
- player rank and projection trajectories
- source/model disagreement
- P10/P50/P90 uncertainty bands
- actual outcomes after they become available
- top risers, fallers, misses, and source wins

Acceptance criteria:

- every chart identifies model version and cutoff
- raw prediction rows are downloadable
- current-season data cannot overwrite historical replay artifacts

## Phase 8: Calibration and Promotion Gates

Implemented in the TypeScript benchmark helpers under `src/projections`, and
in the replay artifact through weekly pinball loss, P10-P90 coverage, cluster
bootstrap metadata, subgroup slices, regime comparisons, and
`promotion-decision.json`.

Add rolling calibration, pinball loss, interval coverage, CRPS/log-score where
supported, bootstrap confidence intervals, and subgroup evaluation.

Promotion gates should require:

- no regression against the frozen preseason baseline without explanation
- acceptable P10-P90 coverage
- stable performance across top-12, top-24, and flex groups
- documented behavior for injuries, rookies, and team changes

## Phase 9: Runtime Integration

Implemented as an explicit opt-in integration. `loadApprovedWrArtifact()`
rejects artifacts without a passing promotion decision. Set
`PMT_WR_ARTIFACT_DIR` during a matching-season refresh to add approved WR
artifact projections with model-version and cutoff provenance. The artifact is
never trained or promoted during an API request.

Integrate approved WR distributions into `season-refresh.ts`, recommendation
generation, and draft valuation only after replay validation.

Integration requirements:

- persist model version, cutoff, source provenance, and fallback reason
- keep recommendations advisory and human-reviewable
- retain source-degraded behavior when external providers fail
- use league-scoped persistence for projections
- expose model metrics without silently replacing the active model

The runtime should consume an approved artifact manifest, not retrain during a
request. Training and promotion remain explicit operations.

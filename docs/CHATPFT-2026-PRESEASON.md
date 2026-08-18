# ChatPFT 2026 Preseason Artifacts

The 2026 preseason runner uses recorded nflverse outcomes through the 2025
regular season and current Razzball rankings/projections retrieved at run
time. It does not use 2026 outcomes and does not treat Razzball as a training
label.

Artifacts are written separately for QB, RB, WR, and TE:

```text
artifacts/qb-2026-preseason/
artifacts/rb-2026-preseason/
artifacts/wr-2026-preseason/
artifacts/te-2026-preseason/
```

Each directory includes:

- `manifest.json` with source hashes, retrieval timestamps, position, cutoff,
  and matching counts
- `model.json` with the standardized feature coefficients and model version
- `predictions.json` with model points, P10/P50/P90, model rank, current
  Razzball points/rank, and rank deltas
- `weekly-predictions.jsonl` with dashboard-compatible `2026-ROS` rows
- `report.md` with the current Razzball comparison and takeaways
- `<position>-preseason.sqlite` with queryable predictions and metadata

The updated practice layer trains a separate rookie model, widens rookie
uncertainty, and records lagged usage/role/team-trend features. Real draft
capital, college production, and expected-role context is optional through
`data/chatpft-position-context.json`; the generated manifests report when it
is unavailable. Rookie rows with matched Razzball point projections receive a
documented external-prior contribution rather than an undocumented blend.

Run individual positions with:

```bash
npm run model:2026:qb
npm run model:2026:rb
npm run model:2026:wr
npm run model:2026:te
```

The modeling dashboard supports `season=2026` and `position=QB|RB|WR|TE`
query parameters and defaults to the current 2026 view. Current Razzball
projection pages may have different coverage by position; unmatched rows and
zero-source denominators are retained in each manifest rather than silently
filled.

These are preseason candidates, not promoted runtime models. There are no
2026 outcomes yet, so promotion remains false until a future walk-forward
evaluation is available.

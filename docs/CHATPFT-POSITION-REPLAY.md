# ChatPFT 2024 Position Replay

The real-data replay now runs the same causal workflow for QB, RB, WR, and TE.
Each position has an independent artifact directory:

```text
artifacts/qb-2024-replay/
artifacts/rb-2024-replay/
artifacts/wr-2024-replay/
artifacts/te-2024-replay/
```

## Shared Workflow

- Train on real nflverse regular-season player statistics from 2018-2023.
- Evaluate against 2024 regular-season outcomes.
- Use the same preseason cutoff and 19 checkpoint structure.
- Compare frozen preseason, frozen-weight adaptive-feature, and adaptive-
  expanding regimes.
- Use archive-first Razzball rankings and projections.
- Preserve unavailable sources as unavailable rather than imputing values.
- Persist source hashes, matching counts, model coefficients, weekly metrics,
  subgroup metrics, attribution, and promotion decisions.

## Position Features

QB uses prior points, passing usage, passing efficiency, pass share, team pass
volume, team rush volume, availability, and experience.

RB uses prior points, combined carry/target usage, rushing efficiency, workload
share, team pass volume, team rush volume, availability, and experience.

WR and TE use prior points, target usage, receiving efficiency, target share,
team pass volume, team rush volume, availability, and experience.

The features are position-aware but intentionally conservative. Snap counts,
routes, injury panels, depth charts, and time-stamped news remain future data
extensions because they are not present in the base nflverse `player_stats`
release used by this replay.

## Updated Modeling Practices

- Rookie rows use a separate ridge fit when enough historical rookie rows exist.
- Rookie uncertainty is widened, with an additional QB-specific multiplier.
- Lagged usage trend, role stability, and team pass-volume trend are included.
- Real draft capital, college production, and expected-role records can be
  supplied through `data/chatpft-position-context.json`; missing context is
  explicitly reported and never synthesized.
- Matched Razzball point projections can contribute a documented external prior
  for rookie preseason rows, while rank comparisons remain separate from point
  outcomes.
- Reports retain player-week and unique-player subgroup denominators.

## Commands

Preseason and walk-forward runs are available per position:

```bash
npm run model:qb:replay
npm run model:qb:walkforward
npm run model:rb:replay
npm run model:rb:walkforward
npm run model:wr:replay
npm run model:wr:walkforward
npm run model:te:replay
npm run model:te:walkforward
```

Each `report.md` contains preseason point/rank metrics and generated
takeaways. Each `phase8-report.md` contains weekly regime metrics, interval
coverage, bootstrap promotion evidence, and limitations.

## Comparability

Razzball rank metrics use only the matched source universe for that position.
Razzball point metrics are reported only when a valid historical point table is
available. A source with no valid historical capture is not treated as a poor
forecast; it is reported as a missing comparison denominator.

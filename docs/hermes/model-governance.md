# Weekly Model Governance

`PostWeekOutcomeUpdateService` is the deterministic post-week boundary for the
online Bayesian player models. It is exposed through
`mcp_pmt_read_pmt_update_post_week_outcomes` and can also be called directly by
application code.

## Contract

Submit one completed weekly batch with:

- `season`, `week`, and a `causalCutoff` timestamp
- observations whose `scoringPeriod` is exactly that season's weekly period
  (`2026-W01`, with `W1` accepted as input and normalized to `W01`)
- an `observedAt` timestamp for every outcome
- optional source forecasts on each observation, using the same player and
  weekly period

An outcome published after `causalCutoff` is rejected. Season totals, rest-of-
season labels, and other non-weekly scoring periods are rejected. A player can
occur only once in a batch, and an existing model cannot be advanced twice for
the same or an earlier week.

The service evaluates forecasts using the pre-update model mean, then applies
the existing `updateModel` recurrence and persists the changed `PlayerModel`s
through `ModelStore`. This ordering prevents the arriving outcome from being
scored as its own forecast. The model's `lastUpdatedScoringPeriod` is retained
in addition to the legacy numeric week field so season and weekly state do not
collapse into one identifier.

## Promotion Artifacts

The result always contains source/model `PredictionPerformance` metrics and a
versioned promotion decision. Supplying `artifactDir` additionally writes:

- `manifest.json` (`model-governance-v1`)
- `promotion-decision.json` (`promotion-decision-v1`)
- `rollback-models.json`, containing the prior model store snapshot

The MCP integration writes these files under
`data/model-governance/<season>-W<week>/` so each completed week has an
independent manifest and rollback reference.

The manifest records the causal cutoff, weekly period, model version, source
metrics, decision status, and hashes of the previous and updated model stores.
The default gate passes when the candidate has at least one sample and does not
regress against the best available non-candidate source. A configured baseline,
sample threshold, and MAE/RMSE tolerances can make the result `hold` or `fail`.
`approved` is true only for `pass`.

Rollback is metadata plus a persisted prior snapshot, not an automatic model
restore. An operator can restore `rollback-models.json` through the model-store
operation of their choice after reviewing the decision.

## Example

```ts
const service = new PostWeekOutcomeUpdateService(modelStore, {
  artifactDir: "data/model-governance/2026-W01"
});

const result = await service.update({
  season: "2026",
  week: 1,
  causalCutoff: "2026-09-15T12:00:00Z",
  observations: [{
    playerId: "player-001",
    scoringPeriod: "2026-W01",
    week: 1,
    points: 18.4,
    observedAt: "2026-09-15T10:00:00Z",
    predictions: [{ source: "espn", predicted: 16.2 }]
  }]
});
```

The service does not fetch outcomes, infer timestamps, retrain a model, or
automatically activate a failed/held candidate. The MCP tool can read the
configured `PMT_HISTORICAL_DATA_PATH` when observations are omitted. Rollback
remains an operator action using the persisted snapshot; model and artifact
writes are not one transaction.

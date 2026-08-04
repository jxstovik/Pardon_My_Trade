# DraftKat — ESPN Agentic Workflow (feature/DraftKat)

Implements the *Open Claw Agent Fantasy* plan: an autonomous ESPN fantasy
football general manager with a probabilistic brain and a human-approval gate
for high-risk moves.

## Capabilities (plan §2)

| Capability | Status | Location |
|------------|--------|----------|
| ESPN read adapter | implemented | `src/adapters/espn/espn-platform-reader.ts` |
| ESPN write actions (set roster / add-drop / trade) | implemented (request-built, needs live creds) | `src/adapters/espn/espn-platform-reader.ts` |
| Probabilistic player models (Bayesian, plan §5) | implemented + tested | `src/probabilistic/` |
| Lineup optimizer | implemented + tested | `src/agents/skills/lineup-optimizer.ts` |
| Waiver scanner | implemented + tested | `src/agents/skills/waiver-scanner.ts` |
| Trade proposer (+EV) | implemented + tested | `src/agents/skills/trade-proposer.ts` |
| FF_Orchestrator + execute-or-queue | implemented + tested | `src/agents/ff-orchestrator.ts` |
| Human-approval action queue | implemented + tested | `src/agents/action-queue.ts` |

## Architecture

```
CLI (pmt ff-run / import-espn / action-*)
 └─ FF_Orchestrator
      ├─ buildProbModels   -> src/probabilistic (Bayesian EWMA, P(x>τ))
      ├─ evaluateLineup    -> src/agents/skills/lineup-optimizer
      ├─ waiverScan        -> src/agents/skills/waiver-scanner
      ├─ tradeProposer     -> src/agents/skills/trade-proposer
      └─ executeOrQueue    -> low-risk auto / high-risk -> ActionQueue
                                     │
                                     └─ human approves (Discord/calendar, plan §1/§8)
```

## Probabilistic model (plan §5)

Per player `i`, week `w`:

```
mu_w     = alpha * historyMean + (1 - alpha) * level_{w-1}
sigma^2_w = beta * historyVar   + (1 - beta) * sigma^2_{w-1}
```

`level_{w-1}` is the previous week's realized points (history mean before any
observation). Outputs: `P(x > τ)` for `τ ∈ {8, 12, 18}` and
`value = E[pts] × positionScarcity`. See `src/probabilistic/bayesian-model.ts`
and `src/probabilistic/model-engine.ts`.

## Safety (plan §8)

- Trades and drops are **queued** for human approval with a TTL; expired
  actions auto-cancel (`ActionQueue.expireOverdue`).
- Set-roster is low-risk and executes automatically only when `--auto` is set.
- Cookies (`ESPN_S2`, `SWID`) come from the environment, never committed.

## Usage

```text
npm run pmt -- build-models <priors.json> [observations.json]
npm run pmt -- ff-run <config.json> [--auto]
npm run pmt -- action-queue
npm run pmt -- action-approve <actionId>
npm run pmt -- action-reject <actionId>
npm run pmt -- import-espn <espnLeagueId> [season]
```

A runnable example lives at `examples/draftkat-config.json`. Unit tests cover
the model engine, ESPN adapter mapping/write-requests, the orchestrator, and the
action queue.

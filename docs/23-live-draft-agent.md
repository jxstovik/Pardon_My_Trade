# 23 — Live Fantasy Draft Agent (DraftKat)

Document ID: FDP-DRAFT-001  
Status: Plan  
Milestone: DraftKat

Implementation plan for a live, recommendation-only draft agent, built by
combining the top-5 sources shortlisted in `docs/22-fantasy-tooling-landscape.md`.
Written to be picked up phase-by-phase in the same style as
`docs/21-inseason-workflow.md`.

## Goal

During a live draft, on every pick, answer three questions with evidence:

1. **Who** is the best available pick for my roster right now?
2. **Can I wait?** — is the tier deep enough that this player (or an equivalent)
   survives to my next pick?
3. **What am I giving up?** — the runner-up, and the positional cost.

Snake and auction. Never auto-pick: the agent produces a `Recommendation` and,
where an action is modelled, queues it behind `pmt action-approve`. The human
drafts.

## Why the combination, not any single source

No one shortlisted source can answer the three questions. Each supplies one
missing input, and the value is in the join:

| Source | Supplies | Answers |
|--------|----------|---------|
| 22b DynastyProcess `db_playerids.csv` | canonical player identity | the join key that makes every other source combinable |
| 22a ESPN `kona_player_info` | draft ranks, `auctionValue`, `averageDraftPosition` | market baseline + auction dollars, from credentials we already hold |
| DraftKat projections (Razzball/FFToday/ESPN) + `src/probabilistic` | `mu`/`sigma` per player | **who** — VORP with uncertainty, not just a rank |
| 22e fftiers method (GMM over ECR) | tier membership | **can I wait** — tier depth and the cliff |
| 22d ADP snapshot (ESPN ADP as compliant fallback) | market timing + `stdev` | **can I wait** — survival probability to the next pick |
| 22c FantasyCalc values/tiers | independent value + trend | cross-check; keeps a single-source error from driving a pick |

The composite is the product, not any one feed.

## Branch prerequisite (read first)

This branch (`feature/DraftKat`) does **not** contain the season-workflow work
that lives on `feature/season-workflow`:

- `src/seasons/nfl-calendar.ts` (season/week resolution)
- `src/season-refresh.ts` + projection persistence
  (`upsertProjections`/`getProjections` on `KnowledgeRepository`)
- `optional`/`lastSkipReason` tolerant projection sources and the `--force`
  cache bypass
- `ScheduledJob.days` and the season job runner

The draft agent depends on projection persistence (Phase 3 valuation) and the
`--force`/tolerant-source behaviour (Phase 5 live resilience).

- [ ] **Decision required:** merge `feature/season-workflow` into
  `feature/DraftKat` before Phase 3, or cherry-pick the projection-persistence
  and tolerant-source commits. Do not re-implement them here.

## Architecture

New module `src/draft/`, sitting beside `src/agents/` and reusing its patterns:

```text
src/draft/
  identity/player-id-map.ts        # 22b crosswalk load + resolve
  sources/kona-draft-source.ts     # 22a ESPN draft ranks/auction/ADP
  sources/fantasycalc-source.ts    # 22c values/tiers/trends
  sources/adp-snapshot.ts          # 22d offline import (+ ESPN ADP fallback)
  board.ts                         # merged, persisted draft board
  valuation/vorp.ts                # replacement level + VORP from mu/sigma
  valuation/tiering.ts             # 22e GMM/EM over ECR (hand-rolled, 1-D)
  valuation/survival.ts            # P(player survives to my next pick)
  state.ts                         # DraftState reducer (picks, roster, budget)
  feed/manual-feed.ts              # `pmt draft-pick` operator entry
  feed/espn-poll-feed.ts           # optional live poll (see Phase 4 risk)
  skills/pick-advisor.ts           # snake recommendation
  skills/auction-advisor.ts        # max-bid recommendation
  draft-orchestrator.ts            # the agent loop
```

Reuse, do not fork:

- `RecommendationCache` (`src/projections/recommendation-cache.ts`) for every
  external fetch, plus a pre-draft warm cache.
- `PlayerModel` (`mu`, `sigma`) from `src/probabilistic/` — VORP is computed on
  `mu`, and `sigma` drives the risk band, so tiers and floor/ceiling stay
  consistent with the in-season model.
- `ActionQueue` + `classifyRisk` (`src/agents/action-queue.ts`) for anything
  action-shaped.
- `Recommendation` (`src/models/types.ts`) as the output contract — every piece
  of draft advice carries `reasoning`, `evidence`, `confidence`, `risk`,
  `expected_benefit`, `assumptions`, `alternatives`, so it validates through
  `assertRecommendation` and renders in the existing GUI.
- `KnowledgeRepository` for all new tables.

### Known adapter constraint (verified)

`EspnPlatformClient.leagueBase()` hardcodes
`.../seasons/{season}/segments/1/leagues/{leagueId}` and `getJson()` builds
every URL from it. The kona draft board needs
`.../segments/0/leaguedefaults/3` (and `X-Fantasy-Filter` on a **GET** for
pagination, which the client currently only sets on `postJson`). Phase 2 must
widen the client rather than spawn a second ESPN HTTP path.

### New recommendation type

`RecommendationType` in `src/models/types.ts` has no draft member. Add
`"draft_pick"` (and reuse it for auction advice) so draft output is a
first-class recommendation rather than an `alert`.

## The pick rule (what the agent actually computes)

For each available player `p`, at my pick `n` with next pick `n'`:

```text
VORP(p)      = mu(p) − mu(replacement(position(p), leagueSize, starters))
Value(p)     = w1·norm(VORP) + w2·norm(FantasyCalcValue) + w3·norm(−konaRank)
Need(p)      = positional-need multiplier from DraftState roster gaps
Survive(p)   = P(ADP(p) > n')  using ADP + stdev (normal approx)
TierCliff(q) = players left in p's tier at position q
Score(p)     = Value(p) · Need(p) · (1 − Survive(p) · waitDiscount)
```

Recommend `argmax Score`; report the runner-up as `alternatives`; report
`TierCliff` and `Survive` as the "can I wait" evidence. Weights `w1..w3` and
`waitDiscount` are config, defaulted and logged in `assumptions`.

Auction variant: `maxBid(p) = auctionValue(p) · inflation · Need(p)`, where
`inflation = remainingLeagueBudget / remainingLeagueValue`, clamped by my own
remaining budget and open roster slots.

## Phase 1 — Identity spine (22b)

Nothing else joins without this.

- [ ] `src/draft/identity/player-id-map.ts`: load `db_playerids.csv`, expose
  `resolve({espnId?, name, team, position}) → canonicalId`.
- [ ] `player_id_map` table + accessors on `KnowledgeRepository` (SQLite and
  in-memory implementations, matching the existing dual-implementation rule).
- [ ] Header-driven CSV parse — fail loudly on a missing expected column
  (columns are `unverified` per doc 22b).
- [ ] Name-normalisation fallback reusing `src/projections/projection-matching.ts`
  for players absent from the crosswalk; count and report unmatched.
- [ ] `pmt draft-ids-sync [--force]`.
- [ ] Fixture `tests/fixtures/dp-playerids.sample.csv` + parser/resolver tests.

## Phase 2 — Static draft board (22a + 22c)

- [ ] Widen `EspnPlatformClient` with an explicit-path `getJsonAbsolute(path, {view, filter})`
  supporting `segments/0/leaguedefaults/3` and a GET `X-Fantasy-Filter`.
- [ ] `KonaDraftSource`: paginate via `x-fantasy-filter` `{players:{limit,offset}}`;
  parse `draftRanksByRankType` (PPR/STANDARD/SUPERFLEX/ELIMINATION),
  `auctionValue`, `averageDraftPosition`, `ownership.percentOwned`. Parse
  defensively — the inner rank property name is `unverified`.
- [ ] `FantasyCalcSource`: `values/current` with `isDynasty`/`numQbs`/`numTeams`/`ppr`.
- [ ] `draft_board` table (canonicalId, format, rank, auction_value, adp,
  value, tier_external, as_of) + merge through the Phase 1 crosswalk.
- [ ] Both sources go through `RecommendationCache`; long TTL, `--force` bypass.
- [ ] `pmt draft-board [--format ppr] [--force]` prints the merged board.
- [ ] Fixtures `kona-player-info.sample.json`, `fantasycalc-values.sample.json`
  + fake-`fetch` tests.

## Phase 3 — Valuation (projections + 22e + 22d)

- [ ] `valuation/vorp.ts`: replacement level from league size × starter counts
  (`league.roster_settings.slots`), VORP over `PlayerModel.mu`.
- [ ] `valuation/tiering.ts`: hand-rolled 1-D GMM/EM over ECR
  (`db_fpecr.csv.gz`), `PMT_TIERING_METHOD=gmm|kmeans|jenks`, `PMT_TIERING_K`.
  No new dependency (see doc 22e).
- [ ] `valuation/survival.ts`: `P(ADP > nextPick)` from ADP + `stdev`, reusing
  `normalCdf` in `src/probabilistic/normal.ts`.
- [ ] ADP source resolution order: imported 22d snapshot if present, else ESPN
  `averageDraftPosition` from Phase 2. **No live call to
  `fantasyfootballcalculator.com/api/`** — see doc 22d.
- [ ] `pmt draft-adp-import <file>` (offline only) and `pmt draft-tier`.
- [ ] `player_tiers` + `draft_values` tables.
- [ ] Composite `Score(p)` with configurable weights; unit-tested on fixtures.

## Phase 4 — Live draft state

- [ ] `state.ts`: `DraftState` = picks made, my roster by slot, remaining
  budget, pick clock, next pick number; pure reducer `applyPick(state, pick)`.
- [ ] Snake pick-number maths (round, direction, my next pick) from league size
  and draft position.
- [ ] `feed/manual-feed.ts`: `pmt draft-pick <player> [--team <id>]` — the
  always-works operator path.
- [ ] `feed/espn-poll-feed.ts`: poll the ESPN draft-detail view.
  **The live pick feed is unverified** — spike it first; if it does not hold,
  manual feed is the shipped path and polling stays behind
  `PMT_DRAFT_FEED=espn|manual`.
- [ ] Second-granularity poller (draft clocks are ~60–90s). `InMemoryScheduler`
  matches `HH:MM` at a 60s poll and is unsuitable; add a small
  `DraftPoller(intervalMs)` rather than bending the scheduler.
- [ ] Persist state after every pick so a crash mid-draft resumes.

## Phase 5 — The agent

- [ ] `skills/pick-advisor.ts` → best pick, runner-up, tier cliff, survival.
- [ ] `skills/auction-advisor.ts` → max bid with inflation and budget clamp.
- [ ] `draft-orchestrator.ts`: state → models → skills → `Recommendation`,
  mirroring `runOrchestrator`'s shape in `src/agents/ff-orchestrator.ts`.
- [ ] Add `"draft_pick"` to `RecommendationType`; persist via
  `saveRecommendation` so the GUI and audit trail pick it up.
- [ ] Human gate: no auto-pick under any config. If a `draft_pick` action is
  modelled, route it through `ActionQueue` as high risk.
- [ ] `pmt draft-advise` (one-shot) and `pmt draft-live` (loop, prints on each
  state change).
- [ ] Fixture-driven end-to-end test: seeded board + scripted pick sequence →
  asserted recommendations.

## Phase 6 — Draft-day hardening

- [ ] `pmt draft-warm` — pre-draft: refresh crosswalk, board, values, tiers,
  projections into SQLite so the draft itself needs **zero** network.
- [ ] Degraded-mode ladder: FantasyCalc down → kona + projections; kona stale →
  cached board + projections; everything down → projections + tiers only, with
  the degradation stated in the recommendation's `assumptions`.
- [ ] Latency budget: advice must render well inside the pick clock; measure
  and assert a ceiling in tests.
- [ ] CI guard asserting no code path calls the disallowed FFCalculator `/api/`.
- [ ] Post-draft: write the resulting roster as a `LeagueSnapshot` so the
  in-season loop (doc 21) starts from the drafted team.

## Config

| Var | Default | Meaning |
|-----|---------|---------|
| `PMT_DRAFT_FORMAT` | `ppr` | kona rank type / FantasyCalc scoring |
| `PMT_DRAFT_TEAMS` | `12` | league size (replacement level, inflation) |
| `PMT_DRAFT_POSITION` | — | my draft slot (snake maths) |
| `PMT_DRAFT_BUDGET` | `200` | auction budget |
| `PMT_DRAFT_FEED` | `manual` | `manual` or `espn` |
| `PMT_DRAFT_POLL_MS` | `5000` | live feed poll interval |
| `PMT_TIERING_METHOD` | `gmm` | `gmm`/`kmeans`/`jenks` |
| `PMT_TIERING_K` | auto | tier count |
| `PMT_DRAFT_WEIGHTS` | `0.5,0.3,0.2` | `w1,w2,w3` in `Value(p)` |
| `PMT_ADP_SNAPSHOT_DIR` | `data/adp` | offline 22d snapshots |

## Risks

| Risk | Mitigation |
|------|------------|
| ESPN live draft feed unverified | Spike in Phase 4; manual feed is the shipped default; polling is opt-in |
| ESPN schema drift (kona inner fields unverified) | Defensive parse, fixture tests fail loudly, cached board still usable |
| FFCalculator `robots.txt` `Disallow: /api/` | Offline import only; ESPN ADP fallback; CI guard |
| fftiers repo has no licence | Reimplement the method in TS; never vendor the Python |
| Crosswalk gaps → wrong player merged | Name/team/position fallback match, unmatched count surfaced, board flags unresolved players |
| Network failure mid-draft | `pmt draft-warm` + SQLite-only draft-time reads |
| Agent drafts for the user | No auto-pick path exists; `ActionQueue` + `pmt action-approve` gate retained |

## Testing

Credential-free and fixture-based, matching `tests/fixtures/` conventions and
`node --test`:

- `dp-playerids.sample.csv`, `kona-player-info.sample.json`,
  `fantasycalc-values.sample.json`, `ffcalc-adp.sample.json`,
  `fftiers-ecr.sample.csv`, `draft-script.sample.json` (scripted pick sequence).
- Fake `fetch` for every source; a compliance test asserting zero outbound
  calls for the offline ADP path.
- Determinism: identical board + identical pick sequence must produce identical
  recommendations.

## Sequencing

Phase 1 → 2 → 3 are strictly ordered (identity, then board, then valuation).
Phase 4 can be spiked in parallel with 2–3 since the feed is the schedule risk.
Phase 5 needs 3 and 4. Phase 6 is draft-week work.

Minimum useful shipment: Phases 1–3 plus `pmt draft-board` — a static,
value-ranked, tiered board is already better than drafting off ESPN's default
list, and it de-risks everything after it.

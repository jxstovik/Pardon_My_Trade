# 22c — FantasyCalc API (values / tiers / trends)

Document ID: FDP-TOOLING-004  
Status: Draft  
Milestone: DraftKat

## Overview & provenance
- URL: `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1`
- Maintainer: FantasyCalc (commercial site; public read API)
- Licence/access: free, no API key required (HTTP 200 verified 2026-08-08); `robots.txt` allows all (no `Disallow` for the API host observed) — clean ToS posture for read-only consumption.
- Language/format: HTTP/JSON.
- Maintenance signal: active commercial site returning live data on survey date; endpoint shape stable.
- Survey date: 2026-08-08

## Capabilities
Returns player values, tiers, and trend signals for configurable league settings:
- Redraft vs dynasty (`isDynasty`)
- Number of QBs (`numQbs`: 1 or 2)
- League size (`numTeams`)
- Scoring (`ppr`: 0 / 0.5 / 1)

Used as an external value/tier source to augment DraftKat's draft board and to feed the trade-proposer's surplus-value math.

## Data model / API surface
Verified request URL + query parameters:
- `isDynasty` (boolean: true/false)
- `numQbs` (integer: 1 or 2)
- `numTeams` (integer: league size, e.g. 12)
- `ppr` (number: 0, 0.5, or 1)

Verified: endpoint returns HTTP 200 with a JSON body containing player values, tiers, and trends. Exact top-level wrapper and response field names are **unverified** — confirm against a saved response before coding. Expected (NOT verified) shape:
```
{
  "players": [
    { "id": "...", "name": "...", "team": "...", "position": "...", "value": 123, "tier": 2, "positionRank": 5, "trend": 1.2 }
  ]
}
```
Proposed TypeScript interface (design):
```ts
export interface FantasyCalcPlayerValue {
  id: string;
  name: string;
  team?: string;
  position?: string;
  value: number;       // overall value
  tier?: number;       // tier bucket
  positionRank?: number;
  trend?: number;      // recent value movement
}

export interface FantasyCalcValuesResponse {
  players: FantasyCalcPlayerValue[];   // wrapper unverified
}
```

## Auth, rate limits, caching & ToS
- Auth: none required.
- Rate limits: **unverified** (commercial site; assume polite-use). Mitigation: cache and refresh on a schedule, not per-request.
- `robots.txt`: allows all for the API host — no scraping prohibition observed; read-only consumption is acceptable.
- Caching: wrap in `RecommendationCache` (file-backed, `DEFAULT_CACHE_TTL_MS = 3600000`, env `PMT_CACHE_TTL_MS`, `--force` bypass). Values shift in-season, so a 1-hour default TTL (matching `DEFAULT_CACHE_TTL_MS`) is reasonable; pre-draft use can tolerate longer.
- ToS: free, no-key, robots-allowed — low risk; do not redistribute the raw payload.

## Integration plan for DraftKat
- New source: `src/projections/fantasycalc-value-source.ts` implementing a `ValueSource` (or extending `ProjectionSource` to attach `value`/`tier` to a `DraftRank`/candidate). Distinct from point-projection sources; it supplies draft value, not projected points.
- Map to `KnowledgeRepository`: persist a `draft_values` snapshot (player key via `player_id_map` from 22b, value, tier, trend, as_of).
- Map to draft board (22a): merge FantasyCalc `value`/`tier` with ESPN kona ranks to produce a ranked, valued board.
- Map to trade-proposer skill (`src/agents/skills/trade-proposer.ts`): FantasyCalc values feed the surplus-value calculation already used for +EV trade proposals (in-season), now reusable pre-draft.
- Map to `RecommendationCache`: cache the API response (reuse cache + `--force`).
- Map to `Scheduler`: a refresh job (e.g. daily in-season, weekly pre-draft).
- New config/env: `PMT_FANTASYCALC_PPR` (default 1), `PMT_FANTASYCALC_TEAMS` (default 12), `PMT_FANTASYCALC_QBS` (default 1), `PMT_FANTASYCALC_DYNASTY` (default false), `PMT_FANTASYCALC_CACHE_TTL_MS` (optional).
- CLI surface: `pmt draft-values [--source fantasycalc] [--ppr 1] [--teams 12] [--qbs 1] [--dynasty false] [--force]`.

## Phased checklist

## Phase 1 — Value source + types
- [ ] Create `src/projections/fantasycalc-value-source.ts` with `ValueSource` interface
- [ ] Define `FantasyCalcPlayerValue` type (design)
- [ ] Add fake-`fetch` unit test against saved fixture

## Phase 2 — Persistence + merge
- [ ] Add `draft_values` table + accessors to `src/knowledge/repository.ts`
- [ ] Merge FantasyCalc value/tier with ESPN kona ranks (22a) via `player_id_map` (22b)
- [ ] Add `pmt draft-values` CLI command

## Phase 3 — Trade-proposer reuse
- [ ] Feed FantasyCalc values into `src/agents/skills/trade-proposer.ts` surplus-value math
- [ ] Unit-test surplus-value with fixture values

## Phase 4 — Scheduling + cache
- [ ] Wrap fetch in `RecommendationCache`; honour `PMT_CACHE_TTL_MS`/`--force`
- [ ] Register daily/weekly refresh scheduler job

## Risks & caveats
- Response schema unverified: exact wrapper/field names must be confirmed against a saved response; parser should be header/field-tolerant and fail loudly on drift.
- Rate limits unverified: Mitigation: cache + scheduled refresh, never per-request.
- Commercial dependency: FantasyCalc could change access terms. Mitigation: cached snapshots mean draft-time use degrades gracefully to last cached values; DynastyProcess (22b) + ESPN kona (22a) provide fallbacks.
- ID mapping: FantasyCalc `id` must be resolved through `player_id_map` (22b) to join with ESPN kona. Mitigation: require the crosswalk before enabling the merge.

## Testing strategy
- Fixture: add `tests/fixtures/fantasycalc-values.sample.json` (saved API response from survey, redacted/minimal).
- Test: `tests/fantasycalc-value-source.test.ts` injects a fake `fetch` returning the fixture; asserts parsing of `value`/`tier`/`trend` and that unknown fields are ignored without throwing.
- Run with `node --test`; credential-free (no API key needed).

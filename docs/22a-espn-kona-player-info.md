# 22a — ESPN kona_player_info Draft Ranks

Document ID: FDP-TOOLING-002  
Status: Draft  
Milestone: DraftKat

## Overview & provenance
- URL (endpoint): `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3?view=kona_player_info`
- Maintainer: ESPN (first-party API; `lm-api-reads` is ESPN's public read host)
- Licence: proprietary (ESPN internal API; no open-source licence — consume read-only, do not redistribute)
- Language/format: HTTP/JSON, consumed by DraftKat's TypeScript HTTP client
- Maintenance signal: production ESPN endpoint, stable across seasons; verified reachable (HTTP 200) on the survey date
- Survey date: 2026-08-08

## Capabilities
Exposes, per player:
- `draftRanksByRankType` for four rank types: **PPR**, **STANDARD**, **SUPERFLEX**, **ELIMINATION**
- `auctionValue` (estimated auction-draft dollar value)
- `averageDraftPosition` (overall ADP)
- `ownership.percentOwned` (public ownership %)

These are global (league-default) draft rankings, league-agnostic, suitable as a baseline draft board. No projected points are returned — this is a ranking/value source, not a projection source.

## Data model / API surface
Verified request URLs:
- Default (global) board: `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info`
- Specific league: `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/{leagueId}?view=kona_player_info` (requires `ESPN_S2`/`SWID` for private leagues)

`leaguedefaults/3` vs a real `leagueId` path: `leaguedefaults/3` returns the full player universe with default (standard) scoring — the correct choice for a global, league-agnostic draft board. The `leagues/{leagueId}` path returns league-specific context (rosters, scoring overrides) and requires auth for private leagues; use it only when league-specific draft settings are needed.

Verified response fields (top level, per player): `id`, `fullName`, `defaultPositionId`, `proTeamId`, `draftRanksByRankType`, `auctionValue`, `averageDraftPosition`, `ownership.percentOwned`. The four keys inside `draftRanksByRankType` (PPR / STANDARD / SUPERFLEX / ELIMINATION) are verified; the inner property name(s) (e.g. `rank`) are **unverified**. `ownership` inner fields beyond `percentOwned` are **unverified**.

Pagination: via request header `x-fantasy-filter` carrying a JSON body such as `{"players":{"limit":N,"offset":M}}`; the exact JSON shape is **unverified** (design below). Without the header, ESPN returns a default window; the league-default view returns the full player universe across paginated chunks that must be walked via `offset`.

Concrete example (verified top-level shape; inner ranks abbreviated and marked design):
```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info
Header: x-fantasy-filter: {"players":{"limit":50,"offset":0}}
Response (array element):
{
  "id": 4035387,
  "fullName": "Example Player",
  "defaultPositionId": 1,
  "proTeamId": 22,
  "draftRanksByRankType": {
    "PPR": {"rank": 1},
    "STANDARD": {"rank": 2},
    "SUPERFLEX": {"rank": 1},
    "ELIMINATION": {"rank": 1}
  },
  "auctionValue": 83,
  "averageDraftPosition": 1.0,
  "ownership": { "percentOwned": 100.0 }
}
```
(The inner `draftRanksByRankType` member shape shown is design/unverified for the precise property name.)

Proposed TypeScript interface (design — not verified against the wire):
```ts
export type EspnRankType = 'PPR' | 'STANDARD' | 'SUPERFLEX' | 'ELIMINATION';

export interface EspnKonaPlayer {
  id: number;
  fullName: string;
  defaultPositionId: number;   // 1=QB,2=RB,3=WR,4=TE,5=K,6=DEF
  proTeamId: number;
  draftRanksByRankType: Partial<Record<EspnRankType, { rank?: number; auctionValue?: number }>>;
  auctionValue: number;
  averageDraftPosition: number;
  ownership: { percentOwned: number };
}

export interface EspnKonaResponse {
  players?: EspnKonaPlayer[];   // verified top-level container; exact wrapper key unverified
  // pagination cursor (offset/limit) returned by ESPN is unverified
}
```

## Auth, rate limits, caching & ToS
- Auth: read endpoint reachable without cookies; for a private-league path, reuse DraftKat's existing `ESPN_S2`/`SWID` from `.env` (already used by `src/adapters/espn/espn-platform-reader.ts`). No new credentials.
- Rate limits: **unverified** (ESPN does not publish limits for `lm-api-reads`); treat as polite-use and cache aggressively.
- `robots.txt`: not applicable to the API host (no `robots.txt` constraint observed for `lm-api-reads.fantasy.espn.com`); the endpoint is DraftKat's already-authorised ESPN surface, so ToS risk is negligible for read-only use.
- Caching: wrap the fetch in `RecommendationCache` (file-backed, `DEFAULT_CACHE_TTL_MS = 3600000`, env `PMT_CACHE_TTL_MS`, `--force` bypass). Because draft ranks are season-long static, a long TTL (or a dedicated `PMT_KONA_CACHE_TTL_MS`) is appropriate; a pre-season scheduler job refreshes once.

## Integration plan for DraftKat
- Reuse, don't duplicate: extend `src/adapters/espn/espn-platform-reader.ts` with a `fetchKonaDraftBoard(season, rankType)` method that reuses the same authenticated HTTP client as the existing reader; do NOT create a parallel ESPN client. `src/projections/espn-projection-source.ts` is unchanged (it produces `ProjectionCandidate` point projections; kona provides draft ranks, a different concern).
- New interface: add `src/draft/draft-board-source.ts` with `DraftRankSource.fetchDraftBoard(sport, season, format): Promise<DraftRank[]>`; `KonaDraftSource` implements it.
- Map to `KnowledgeRepository`: persist a snapshot into a new `draft_board` table (player id, format, rank, auction_value, adp, as_of) via the existing repository pattern in `src/knowledge/repository.ts`.
- Map to `RecommendationCache`: cache the raw kona response (reuse cache + `--force`).
- Map to `Scheduler`/season jobs: add a pre-season job (e.g. `draft-sync`) that refreshes the board ~1 week before the user's draft; use `InMemoryScheduler` daily `HH:MM` match.
- New config/env: `PMT_KONA_SEASON` (default current NFL season), `PMT_KONA_CACHE_TTL_MS` (optional override); reuse `ESPN_S2`/`SWID`/`ESPN_LEAGUE_ID`.
- CLI surface (consistent with `pmt ff-run / import-espn / action-*`): `pmt draft-kona [--season 2026] [--format ppr|standard|superflex|elimination] [--force]`; optional `pmt draft-sync` scheduled job.

## Phased checklist

## Phase 1 — Read client reuse
- [ ] Add `fetchKonaDraftBoard(season, rankType)` to `src/adapters/espn/espn-platform-reader.ts` reusing the existing authenticated client
- [ ] Add a fake-`fetch` test double for the kona endpoint in `tests/espn-platform-reader.test.ts`
- [ ] Confirm `ESPN_S2`/`SWID` already flow from `.env` (no new secret)

## Phase 2 — Draft-rank source + types
- [ ] Create `src/draft/draft-board-source.ts` with `DraftRankSource` interface and `KonaDraftSource`
- [ ] Define `DraftRank` type (playerId, format, rank, auctionValue, adp, asOf)
- [ ] Unit-test parsing of saved fixture (no network)

## Phase 3 — Persistence + caching
- [ ] Add `draft_board` table + `saveDraftBoard`/`getDraftBoard` to `src/knowledge/repository.ts`
- [ ] Wrap kona fetch in `RecommendationCache`; honour `PMT_CACHE_TTL_MS` and `--force`
- [ ] Add `pmt draft-kona` CLI command

## Phase 4 — Scheduling + draft-board wiring
- [ ] Register a pre-season `draft-sync` scheduler job
- [ ] Wire kona ranks into the draft-board view used by any future draft skill

## Risks & caveats
- ESPN API breakage: ESPN can change field names/shapes without notice (proprietary). Mitigation: fixture-based parser tests fail loudly; pin to a saved response; alert on schema drift.
- Inner rank property unverified: `draftRanksByRankType` member key name may differ. Mitigation: parse defensively (read whichever of `rank`/`auctionValue` exists); log on miss.
- No published rate limit: Mitigation: aggressive caching (season-long TTL) + `--force` only on demand.
- Licence/ToS: proprietary endpoint, read-only, already authorised via existing ESPN creds — low risk; do not redistribute raw payloads.

## Testing strategy
- Fixture: add `tests/fixtures/kona-player-info.sample.json` (saved HTTP response from survey, redacted of any private-league data; public global board only).
- Test: `tests/espn-platform-reader.test.ts` and `tests/kona-draft-source.test.ts` inject a fake `fetch` returning the fixture; assert `DraftRank[]` parsing for each of PPR/STANDARD/SUPERFLEX/ELIMINATION, `auctionValue`, `averageDraftPosition`, `ownership.percentOwned`.
- Run with `node --test`; credential-free (uses fixture + fake fetch, no `ESPN_S2` required).

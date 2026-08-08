# 22d — FantasyFootballCalculator ADP Snapshot

Document ID: FDP-TOOLING-005  
Status: Draft  
Milestone: DraftKat

## Overview & provenance
- URL: `https://www.fantasyfootballcalculator.com/api/v1/adp/{format}?teams=12&year=2026`
- Maintainer: FantasyFootballCalculator (commercial site)
- Licence/access: free HTTP 200 without a key, BUT `robots.txt` contains `Disallow: /api/` — automated access to the API is prohibited by the site's robots policy.
- Language/format: HTTP/JSON.
- Maintenance signal: site active; endpoint returned 200 on the survey date.
- Survey date: 2026-08-08

## Capabilities
Returns average draft position (ADP) aggregates per player for a chosen format / league size / year, including dispersion and sample-size metadata used for "reach/value" analysis.

## Data model & API surface
Verified endpoint forms:
- `/api/v1/adp/ppr?teams=12&year=2026`
- `/api/v1/adp/standard?teams=12&year=2026`
- `/api/v1/adp/half-ppr?teams=12&year=2026`
- `/api/v1/adp/2qb?teams=12&year=2026`
- `/api/v1/adp/dynasty?teams=12&year=2026`

Format values confirmed: `ppr`, `standard`, `half-ppr`, `2qb`, `dynasty`. Query params confirmed: `teams` (league size, e.g. 12) and `year` (e.g. 2026).

Verified response fields: `adp` (average draft position), `stdev` (draft-position standard deviation), `bye` (bye week), `total_drafts` (number of drafts aggregated). Other fields (player name/team/position, pick/round breakdown) are **unverified** — confirm against a saved response before coding.

Example (verified fields only; surrounding wrapper unverified):
```
GET https://www.fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=2026
Response (array element):
{
  "player": "Example Player",
  "team": "XYZ",
  "position": "RB",
  "adp": 12.3,
  "stdev": 4.1,
  "bye": 10,
  "total_drafts": 18432
}
```
(The exact wrapper/key names beyond `adp`/`stdev`/`bye`/`total_drafts` are unverified.)

Proposed TypeScript interface (design):
```ts
export type AdpFormat = 'ppr' | 'standard' | 'half-ppr' | '2qb' | 'dynasty';

export interface AdpSnapshotRow {
  player: string;
  team?: string;
  position?: string;
  adp: number;            // verified
  stdev: number;          // verified
  bye?: number;           // verified
  totalDrafts: number;    // verified
  format: AdpFormat;
  teams: number;
  year: number;
}
```

## Auth, rate limits, caching & ToS
- Auth: none required (key-free 200).
- `robots.txt` (HEADLINE): `Disallow: /api/`. Automated/live polling of this endpoint violates the site's stated robots policy. This is the controlling constraint for the whole integration.
- Compliance posture (unambiguous): DraftKat MUST NOT perform automated or scheduled live requests against `/api/`. The only supported paths are:
  1. A manual, one-off snapshot the user captures themselves and takes responsibility for (saved to disk, then imported), or
  2. Written permission from FantasyFootballCalculator to access the API programmatically.
- Rate limits: **unverified** (moot — live polling is disallowed regardless).
- Caching: because the source is an offline snapshot, `RecommendationCache` is not used for live fetch. The imported snapshot is stored in SQLite (a `draft_adp` table) with an `as_of` timestamp and treated as static until the user re-imports.
- ToS: free data, but robots-disallowed API. Do not ship code that hits `/api/` on a schedule or per-request.

## Integration plan for DraftKat
- Built around an offline snapshot importer, NOT a live `ProjectionSource`. New module: `src/draft/adp-snapshot-importer.ts` reads a user-supplied JSON/CSV file and upserts into SQLite.
- Map to `KnowledgeRepository`: add `draft_adp` table + `saveAdpSnapshot`/`getAdp(format, teams, year)` accessors in `src/knowledge/repository.ts`.
- Map to `Scheduler`: NONE for fetching. If the user obtains written permission later, a refresh job could be added; until then no scheduler entry.
- Consuming methodology — ADP-vs-value ("reach/value"): compare a player's `adp` (22d) against their draft value/rank from 22a (ESPN `averageDraftPosition`) and 22c (FantasyCalc `value`/`tier`). Positive gap = value (available later than their value suggests); negative = reach (drafted earlier than value suggests). This is the analytical output, surfaced to the human via the existing recommendation/action-queue path.
- New config/env: `PMT_ADP_SNAPSHOT_DIR` (where the user drops snapshot files). No credential/env for the API.
- CLI surface: `pmt draft-adp-import <file> [--format ppr] [--teams 12] [--year 2026]` — imports a local file; no network call.
- Fallback if permission is NOT obtained: use ESPN `averageDraftPosition` from 22a as the compliant ADP substitute (already authorised via existing ESPN creds, no robots conflict). The `draft-adp-import` command becomes an optional enhancement only; the default draft board uses 22a ADP. No `/api/` request is ever made.

## Phased checklist

## Phase 1 — Snapshot schema + repository
- [ ] Add `draft_adp` table + `saveAdpSnapshot`/`getAdp` to `src/knowledge/repository.ts`
- [ ] Define `AdpSnapshotRow` type (design)
- [ ] Add fixture file + parser unit test (no network)

## Phase 2 — Offline importer + CLI
- [ ] Create `src/draft/adp-snapshot-importer.ts` (reads local JSON/CSV)
- [ ] Add `pmt draft-adp-import <file>` CLI command (no fetch)
- [ ] Validate format/teams/year; reject unknown formats

## Phase 3 — Reach/value methodology
- [ ] Compare `adp` (22d) vs ESPN `averageDraftPosition` (22a) vs FantasyCalc value (22c)
- [ ] Emit reach/value signal through existing recommendation surface
- [ ] Unit-test reach/value math with fixtures

## Phase 4 — Compliance guard
- [ ] Add a lint/CI check that no code path calls `fantasyfootballcalculator.com/api/`
- [ ] Document the robots.txt prohibition + fallback in `docs/`
- [ ] If written permission obtained later, add an opt-in refresh job behind a flag

## Risks & caveats
- robots.txt `Disallow: /api/` — the central risk. Mitigation: offline-only import; CI guard against any `/api/` call; default to 22a `averageDraftPosition` fallback.
- Stale snapshot: user-supplied file can go stale. Mitigation: store `as_of`; surface age in UI; require re-import for current drafts.
- Response schema unverified beyond `adp`/`stdev`/`bye`/`total_drafts`: Mitigation: header-driven parser; fail loudly on missing verified fields.
- Licence/ToS of redistribution: a stored snapshot is the user's responsibility; DraftKat must not re-serve it as its own.

## Testing strategy
- Fixture: add `tests/fixtures/ffcalc-adp.sample.json` (saved user snapshot, verified fields only, no PII).
- Test: `tests/adp-snapshot-importer.test.ts` reads the fixture from disk (no network), asserts `draft_adp` upsert and reach/value comparison against 22a/22c fixtures.
- Compliance test: `tests/adp-compliance.test.ts` asserts no outbound request is made (fake `fetch` spy unused / asserted zero calls).
- Run with `node --test`; credential-free.

# 22b — DynastyProcess Data (player-ID crosswalk & baseline values)

Document ID: FDP-TOOLING-003  
Status: Draft  
Milestone: DraftKat

## Overview & provenance
- URL: `https://github.com/dynastyprocess/data`
- Maintainer: DynastyProcess (community data project; data also surfaced via `nflverse/nflreadr` `load_ff_playerids()` / `load_ff_rankings()`)
- Licence: repo licence field **unverified**; `nflverse/nflverse-data` (the sibling nflverse data repo) is CC-BY-4.0. Treat DynastyProcess data as CC-BY-4.0 pending explicit confirmation; do not assume permissive until verified.
- Language/format: CSV (and `.csv.gz` compressed) static files; consumed by DraftKat as file imports into SQLite.
- Maintenance signal: data repo actively published (referenced live by nflverse tooling); not a code project, so "maintenance" = refresh cadence (**unverified** exact schedule; historically weekly in-season).
- Survey date: 2026-08-08

## Capabilities
Provides the canonical multi-source player-ID crosswalk plus FantasyPros ECR and baseline values:
- `db_playerids.csv` — crosswalk of player IDs across ecosystems (enables normalising ESPN/Sleeper/Yahoo/FantasyPros/etc. to one key).
- `db_fpecr.csv.gz` — FantasyPros Expert Consensus Rankings (redraft / dynasty / best-ball variants).
- `values.csv` — player values for 1-QB and 2-QB formats.
- `values-picks.csv` — rookie-pick / draft-pick values (dynasty).
- `fp_latest_weekly.csv` — latest weekly rankings.

## Data model / API surface
Verified file names (from repo listing): `db_playerids.csv`, `db_fpecr.csv.gz`, `values.csv`, `values-picks.csv`, `fp_latest_weekly.csv`. Exact column names are **unverified** — confirm against the actual file header before coding. Expected (NOT verified) schemas from nflverse documentation:
- `db_playerids.csv`: `snsr_id`, `gsis_id`, `espn_id`, `yahoo_id`, `fleaflicker_id`, `sutd_id`, `fantrax_id`, `birth_date`, `first_name`, `last_name`, `position`, `team`, `status` (label as unverified).
- `db_fpecr.csv.gz`: `player`, `team`, `pos`, `ecr`, `rank`, `avg`, `best`, `worst`, `sd`, `bye`, `rookie` (unverified).
- `values.csv`: `player`, `team`, `position`, `age`, `value_1qb`, `value_2qb` (unverified).
- `values-picks.csv`: pick-value rows (unverified columns).
- `fp_latest_weekly.csv`: weekly ranking rows (unverified columns).

There is no live API; consumption is a file download (repo raw or release asset). Refresh cadence: **unverified** (assume in-season weekly, off-season sporadic). The crosswalk is the enabling piece: it lets DraftKat map its existing ESPN `proTeamId`/`id` and any Sleeper IDs onto a single `player_id_map` key, so multiple `ProjectionSource` outputs can be blended without ID collisions.

Proposed TypeScript interface (design):
```ts
export interface PlayerIdMapRow {
  snsrId?: string;
  gsisId?: string;
  espnId?: string;       // maps to ESPN kona `id`
  yahooId?: string;
  fleaflickerId?: string;
  sutdId?: string;
  fantraxId?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  team?: string;
  status?: string;
}

export interface DpValueRow {
  player: string;
  team?: string;
  position?: string;
  value1qb: number;
  value2qb: number;
}
```

## Auth, rate limits, caching & ToS
- Auth: none (public files).
- Rate limits: none meaningful for occasional file download; however avoid hot-looping the GitHub raw host — download once per refresh.
- `robots.txt`: not applicable (static repo files; GitHub serves raw assets).
- ToS/licence: CC-BY-4.0 inferred via nflverse-data; repo licence field unverified — must confirm before redistribution. DraftKat should store the data locally (import into SQLite) and cite DynastyProcess/nflverse, not re-serve the raw files.
- Caching: import into SQLite (`player_id_map`, `dp_values` tables) and reuse `RecommendationCache` semantics; since data is static between refreshes, a long TTL (e.g. weekly) plus a manual `pmt draft-dp-sync --force` is sufficient. No per-request network call at draft time.

## Integration plan for DraftKat
- Enabling piece: back a `player_id_map` table in `KnowledgeRepository` (`src/knowledge/repository.ts`) from `db_playerids.csv`. This is a prerequisite for normalising ESPN kona ranks (22a), FantasyCalc values (22c), and existing Razzball/FFToday/ESPN `ProjectionSource`s to one key.
- New module: `src/data/dynastyprocess-importer.ts` — downloads the verified files, parses CSV/`.csv.gz`, upserts into SQLite. Place under `src/data/` (data-ingest) rather than `src/projections/`.
- Map to `KnowledgeRepository`: add `player_id_map` + `dp_values` tables and `savePlayerIdMap`/`getEspnToCanonical` accessors.
- Map to `Scheduler`: a weekly in-season refresh job (or manual `pmt draft-dp-sync`).
- New config/env: `PMT_DP_DATA_DIR` (where to cache downloaded CSVs), `PMT_DP_REFRESH_MS` (optional), `PMT_DP_BASE_URL` (default repo raw).
- CLI surface: `pmt draft-dp-sync [--data-dir <dir>] [--force]`; does not need `ESPN_S2`.

## Phased checklist

## Phase 1 — Crosswalk table
- [ ] Add `player_id_map` table to `src/knowledge/repository.ts` schema
- [ ] Define `PlayerIdMapRow` type in `src/data/types.ts`
- [ ] Add fixture CSV + parser unit test (no network)

## Phase 2 — Importer
- [ ] Create `src/data/dynastyprocess-importer.ts` (download + gunzip + CSV parse)
- [ ] Upsert into `player_id_map`; idempotent re-run
- [ ] Add `pmt draft-dp-sync` CLI command

## Phase 3 — Values import
- [ ] Import `values.csv` / `db_fpecr.csv.gz` into `dp_values`
- [ ] Add `getCanonicalValue(playerKey, format)` accessor
- [ ] Unit-test value lookup against fixture

## Phase 4 — Normalisation wiring
- [ ] Map ESPN kona `id` (22a) and FantasyCalc ids (22c) through `player_id_map`
- [ ] Add weekly scheduler refresh job
- [ ] Document the CC-BY-4.0 attribution in `docs/`

## Risks & caveats
- Licence unverified: repo licence field not confirmed; nflverse-data is CC-BY-4.0 but DynastyProcess repo may differ. Mitigation: confirm before any redistribution; keep data local + attribute.
- Column names unverified: parser must read the real header at runtime (column-index-free, header-driven parse) and fail loudly if expected columns are absent.
- Refresh cadence unverified: Mitigation: weekly import cadence + `--force` for ad-hoc; store `as_of` timestamp.
- Data-quality drift: IDs can lag real-world transactions. Mitigation: cross-check against ESPN kona `id` at draft time; flag unmapped players.

## Testing strategy
- Fixtures: add `tests/fixtures/dp-db_playerids.sample.csv` and `tests/fixtures/dp-values.sample.csv` (small representative subsets, header rows intact, no PII).
- Test: `tests/dynastyprocess-importer.test.ts` reads the fixtures from disk (no network), asserts `player_id_map` upsert and `getEspnToCanonical` mapping. Optionally a network-guarded integration test (skipped unless `PMT_NETWORK_TEST=1`).
- Run with `node --test`; credential-free.

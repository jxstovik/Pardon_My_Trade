# 22e — borisachen/fftiers Tiering Methodology

Document ID: FDP-TOOLING-006  
Status: Draft  
Milestone: DraftKat

## Overview & provenance
- URL: `https://github.com/borisachen/fftiers`
- Maintainer: borisachen (community)
- Licence: NONE declared (repo has no licence file) — vendoring the Python code is off the table. The DELIVERABLE is the methodology, not the code.
- Language: Python (reference implementation); DraftKat reimplements the method in TypeScript.
- Maintenance signal: repo active (noted 2025-09-08); weekly CSVs published.
- Survey date: 2026-08-08

## Capabilities
Computes player tiers by fitting a Gaussian mixture model (GMM) over expert-consensus ranks (FantasyPros ECR), so players in the same tier are statistically indistinguishable in consensus. Output: per-player tier labels that group the draft board.

## Data model & API surface
No API. Two CSV outputs from the repo:
- `weekly-*.csv` (e.g. `weekly-RB.csv`): published publicly, HTTP 200 verified. Columns **unverified** (expected: player, team, position, rank, tier, ecr, etc. — NOT confirmed).
- `draft-*.csv` (e.g. `draft-RB.csv`): returns HTTP 403 — NOT accessible. Do not depend on it.

Because the method consumes expert-consensus ranks (FantasyPros ECR), the practical DraftKat input is the DynastyProcess `db_fpecr.csv.gz` (22b), which carries FantasyPros ECR and is consumable. The repo's own CSVs are supplementary/illustrative only; the draft CSV is unavailable.

Method (verified concept): Gaussian-mixture clustering over a 1-D expert-rank distribution, using each player's consensus rank and (where available) per-player standard deviation as the spread; EM fits K Gaussians; players are labelled by the component with the highest posterior. Tier boundaries are the component means.

Proposed TypeScript interface (design):
```ts
export interface TierInput {
  playerKey: string;     // resolved via player_id_map (22b)
  consensusRank: number; // from ECR / FantasyPros
  stdev?: number;        // per-player uncertainty, if available
}

export interface TierResult {
  playerKey: string;
  tier: number;          // 1 = top tier
  meanRankOfTier: number;
  posterior?: number;
}
```

## Auth, rate limits, caching & ToS
- Auth: none for the public weekly CSV; draft CSV is 403.
- Rate limits: n/a (static files).
- `robots.txt`: not applicable (GitHub raw static files).
- ToS/licence: repo has NO licence — do not copy or vendor the Python. Reimplement the method independently in TypeScript (the algorithm itself is not licensed). Consuming the public weekly CSV data is acceptable; the draft CSV is blocked and must not be fetched.
- Caching: tier computation is deterministic given an ECR snapshot; cache the resulting `tier` assignments in SQLite (`player_tiers` table) keyed by ECR `as_of`, reusing `RecommendationCache` semantics if desired.

## Integration plan for DraftKat
- Deliverable = methodology reimplemented in TS, not the Python repo. New module: `src/draft/tiering.ts` implementing 1-D GMM/EM (or k-means/jenks fallback) over ECR ranks sourced from DynastyProcess `db_fpecr.csv.gz` (22b).
- Map to draft board (22a): attach `tier` to each player on the ESPN kona draft board so the UI/grouping reflects tiers.
- Map to values (22c): tiers + FantasyCalc `value`/`tier` cross-check; DraftKat's own tier (from ECR) is the primary, FantasyCalc `tier` is a secondary signal.
- Map to `src/probabilistic/` (Bayesian floor/ceiling): the GMM tier assignment can seed or validate the Bayesian model's dispersion. Specifically, a player's tier membership and the within-tier stdev can inform the `sigma` (uncertainty) of DraftKat's `P(x>τ)` floor/ceiling estimates, and tiers can act as priors on cluster-level outcome distributions. This is an enhancement to, not a replacement of, the existing Bayesian EWMA model.
- Map to `KnowledgeRepository`: add `player_tiers` table + `saveTiers`/`getTiers(asOf)` accessors.
- Dependency decision (honest): hand-roll 1-D EM in TypeScript (~100 lines, no new dependency) is **recommended** over adding a numerics library (e.g. `ml-matrix`, `simple-statistics`). Reasons: (a) the method is genuinely 1-D and trivial; (b) DraftKat is ESM/TS with a light-dependency posture; (c) a dependency adds supply-chain and licence surface for marginal benefit. If EM proves numerically unstable on a given ECR snapshot, fall back to k-means or Jenks natural-breaks (also hand-rolled) behind `PMT_TIERING_METHOD`.
- New config/env: `PMT_TIERING_METHOD` (`gmm` default, or `kmeans`/`jenks` fallback), `PMT_TIERING_K` (optional component count).
- CLI surface: `pmt draft-tier [--method gmm|kmeans|jenks] [--k 5]` — computes tiers from the imported ECR (22b) and stores them; no external network call.

## Phased checklist

## Phase 1 — ECR input + types
- [ ] Source FantasyPros ECR from DynastyProcess `db_fpecr.csv.gz` (22b)
- [ ] Define `TierInput` / `TierResult` types (design)
- [ ] Add fixture ECR file + parser test (no network)

## Phase 2 — TS tiering implementation
- [ ] Implement 1-D GMM/EM in `src/draft/tiering.ts` (hand-rolled, no dependency)
- [ ] Add `kmeans`/`jenks` fallback path behind `PMT_TIERING_METHOD`
- [ ] Unit-test tier labels against a known small input

## Phase 3 — Attach to board + probabilistic model
- [ ] Join `tier` onto ESPN kona draft board (22a) via `player_id_map`
- [ ] Feed tier within-stdev into `src/probabilistic/` sigma priors
- [ ] Add `pmt draft-tier` CLI command

## Phase 4 — Persistence + compliance
- [ ] Add `player_tiers` table + accessors to `src/knowledge/repository.ts`
- [ ] Document that the Python repo is NOT vendored (no licence)
- [ ] CI guard: no import of borisachen/fftiers code

## Risks & caveats
- No licence on the repo: vendoring the Python is prohibited. Mitigation: independent TS reimplementation; algorithm is unlicensed.
- `draft-*.csv` is 403: Mitigation: use DynastyProcess ECR (22b) as the ECR input; never fetch the blocked draft CSV.
- GMM tuning: wrong K or poor convergence yields bad tiers. Mitigation: default K from data heuristics; expose `PMT_TIERING_K`; k-means/jenks fallback when EM is unstable.
- ECR staleness: Mitigation: tier on the same ECR `as_of` used by the draft board; recompute on refresh.

## Testing strategy
- Fixture: add `tests/fixtures/fftiers-ecr.sample.csv` (small ECR subset with consensus ranks + stdev, header intact, nothing from the 403 draft CSV).
- Test: `tests/tiering.test.ts` runs `computeTiers()` on the fixture, asserts deterministic tier labels and that the k-means/jenks fallback produces stable output; asserts no network call (fake `fetch` unused / zero calls).
- Run with `node --test`; credential-free.

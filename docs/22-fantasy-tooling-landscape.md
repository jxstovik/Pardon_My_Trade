# 22 — Fantasy Football Tooling Landscape

Document ID: FDP-TOOLING-001  
Status: Draft  
Milestone: DraftKat

## Purpose & Scope

This document surveys the public landscape of fantasy-football draft tooling, AI agents, MCP servers, and automation workflows that are relevant to the DraftKat project (ESPN-centric, TypeScript/Node 20 ESM, better-sqlite3, recommendation-only with a human-approval action queue). It catalogs what exists, assesses fit against DraftKat's architecture and constraints, identifies the draft-phase gap in the current codebase, and produces a prioritized shortlist of five integrations for deep-dive docs `docs/22a`–`docs/22e`.

Scope covers five categories: (1) open-source libraries & platform API clients, (2) draft-specific tools (ADP/auction/VORP/tiers/mock-draft/optimizers), (3) AI agents, MCP servers & LLM skills, (4) commercial/SaaS tools & data sources, (5) workflows & methodologies. Every entry was verified by an HTTP fetch or GitHub API lookup on the survey date; anything not independently confirmed is marked `unverified` inline.

## Methodology & Survey Date

- **Survey date:** 2026-08-08. All GitHub repository facts (stars, last-commit/archive state, licence SPDX field) were read via the GitHub REST API; all API/website endpoints were checked with `curl` for HTTP status and (where relevant) `robots.txt` and `llms.txt`.
- **Licence notation:** where a repository had no SPDX licence field (GitHub returns "License: not found"), it is recorded as "licence not declared" rather than assumed permissive. Items behind `robots.txt` `Disallow` are flagged for ToS risk even when the endpoint returns data without a key.
- **Total catalogued:** 71 distinct items across the five categories. No URLs, star counts, or licences in this document are invented; unverified values are explicitly labelled.

## Category 1 — Open-source libraries & platform API clients

| Name | Type | URL | Language/Platform | License/Access | What it does | Relevance to DraftKat |
|------|------|-----|-------------------|----------------|--------------|-----------------------|
| cwendt94/espn-api | Library (client) | https://github.com/cwendt94/espn-api | Python | MIT; 929★ | ESPN Fantasy API for football/basketball; exposes `league.draft` and `team.draft`; wiki `Football-Intro.md` | Reference for ESPN draft-object shape; DraftKat has an ESPN reader but no draft-board endpoint coverage |
| mkreiser/ESPN-Fantasy-Football-API | Library (npm) | https://github.com/mkreiser/ESPN-Fantasy-Football-API | JavaScript | LGPL-3.0; 345★ | Node ESPN Fantasy API wrapper | JS/TS-adjacent ESPN coverage; LGPL affects redistribution |
| nflverse/nfl_data_py | Library | https://github.com/nflverse/nfl_data_py | Python | MIT; 435★; **ARCHIVED 2025-09-25** | Weekly play-by-play & player data | Frozen reference only; do not build new code on it |
| nflverse/nflreadr | Library | https://github.com/nflverse/nflreadr | R | NOASSERTION; 110★ | Loads nflverse data; `load_ff_playerids()` and `load_ff_rankings()` pull DynastyProcess crosswalk/rankings | Player-ID crosswalk concept reusable; R not directly consumable by TS without a CSV mirror |
| nflverse/nflverse-data | Data repo | https://github.com/nflverse/nflverse-data | CSV/Parquet/RDS releases | CC-BY-4.0; 374★ | GitHub releases: `stats_player_week_YYYY.csv`, `players_components/players.csv`, `schedules` | Historical stats for model backtesting; CC-BY-4.0 permissive |
| ffverse/ffscrapr | Library | https://github.com/ffverse/ffscrapr | R | NOASSERTION; 92★ | R client for MFL/Sleeper/Fleaflicker/ESPN league data | Multi-platform reader pattern; R only; licence unclear |
| ffverse/ffopportunity | Library | https://github.com/ffverse/ffopportunity | R | GPL-3.0; 23★ | Expected-points / opportunity models from usage | Opportunity-modeling idea; GPL-3.0 copyleft |
| ffverse/ffpros | Scraper | https://github.com/ffverse/ffpros | HTML/R | NOASSERTION; 11★ | Retrieves FantasyPros rankings/data | FantasyPros access pattern; ToS-sensitive |
| uberfastman/fantasy-football-metrics-weekly-report | Library | https://github.com/uberfastman/fantasy-football-metrics-weekly-report | Python | GPL-3.0; 225★ | Weekly report generator for Yahoo/ESPN/CBS/Sleeper/Fleaflicker | Report-generation pattern; not draft-focused |
| uberfastman/yfpy | Library | https://github.com/uberfastman/yfpy | Python | GPL-3.0; 257★ | Yahoo Fantasy Sports API OAuth wrapper | Yahoo auth pattern (DraftKat is ESPN-centric) |
| whatadewitt/yahoo-fantasy-sports-api | Library | https://github.com/whatadewitt/yahoo-fantasy-sports-api | JavaScript | MIT; 226★ | Node Yahoo Fantasy wrapper | Yahoo; MIT clean |
| mattdodge/yahoofantasy | Library | https://github.com/mattdodge/yahoofantasy | Python | Licence not declared; 85★ | Yahoo Fantasy wrapper | Yahoo; licence unclear — reference only |
| dtcarls/fantasy_football_chat_bot | Bot | https://github.com/dtcarls/fantasy_football_chat_bot | Python | GPL-3.0; 307★ | GroupMe/Discord/Slack bot posting ESPN league updates | Notification/automation pattern; GPL |
| joeyagreco/leeger | Library | https://github.com/joeyagreco/leeger | Python | MIT; 84★ | League analytics / record calculations | League analytics; MIT |
| kt474/fantasy-football-wrapped | App | https://github.com/kt474/fantasy-football-wrapped | Vue | Apache-2.0; 59★ | Sleeper/ESPN season "wrapped" insights | Insight-presentation pattern; Apache-2.0 |
| k5cents/fflr | Library | https://github.com/k5cents/fflr | R | GPL-3.0; 29★ | ESPN fantasy data in R | ESPN data; R/GPL |
| rbarton65/espnff | Library | https://github.com/rbarton65/espnff | Python | Licence not declared; 255★ | ESPN fantasy client | ESPN; licence unclear — avoid vendoring |
| FantasyFootballAnalytics/ffanalytics | Library | https://github.com/FantasyFootballAnalytics/ffanalytics | R | Licence not declared (Not Found); 187★ | Scrapes site projections, computes points/rankings, `add_uncertainty()` for confidence intervals | Uncertainty/CI methodology maps to DraftKat Bayesian floor/ceiling; licence unclear |
| flipperbw/FantasyPlus | Browser extension | https://github.com/flipperbw/FantasyPlus | JavaScript | MPL-2.0; 89★ | Browser extension overlaying FantasyPros projections on draft pages | Draft-overlay UX pattern; MPL-2.0 |
| jpiburn/fantasypros | Library | https://github.com/jpiburn/fantasypros | R | NOASSERTION; 16★ | FantasyPros data pull in R | FantasyPros access; ToS-sensitive |
| SwapnikKatkoori/sleeper-api-wrapper | Library | https://github.com/SwapnikKatkoori/sleeper-api-wrapper | Python | Licence/stars unverified | Sleeper API wrapper | Sleeper coverage (DraftKat has Sleeper fixture + real adapter); details unverified |
| dynastyprocess/data | Data repo | https://github.com/dynastyprocess/data | CSV (repo/S3) | CC-BY-4.0 inferred via nflverse-data; repo licence field unverified | `db_playerids.csv`, `db_fpecr.csv.gz` (FantasyPros ECR), `values.csv` (1qb/2qb), `values-picks.csv`, `fp_latest_weekly.csv` | Crosswalk + baseline values; see Category 4 |

## Category 2 — Draft-specific tools (ADP / auction / VORP / tiers / mock-draft / optimizers)

| Name | Type | URL | Language/Platform | License/Access | What it does | Relevance to DraftKat |
|------|------|-----|-------------------|----------------|--------------|-----------------------|
| jjti/ff | Draft assistant | https://github.com/jjti/ff | TypeScript | Licence not declared; 70★ | Computes VOR from ESPN/CBS/NFL projections for draft | TS-native VOR/draft logic; licence unclear but useful as methodology reference for a TS `ProjectionSource`/draft skill |
| borisachen/fftiers | Tiering tool | https://github.com/borisachen/fftiers | Python | Licence not declared (none); 187★ | Gaussian-mixture clustering of FantasyPros ECR into tiers; publishes `weekly-*.csv` publicly (HTTP 200), `draft-*.csv` returns 403 | Tiering methodology; weekly CSV consumable; draft CSV blocked. See `docs/22e-fftiers-tiering.md` |
| ESPN kona_player_info | API (read) | https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info | HTTP (JSON) | Read, no auth (cookie optional); paginate via `x-fantasy-filter` | Returns `draftRanksByRankType` (PPR/STANDARD/SUPERFLEX/ELIMINATION), `auctionValue`, `averageDraftPosition`, `ownership.percentOwned` | Extends DraftKat's existing ESPN reader with draft ranks/auction/ADP at zero new ToS risk. See `docs/22a-espn-kona-player-info.md` |
| FantasyFootballCalculator ADP API | API (read) | https://www.fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=2026 | HTTP (JSON) | No key (HTTP 200); `robots.txt` `Disallow: /api/` | ADP with `stdev`, `bye`, `total_drafts` per format | Dedicated ADP source; `robots.txt` prohibits automated `/api/` access — ToS risk. See `docs/22d-fantasyfootballcalculator-adp.md` |
| DimaKudosh/pydfs-lineup-optimizer | Optimizer | https://github.com/DimaKudosh/pydfs-lineup-optimizer | Python | MIT; 445★ | Daily-fantasy lineup optimizer (constraint solver) | Optimizer design (DFS, not season-long); MIT |
| dfs-with-r/coach | Optimizer | https://github.com/dfs-with-r/coach | R | GPL-3.0; 51★ | DFS lineup optimizer in R | Optimizer design; GPL |
| conorkcorbin/evolve-dfs | Optimizer | https://github.com/conorkcorbin/evolve-dfs | Python | MIT; 16★ | Evolutionary DFS optimizer | Optimizer design; MIT |
| jason-r-becker/dfspy | Optimizer | https://github.com/jason-r-becker/dfspy | Python | MIT; 7★ | Python DFS optimizer | Optimizer design; MIT |

## Category 3 — AI agents, MCP servers & LLM skills

| Name | Type | URL | Language/Platform | License/Access | What it does | Relevance to DraftKat |
|------|------|-----|-------------------|----------------|--------------|-----------------------|
| FantasyLab-ai/aurora | MCP server | https://github.com/FantasyLab-ai/aurora (registry: `io.github.FantasyLab-ai/aurora`) | Python/MCP | Licence unverified | "Glass-box" statistical analysis for agents: 19 methods, cited findings, zero invented numbers | Aligns with DraftKat's no-invented-numbers principle; candidate for a future MCP/skill layer |
| derekrbreese/fantasy-football-mcp-public | MCP server | https://github.com/derekrbreese/fantasy-football-mcp-public | Python | MIT; 39★ | Yahoo Fantasy MCP for Claude Desktop | Yahoo; MIT; agent pattern |
| KBThree13/mcp_espn_ff | MCP server | https://github.com/KBThree13/mcp_espn_ff | Python | MIT; 34★ | ESPN Fantasy API exposed to LLMs via MCP | ESPN + MCP pattern; MIT |
| MichaelCrowcroft/fantasy-football-mcp | MCP server | https://github.com/MichaelCrowcroft/fantasy-football-mcp | TypeScript | Licence not declared; 2★ | Fantasy football MCP | TS; licence unclear |
| gmendonc/sleeper-mcp-server | MCP server | https://github.com/gmendonc/sleeper-mcp-server | TypeScript | MIT; 1★ | Sleeper MCP server | Sleeper; MIT; TS |
| swcollard/sleeper-mcp | MCP server | https://github.com/swcollard/sleeper-mcp | TypeScript | MIT; 0★ | Sleeper MCP server | Sleeper; MIT; TS |
| evandiewald/sleeper-mcp | MCP server | https://github.com/evandiewald/sleeper-mcp | TypeScript | Apache-2.0; 0★ | Sleeper MCP server | Sleeper; Apache-2.0; TS |
| GregBaugues/tokenbowl-mcp | MCP server | https://github.com/GregBaugues/tokenbowl-mcp | Python | MIT; 6★ | Token Bowl MCP | MIT |
| jdguggs10/flaim | MCP platform | https://github.com/jdguggs10/flaim | TypeScript | MIT; 10★ | Fantasy Sports MCP Platform | TS; MIT; platform pattern |
| ArmchairAI/sleeper-mcp | MCP server | https://github.com/ArmchairAI/sleeper-mcp | unverified | unverified | Sleeper MCP | Details unverified |
| Druhayes/fantasy-football-mcp-public | MCP server | https://github.com/Druhayes/fantasy-football-mcp-public | unverified | unverified | Fantasy football MCP | Details unverified |
| carterfawson/fantasy-football-mcp | MCP server | https://github.com/carterfawson/fantasy-football-mcp | unverified | unverified | Fantasy football MCP | Details unverified |
| ConorMaley/uwg-mcp | MCP server | https://github.com/ConorMaley/uwg-mcp | unverified | unverified | MCP (scope unknown) | Details unverified |
| raddadengineer/fantasyfootball-mcp | MCP server | https://github.com/raddadengineer/fantasyfootball-mcp | unverified | unverified | Fantasy football MCP | Details unverified |
| bartjhv/fantopy-mcp-server | MCP server | https://github.com/bartjhv/fantopy-mcp-server | unverified | unverified | Fantasy MCP server | Details unverified |
| Kbtimko/dynasty-mcp | MCP server | https://github.com/Kbtimko/dynasty-mcp | unverified | unverified | Dynasty MCP | Details unverified |
| wr275/onside-football-mcp | MCP server | https://github.com/wr275/onside-football-mcp | unverified | unverified | Onside football MCP | Details unverified |
| JayMishra-source/Fantasy-Football-AI-CoManager | Agent | https://github.com/JayMishra-source/Fantasy-Football-AI-CoManager | unverified | unverified | AI co-manager | Details unverified |

DraftKat's own skill surface (`.opencode/skills/fantasy-recommendations/SKILL.md`) and in-process `FF_Orchestrator` are the internal equivalents; see the top-5 rationale below for why no external MCP server displaced a data/methodology pick.

## Category 4 — Commercial/SaaS tools & data sources

| Name | Type | URL | Language/Platform | License/Access | What it does | Relevance to DraftKat |
|------|------|-----|-------------------|----------------|--------------|-----------------------|
| FantasyPros API | API | https://api.fantasypros.com/public/v2 (docs `/public/v2/docs`; key request `https://secure.fantasypros.com/api-keys/request/`) | HTTP (JSON) | Requires API key (HTTP 403 without); `robots.txt` `Disallow: /api/ /json/ /xml/`; `llms.txt` at `/llms.txt` | Consensus rankings, projections, player points, news | High-value consensus data; key + ToS barriers. DraftKat already has `FANTASYPROS_API_KEY` env slot but no implemented source |
| FantasyCalc API | API | https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1 | HTTP (JSON) | Free, no key (HTTP 200); `robots.txt` allows all | Player values, tiers, trends (redraft/dynasty) | Clean free values/tiers source. See `docs/22c-fantasycalc-api.md` |
| DynastyProcess data | Data | https://github.com/dynastyprocess/data | CSV | CC-BY-4.0 inferred via nflverse-data; repo licence field unverified | Player-ID crosswalk, FantasyPros ECR, 1qb/2qb values, pick values | Crosswalk + baseline values; free. See `docs/22b-dynastyprocess-data.md` |
| Razzball | Site/feed | https://football.razzball.com | HTML/feed | Free tier (already integrated in DraftKat) | Rest-of-season projections | Already a DraftKat `ProjectionSource` |
| FFToday | Site | https://www.fftoday.com | HTML | Free tier (already integrated in DraftKat); no `robots.txt` | Projections | Already a DraftKat `ProjectionSource` |
| 4for4 | Site | https://www.4for4.com | Web | Commercial (HTTP 200); API/pricing unverified | Premium rankings/projections | Unverified API; paywall likely |
| Footballguys | Site | https://www.footballguys.com | Web | Commercial (HTTP 200); VBD article `https://www.footballguys.com/football/19/08/2019-value-based-drafting` (HTTP 200) | Rankings, articles, VBD methodology | VBD methodology reference; data paywalled |
| Underdog Fantasy | Site | https://underdogfantasy.com | Web | Commercial (HTTP 200); best-ball rules page returns 403 | Best-ball/DFS | Best-ball rules 403; not season-long format |
| Establish The Run | Site | https://establishtherun.com | Web | Commercial (HTTP 200); best-ball content HTTP 200 | Best-ball/DFS content | Best-ball content available |
| PFF (Pro Football Focus) | Site | https://www.pff.com | Web | Commercial (HTTP 200); best-ball article 404 | Player grades/projections | Best-ball article 404; data paywalled |
| Fantasy Life | Site | https://www.fantasylife.com | Web | Commercial (HTTP 200) | Rankings/content | Unverified API |
| SaberSim | Site | https://sabersim.com | Web | Commercial (HTTP 200) | DFS simulation | DFS; paywalled |
| Stokastic | Site | https://www.stokastic.com | Web | Commercial (HTTP 200) | DFS tools/ownership | DFS; paywalled |
| RotoWire | Site | https://www.rotowire.com | Web | Commercial (HTTP 200) | News/lineups | Unverified API |
| Fantasy Nerds API | API | https://api.fantasynerds.com | HTTP (JSON) | Paid ($399.95/yr NFL); TEST key returns stale 2021 data | ADP, draft rankings, auction values | Paywalled; stale test data |

## Category 5 — Workflows & methodologies

| Name | Type | URL | Language/Platform | License/Access | What it does | Relevance to DraftKat |
|------|------|-----|-------------------|----------------|--------------|-----------------------|
| Value-Based Drafting (VBD) | Methodology | https://www.footballguys.com/football/19/08/2019-value-based-drafting (HTTP 200) | Article | Free (article) | Draft by positional value over replacement | DraftKat lacks VBD; methodology to adopt |
| Boris Chen tiers (GMM) | Methodology | https://github.com/borisachen/fftiers | Python/GMM | Free (repo) | Cluster FantasyPros ECR into tiers | Tiering approach; see `docs/22e-fftiers-tiering.md` |
| Zero-RB / Hero-RB / Robust-RB | Methodology | https://establishtherun.com (best-ball HTTP 200; rotoviz 404; pff 404) | Articles | Mixed | RB-heavy or RB-light draft strategies | Strategy references |
| Best-ball drafting | Methodology | https://establishtherun.com (HTTP 200); underdog rules 403 | Articles | Mixed | No-lineup-management format | Format reference (not season-long) |
| ADP vs value / auction inflation | Methodology | (general) | Concept | — | Compare ADP to projected value; adjust auction prices for league inflation | DraftKat lacks ADP + auction context |
| Monte Carlo simulation | Methodology | (general; impl see DimaKudosh/pydfs-lineup-optimizer) | Concept | — | Simulate drafts/lineups to estimate outcomes | Could extend DraftKat's probabilistic models to draft |
| Bayesian blending | Methodology | DraftKat internal (`src/probabilistic`) | Internal | — | Blend sources via Bayesian EWMA | Already in DraftKat; reusable for draft inputs |
| DraftKat in-season workflow / human-approval gate | Workflow | `docs/20-draftkat-espn-agent.md`; `.opencode/skills/fantasy-recommendations/SKILL.md` | Internal | — | Autonomous eval + human approval queue | Existing; draft phase not yet covered |

## Gap Analysis

**What DraftKat already has (verified from `docs/20-draftkat-espn-agent.md` and source):**
- ESPN read adapter + request-built write actions (`src/adapters/espn/espn-platform-reader.ts`), cookie auth via `ESPN_S2`/`SWID`.
- Sleeper fixture + real adapter.
- `ProjectionSource` implementations for Razzball, FFToday, and ESPN; `ProjectionCandidate{name,team,positions,projected_stats,projected_points,floor,ceiling,confidence}`.
- `RecommendationCache` (file-backed, `DEFAULT_CACHE_TTL_MS = 3600000`; env `PMT_CACHE_TTL_MS`).
- Probabilistic Bayesian models (floor/ceiling, `P(x>τ)`) in `src/probabilistic/`.
- `FF_Orchestrator` + skills: `lineup-optimizer`, `waiver-scanner`, `trade-proposer`, `execute-or-queue`.
- Human-approval `ActionQueue` (`src/agents/action-queue.ts`).
- NFL calendar, `InMemoryScheduler` (`register/cancel/listJobs/start/stop`, daily `HH:MM`), and an in-season recommendation loop.
- `KnowledgeRepository` (`save/getLeagueSnapshot`, `save/getRecommendation`, `save/getDecisionAudit`, `listRecommendations`) and `PlatformReader` interface.

**What the surveyed tools do that DraftKat does not (or does better):**
- **Draft-phase coverage is the explicit gap.** DraftKat has no draft adapter, no VBD/VORP computation, no ADP source, no draft optimizer or simulator, and no tiering. Every in-season skill assumes a populated roster; nothing assists the draft itself.
- **Player-ID crosswalk** (DynastyProcess `db_playerids.csv`) for normalizing multi-source data — DraftKat has no canonical ID mapping.
- **Consensus rankings** (FantasyPros) — env slot exists but no source is implemented.
- **Free baseline values/tiers** (FantasyCalc, DynastyProcess) and a **dedicated ADP feed** (FantasyFootballCalculator).
- **Tiering methodology** (Boris Chen GMM) absent from DraftKat's point-based ranking.
- **Draft ranks / auction values / ADP directly from ESPN** (`kona_player_info`) — the one source DraftKat already authenticates to but does not yet read for draft context.

The single most important conclusion: DraftKat is strong in-season and weak pre-season. The five shortlisted integrations all target the draft-phase gap.

## Prioritized Top-5 Shortlist

Criteria weights: **architecture fit** (TS/SQLite/file-CSV consumable, recommendation-only, no-vendor-code preference), **ToS/auth safety** (no-key or already-authenticated, no `robots.txt` violation), **maintenance health** (recent activity, archived/abandoned penalized), **draft-phase coverage** (directly fills the gap above).

1. **ESPN `kona_player_info`** → `docs/22a-espn-kona-player-info.md`
   - Architecture fit: high (extends the existing ESPN reader; JSON → `ProjectionCandidate`/draft table in SQLite).
   - ToS/auth safety: high (DraftKat already holds ESPN cookies; read endpoint needs no new auth; no `robots.txt` conflict observed).
   - Maintenance: high (ESPN production endpoint, stable across seasons).
   - Draft coverage: high (PPR/STANDARD/SUPERFLEX/ELIMINATION ranks, `auctionValue`, `averageDraftPosition`).
   - Rationale: lowest-friction, highest-trust fill of the draft-rank/auction/ADP gap using credentials DraftKat already manages.

2. **DynastyProcess data** → `docs/22b-dynastyprocess-data.md`
   - Architecture fit: high (static CSV → SQLite import; no runtime dependency).
   - ToS/auth safety: high (open data; CC-BY-4.0 via nflverse-data; repo licence field unverified but data is published for consumption).
   - Maintenance: moderate (data refreshed periodically; not a code project).
   - Draft coverage: high (player-ID crosswalk + FantasyPros ECR + 1qb/2qb `values.csv` + pick values).
   - Rationale: supplies the missing canonical ID crosswalk and baseline values that make every other source normalizable.

3. **FantasyCalc API** → `docs/22c-fantasycalc-api.md`
   - Architecture fit: high (free JSON, trivial `ProjectionSource`/values table).
   - ToS/auth safety: high (no key; `robots.txt` allows all; HTTP 200 verified).
   - Maintenance: high (active commercial site returning live data).
   - Draft coverage: high (values + tiers + trends for redraft/dynasty).
   - Rationale: the cleanest legally-unencumbered external values/tiers feed.

4. **FantasyFootballCalculator ADP API** → `docs/22d-fantasyfootballcalculator-adp.md`
   - Architecture fit: high (free no-key JSON ADP per format/team count/year).
   - ToS/auth safety: **medium/flagged** (`robots.txt` `Disallow: /api/` — automated access is prohibited; must use a cached/manual snapshot or obtain permission, not live scrape).
   - Maintenance: moderate (site active; endpoint returned 200).
   - Draft coverage: high (the only verified free dedicated ADP source with `stdev`/`bye`/`total_drafts`).
   - Rationale: irreplaceable ADP input, accepted only with a documented ToS-mitigation (snapshot/cache, respect `robots.txt`).

5. **borisachen/fftiers** → `docs/22e-fftiers-tiering.md`
   - Architecture fit: moderate (Python repo; the GMM tiering method is portable to TS, and the public `weekly-*.csv` is directly consumable; `draft-*.csv` is 403).
   - ToS/auth safety: medium (weekly CSV public; draft CSV blocked; repo has no licence — do not vendor code, consume published data/method).
   - Maintenance: active (2025-09-08 last noted).
   - Draft coverage: high (tiers close the methodology gap left by point-only rankings).
   - Rationale: provides the tiering layer DraftKat lacks; methodology is the deliverable, not the code.

### Why no MCP server / LLM skill made the top 5

DraftKat already ships its own skill surface (`.opencode/skills/fantasy-recommendations/SKILL.md`) and an in-process `FF_Orchestrator` with a human-approval queue, so introducing an external MCP server adds transport/process complexity with little architecture fit. The fantasy MCP ecosystem is also dominated by low-star, single-platform (mostly Yahoo/Sleeper) servers, and the majority of the lower-star entries in Category 3 are `unverified` beyond name/language/stars. The two genuinely strong candidates are **FantasyLab-ai/aurora** (glass-box, cited, "zero invented numbers" — directly matching DraftKat's recommendation-only principle) and **KBThree13/mcp_espn_ff** (ESPN + MCP, MIT). Neither, however, outperforms the five data/methodology picks on the weighted criteria for DraftKat's immediate draft-phase gap: aurora is a statistics-method server that wraps other sources rather than supplying ADP/values/tiers of its own, and KBThree13 duplicates DraftKat's existing ESPN read capability. MCP/LLM-skill integration is therefore deferred to a follow-up phase — recommended as adopting aurora's glass-box *pattern* into DraftKat's own skill rather than running a separate server. The five filenames above are unchanged; if a later phase mandates one MCP pick, FantasyLab-ai/aurora is the strongest, but it would augment (not replace) the data sources and does not displace `docs/22a`–`docs/22e`.

## Not Recommended / Avoid

- **nflverse/nfl_data_py** — ARCHIVED (2025-09-25). Do not build new code on it; use only as a frozen reference.
- **mattdodge/yahoofantasy, rbarton65/espnff, FantasyFootballAnalytics/ffanalytics, jjti/ff** — licence not declared / none found. Licence incompatibility / redistributability risk; use as methodology reference only, do not vendor code.
- **FantasyFootballCalculator ADP API** — `robots.txt` `Disallow: /api/`. Automated access is prohibited; use only a cached/manual snapshot with documented permission, not live scraping.
- **FantasyPros API** — requires a paid key (HTTP 403 without) and `robots.txt` `Disallow: /api/ /json/ /xml/`. ToS-restricted; DraftKat has the env slot but no implemented source and must not scrape.
- **Fantasy Nerds API** — paid ($399.95/yr) and the TEST key returns stale 2021 data. Closed/paywalled; not worth integrating.
- **Underdog best-ball rules page (403) and PFF best-ball article (404)** — inaccessible; best-ball is not DraftKat's season-long format anyway.
- **Unverified low-star MCP servers** (ArmchairAI/sleeper-mcp, Druhayes/fantasy-football-mcp-public, carterfawson/fantasy-football-mcp, ConorMaley/uwg-mcp, raddadengineer/fantasyfootball-mcp, bartjhv/fantopy-mcp-server, Kbtimko/dynasty-mcp, wr275/onside-football-mcp, JayMishra-source/Fantasy-Football-AI-CoManager) — maintenance/licence/scope unverified; avoid until confirmed.
- **Copyleft / unclear-licence code items** (ffscrapr, ffopportunity, uberfastman/*, k5cents/fflr, dtcarls, flipperbw/FantasyPlus [MPL-2.0], mkreiser [LGPL-3.0], ffverse/ffpros [NOASSERTION]) — do not vendor into DraftKat's MIT-leaning codebase; consume published outputs (data), not code, where the licence permits.

## References / Links

- ESPN kona_player_info: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info`
- DynastyProcess data: `https://github.com/dynastyprocess/data`
- FantasyCalc API: `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1`
- FantasyFootballCalculator ADP: `https://www.fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=2026`
- borisachen/fftiers: `https://github.com/borisachen/fftiers`
- FantasyPros API: `https://api.fantasypros.com/public/v2` (key: `https://secure.fantasypros.com/api-keys/request/`)
- Footballguys VBD article: `https://www.footballguys.com/football/19/08/2019-value-based-drafting`
- FantasyLab-ai/aurora (MCP): `https://github.com/FantasyLab-ai/aurora`
- KBThree13/mcp_espn_ff (MCP): `https://github.com/KBThree13/mcp_espn_ff`
- DraftKat draft agent doc: `docs/20-draftkat-espn-agent.md`
- DraftKat skill: `.opencode/skills/fantasy-recommendations/SKILL.md`
- Related deep-dives: `docs/22a-espn-kona-player-info.md`, `docs/22b-dynastyprocess-data.md`, `docs/22c-fantasycalc-api.md`, `docs/22d-fantasyfootballcalculator-adp.md`, `docs/22e-fftiers-tiering.md`

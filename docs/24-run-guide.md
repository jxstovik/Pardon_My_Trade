# 24 — Pardon My Trade: Run Guide

Document ID: FDP-RUN-001  
Status: Guide  
Applies to: `main` (post `4638e17` merge)

A practical, command-by-command guide to every capability in Pardon My Trade as
of this commit, organized around the three moments that matter to you: **ahead of
your draft**, **during your draft**, and **during the season**.

Pardon My Trade is **recommendation-only**. It never auto-executes league moves.
Any action it considers high-risk (trades, drops) is queued for your explicit
approval via `pmt action-approve`.

---

## 0. Setup (do this once)

Requires **Node >= 20**.

```bash
npm install
npm run build            # compiles TypeScript to dist/ (required before any command)
```

Every command below is run as:

```bash
npm run pmt -- <command> [args...]
# or, equivalently:
node dist/src/cli.js <command> [args...]
```

Long-running modes (`daemon`, `serve`, `draft-watch`) stay in the foreground;
stop them with `Ctrl+C`.

### Environment

Copy `.env.example` to `.env` and fill what you need. The keys you will
actually use:

| Variable | Purpose | When needed |
|----------|---------|-------------|
| `PMT_DATA_DIR` | Where SQLite DBs, models, queue, and logs live | always (defaults to `./data`) |
| `ESPN_LEAGUE_ID` (+ `ESPN_S2`, `SWID`) | ESPN read/write credentials | `import-espn`, live `draft-watch` |
| `ESPN_SEASON` | Season year (default current year) | ESPN paths, `projections --auto` |
| `PMT_PROJECTION_SOURCES` | Comma list: `espn,razzball,fftoday` | richer projections/consensus |
| `RAZZBALL_USERNAME` / `RAZZBALL_PASSWORD` | Razzball premium session | `razzball-login`, premium projections |
| `FANTASYPROS_API_KEY` | FantasyPros public API bearer token | FantasyPros source (if wired) |
| `PMT_CACHE_TTL_MS` | Projection cache lifetime (default `3600000`) | tuning refresh |
| `PMT_SEASON_DAILY_TIME` / `_LINEUP_LOCK_TIME` / `_WAIVER_TIME` | Scheduled-job times (local) | `daemon` / `serve --scheduler` |
| `PMT_LEAGUE_EXTERNAL_ID` / `PMT_TEAM_EXTERNAL_ID` | Which league/team the scheduler advises | `daemon` / `serve --scheduler` |
| `PMT_DRAFT_STORE` | Durable manual draft-pick file | `draft-pick` / `draft-watch` (default `./.pmt/draft-manual.jsonl`) |
| `PMT_NEWS_PATH` | News/injury JSON for the refresh pipeline | `refresh`, scheduled jobs |
| `PMT_PORT` | Local GUI port (default `3000`) | `serve` |

---

## 1. Capability catalog

### A. League import & setup

| Command | What it does | Notes |
|---------|--------------|-------|
| `import-fixture` | Sanity-check the bundled demo snapshot | Read-only; reports counts. Good first smoke test. |
| `import-espn <leagueId> [season] [teamId]` | Pulls your ESPN league (roster, teams, free agents) into the SQLite store, seeds model priors from projections, and runs the orchestrator once. | Needs `ESPN_LEAGUE_ID`+`ESPN_S2`+`SWID`. Opt into extra sources via `PMT_PROJECTION_SOURCES`. Writes `data/pmt.db`, `data/models.json`, `data/last-snapshot.json`. |
| `import-sleeper <leagueId> [season]` | Read-only import of a Sleeper league snapshot. | Projections/news stay empty until a source is connected (`pmt serve`). |

### B. Projections

| Command | What it does | Flags |
|---------|--------------|-------|
| `projections <razzball\|razzball-premium\|fftoday\|espn> <position> [--week N] [--auto] [--ppr] [--force] [--no-save] [--persist] [--max N]` | Fetches a ranked projection board for a position and writes a Markdown recommendation file. | `--week N` targets a week; `--auto` resolves the current NFL week from the calendar; `--ppr` requests PPR; `--force` bypasses the 1h cache; `--no-save` suppresses the file; `--persist` writes matched players into the store (needs an imported snapshot); `--max N` truncates output. |
| `projections --clear-cache` / `--cache-stats` | Clears / reports the projection recommendation cache. | — |
| `razzball-login` | Authenticates to Razzball premium and stores a session cookie under `data/razzball-cookies.json`. | Needs `RAZZBALL_USERNAME` / `RAZZBALL_PASSWORD`. |

### C. Modeling & recommendations

| Command | What it does | Notes |
|---------|--------------|-------|
| `build-models <priors.json> [observations.json]` | Builds the Bayesian player-model set from priors (and optional observations) and saves to `data/models.json`; prints the top-10 by value. | `PMT_PRIORS_PATH` can supply the default priors path. |
| `ff-run <config.json> [--auto]` | Runs the `FF_Orchestrator` against a hand-written config (`input`, `priors`, optional `observations`). `--auto` auto-approves only low-risk actions. | Outputs lineup, waiver/trade candidates, and any queued high-risk actions. |
| `weekly-report [leagueId] [teamId]` | Runs the full weekly pipeline (projections + news/injuries + lineup evaluation) and emits one recommendation. | Defaults to the demo fixture (`pmt-demo-football` / `team-001`). |
| `refresh [leagueId] [teamId]` | One-shot refresh pipeline: projections + news → snapshot → advisories. | Defaults to the demo fixture. |
| `action-queue` | Lists pending high-risk actions awaiting your decision. | Reads `data/action-queue.json`. |
| `action-approve <actionId>` / `action-reject <actionId>` | Approves or rejects a queued action. | This is the human gate — nothing high-risk happens without it. |

### D. Live draft (scaffold)

| Command | What it does | Notes |
|---------|--------------|-------|
| `draft-pick <round> <roundPick> <teamId> <playerExternalId> [--pickNo N]` | Records a pick into the **durable manual backup** (JSONL at `PMT_DRAFT_STORE`). | The always-works operator path. Survives restarts and is readable by a separate `draft-watch` process. |
| `draft-watch [--espn-draft-id ID] [--interval-ms N] [--once] [--json]` | Runs the composite draft feed and prints picks as they arrive. `--espn-draft-id` adds the live ESPN poll (primary); the manual feed is **always** present as backup. `--once` does a single poll and exits; `--json` emits machine-readable events. | Poller is seconds-granular (default `15000` ms). Live ESPN feed is **unverified** — if it errors it silently contributes nothing and the manual feed carries the board. |

How the feed works: `FallbackDraftFeed` **merges** both feeds and de-duplicates
by `pickNo` (ESPN wins on conflict). This is deliberate — an unverified ESPN
endpoint that returns "success" with no picks must not wipe your manual board.

### E. In-season automation

| Command | What it does | Notes |
|---------|--------------|-------|
| `season-refresh [season] [week] [--force]` | Pulls every configured projection source, matches candidates to your roster, and persists them to the store. `--force` bypasses the cache. | Tolerant: unavailable sources are skipped and reported, not fatal. |
| `daemon [--run-now]` | Long-running scheduler (60s tick, keep-alive). Registers the three season jobs (below) and runs until `Ctrl+C`. `--run-now` also fires one daily cycle immediately. | Use this for a headless box. |
| `serve [--scheduler]` | Starts the local web GUI (default `http://localhost:3000`) and, with `--scheduler`, also starts the season jobs. | Best for interactive use. |

**The three scheduled jobs** (local time, auto-paused in the offseason):

| Job | Schedule | What it fires |
|-----|----------|---------------|
| `season-daily` | Mon–Sat, `06:00` (`PMT_SEASON_DAILY_TIME`) | Projection pull + advisory pass. |
| `season-lineup-lock` | Sun, `11:00` (`PMT_SEASON_LINEUP_LOCK_TIME`) | Pre-lock start/sit reminder. |
| `season-waiver-sweep` | Tue, `13:00` (`PMT_SEASON_WAIVER_TIME`) | Waiver + trade sweep. |

Notifications go to the console and to `data/notifications.log`. High-risk
actions are routed to the action queue, never executed on their own.

---

## 2. Playbook: ahead of your draft

1. **Install & build** (section 0).
2. **Connect your league.** For ESPN:
   ```bash
   export ESPN_LEAGUE_ID=... ESPN_S2=... SWID=...
   npm run pmt -- import-espn <leagueId> 2026
   ```
   This seeds `data/pmt.db`, `data/models.json`, and `data/last-snapshot.json`.
3. **Enrich projections** (optional but recommended):
   ```bash
   export PMT_PROJECTION_SOURCES=espn,razzball,fftoday
   npm run pmt -- razzball-login          # if you have premium
   npm run pmt -- projections fftoday rb --week 1 --persist
   npm run pmt -- projections razzball wr --auto --ppr --persist
   ```
   `--persist` writes matched players into the store your draft board will read.
4. **Validate your model**: `npm run pmt -- build-models data/models.json` and
   eyeball the top-10 by value.
5. **Dry-run the orchestrator** on your imported team:
   ```bash
   npm run pmt -- weekly-report <leagueId> <teamId>
   ```

> **Status note (be honest):** The draft-specific *intelligence* from doc 23 —
> the identity crosswalk (`pmt draft-ids-sync`), the merged static board
> (`pmt draft-board`), the valuation engine (VORP / tiers / survival), and the
> pick advisor (`pmt draft-advise`) — is **planned, not yet built**. What exists
> today is the **feed + poller + manual backup** scaffolding (section 1.D) and
> the widened ESPN client. So pre-draft you can import, model, and pull
> projections; the auto-recommendation loop lands in a later phase.

---

## 3. Playbook: during your draft

The tool is built to sit beside you and track the board; the live
recommendation agent is the next phase. Today:

1. **Open a tracking terminal** (this is your manual backup):
   ```bash
   npm run pmt -- draft-watch
   ```
   It prints every pick it sees. If you later add `--espn-draft-id <id>`, it
   also polls ESPN live (and falls back to manual automatically).
2. **Enter picks as they happen** (you, or a second terminal):
   ```bash
   npm run pmt -- draft-pick 1 1 team-001 4030 --pickNo 1
   npm run pmt -- draft-pick 1 2 team-002 4031 --pickNo 2
   ```
   Each write lands in `PMT_DRAFT_STORE` (durable), so a crash or a restart of
   `draft-watch` resumes cleanly.
3. **One-shot check** instead of a live loop:
   ```bash
   npm run pmt -- draft-watch --once --json
   ```
   Useful for piping the current board state into another tool.

When the doc-23 pick advisor lands, `draft-watch` will additionally emit a
recommendation on each state change (`pmt draft-advise` / `pmt draft-live`),
still routed through the human gate — never auto-picking.

---

## 4. Playbook: during the season

1. **Start the automation.** Headless:
   ```bash
   npm run pmt -- daemon
   ```
   Interactive (with GUI):
   ```bash
   npm run pmt -- serve --scheduler
   ```
   Confirm the three jobs registered in the startup log.
2. **Per-week projection refresh** (also happens automatically Mon–Sat):
   ```bash
   npm run pmt -- season-refresh 2026 1 --force
   ```
3. **Check advisories.** Each cycle writes to `data/notifications.log` and, for
   high-risk ideas, the action queue:
   ```bash
   npm run pmt -- action-queue
   npm run pmt -- action-approve <actionId>     # only when you agree
   npm run pmt -- action-reject <actionId>
   ```
4. **Spot checks any time:**
   ```bash
   npm run pmt -- weekly-report <leagueId> <teamId>
   npm run pmt -- projections fftoday qb --week 7 --ppr
   ```

The loop pauses automatically in the NFL offseason, so leaving the daemon up
year-round is safe.

---

## 5. What is built vs. planned (so you know what to expect)

**Built and runnable now**
- League import (ESPN, Sleeper), Bayesian model build, `FF_Orchestrator`,
  weekly report, projection fetch + cache + persist, action queue/approve gate,
  Razzball login, in-season scheduler (3 jobs) with notifications, local GUI,
  and the **draft feed + seconds-granularity poller + durable manual backup**
  with a widened ESPN client.

**Planned (doc 23), not yet implemented**
- Draft identity crosswalk + `pmt draft-ids-sync` (Phase 1)
- Static merged draft board + `pmt draft-board` (Phase 2, ESPN kona + FantasyCalc)
- Valuation engine: VORP, GMM tiers, ADP survival (Phase 3)
- `DraftState` reducer + snake maths (Phase 4, feed already scaffolded)
- Pick/auction advisor + `pmt draft-advise` / `pmt draft-live` (Phase 5)
- Draft-day hardening: `pmt draft-warm`, degraded-mode ladder, latency budget (Phase 6)

See `docs/23-live-draft-agent.md` for the full phase plan and
`docs/21-inseason-workflow.md` for the in-season loop design.

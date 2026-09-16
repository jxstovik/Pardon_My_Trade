# PMT Overnight Workflow (laptop)

Runs the full in-season loop in one command: ingest the completed week's actual
points from ESPN, update the Bayesian player models (with governance manifest),
refresh next-week projections, verify the projection store, export a snapshot,
run the team-7 weekly report, and run advisory orchestration (execution
disabled — nothing is ever submitted to ESPN).

## One-time setup on the laptop

1. Clone/copy the repo and install:

   ```bash
   npm install && npm rebuild better-sqlite3
   npm run build
   ```

2. Create `.env` in the repo root (never commit it):

   ```ini
   ESPN_LEAGUE_ID=98806880
   ESPN_SEASON=2026
   ESPN_S2=<your espn_s2 cookie value>
   SWID=<your SWID cookie value, with { } braces>
   ```

   To find them: log into espn.com in a browser, DevTools → Application →
   Cookies → copy `espn_s2` and `SWID`. These expire (roughly annually) —
   if the run fails with 401/403 from ESPN, refresh them.

3. Sanity check (must print all steps OK):

   ```bash
   python3 scripts/overnight/overnight_run.py
   ```

## Nightly schedule

The run is idempotent per week: observations already recorded are skipped, and
it exits cleanly when no week has completed yet (Mon–Sat it does the projection
refresh and report; Tuesday morning after Monday night it also does the model
update).

**cron (Linux/macOS):**

```cron
30 2 * * * cd /path/to/Pardon_My_Trade && /usr/bin/python3 scripts/overnight/overnight_run.py >> data/outcomes/cron.log 2>&1
```

**macOS with wake-from-sleep** (so the laptop runs it overnight even asleep):

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 02:25:00
```

## What you get in the morning

- `reports/overnight/<date>-W<n>-overnight.md` — the full run report:
  - model-update manifest (posterior update, promotion/rollback decision)
  - next-week projection counts per source (Razzball; ESPN/FFToday degrade with reasons)
  - team 7 ("Bored Man Gets Paid") weekly report, starters-scoped
  - advisory orchestration output: lineup, waiver add/drop candidates, trade candidates
- `data/historical-observations.json` — cumulative weekly observations (model priors)
- `data/outcomes/<season>-W<n>-points.json` — raw week points per player

Nothing is ever approved/executed automatically: waiver adds/drops and trades
land as *proposals* you review in the morning (via `npm run pmt -- action-queue`,
approve with `action-approve <id>`, then `action-execute` — or in the local GUI
via `npm run serve`).

## Known limitations (by design)

- The model update runs **without archived predictions**: no weekly-scale
  archived predictions exist yet (`probabilistic-projections.json` and the
  SQLite projection store hold season-scale means), so forecast-vs-actual
  calibration scoring is deferred until weekly-scale predictions are archived.
- DST team rows (negative ESPN ids) are excluded from the model update — the
  model store has no DST PlayerModels.
- ESPN and FFToday projection endpoints commonly 404/403 in-season; Razzball
  carries the projection load. Skipped sources are listed in the report, never
  silently dropped.
- The run needs the laptop awake for its duration (~3–10 min).

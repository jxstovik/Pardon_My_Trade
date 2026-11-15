---
name: pmt-weekly-scout
description: Generate current or upcoming weekly ESPN scouting reports with candidate NFLverse models, live rosters/free agents, news, lineup probabilities and browser/PDF/Obsidian artifacts.
---

# PMT weekly scouting

Use the configured league 98806880, team 7, season 2026. Both gateway and terminal chat can use the same pmt-read MCP tools. Never expose cookies, enable roster execution, promote models, or treat a report request as transaction approval.

1. Resolve the requested week and client date. `pmt_get_current_scoring_period` describes the current calendar; a specifically requested next week is a supported outlook. Do not substitute a stale report for that week.
2. Call `pmt_generate_scout_report` with `week` and optional `asOf` (ISO time from the user's date context if needed). It returns immediately with a job status; a running existing job is reused.
3. Call `pmt_get_scout_report` for that week until complete or failed. Space checks by at least 30 seconds while training. Never claim completion while status is running or failed.
4. Report current, recommended and opponent-optimized point means and win probabilities, source cutoff, matched/available coverage, news source degradation and model validation limits. Candidate models remain unpromoted.
5. Return the local standalone HTML, Markdown, PDF and manifest paths. Read the Markdown for detailed start/bench/stash/cut and news guidance. The interactive HTML provides aligned slot curves and legal roster swaps for both teams plus player distribution comparisons.
6. Carry only one defense: a streaming recommendation replaces the existing defense. No actual move is performed.

Terminal fallback (same deterministic workflow):

```bash
cd /home/jordan-stovik/Pardon_My_Trade
PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH" npm run scout:weekly -- --week 6
```

Replace 6 with the requested current/next week. If the host calendar needs the client date, append `--as-of 2026-10-14T16:00:00Z` using the actual user-provided date. A failed output-build step can resume existing artifacts with `--resume`; confirm their week, cutoff and live-read provenance first. That flag does not refresh inputs or models.

Existing gateway/terminal sessions should run `/reload-mcp` after PMT tools change; new sessions load the configuration automatically.

## Explicitly requested lineup changes

Use the separate pmt-operator connection. `pmt_prepare_lineup` accepts the configured leagueId/teamId and a complete `starters` array of `{playerId, slot}` with QB, RB, WR, TE, FLEX, DST or K. It freshly checks ownership, slot capacities, player eligibility and locks, queues exact changes and returns them without submitting. Review the action and require the user's explicit authorization before `pmt_action_approve` followed by `pmt_action_execute`. The executor rechecks period, roster fingerprint and locks; the writer checks member ownership and posts one ROSTER transaction containing each player's prior and new slot. Verify an executed receipt and a fresh ESPN roster. Never retry an unknown result. A recommendation alone is not execution authorization.

## Model-performance audit

For season predicted-versus-actual evaluation, call `pmt_start_model_evaluation` then poll `pmt_get_model_evaluation` at intervals of at least 30 seconds until complete/failed. Rank top 50 and top 150 by weekly pregame model mean, with position and FLEX breakdowns. The job retrieves ESPN season scoring history, freezes NFLverse inputs, builds weekly replay models using only prior data, and creates 45-degree plots with 80% predictive whiskers plus weekly/individual-player charts. Saved pregame Week 5 forecasts are reported separately from reconstructed replays. Missing scores must stay explicit; never pretend a replay was issued at the time or call predictive intervals confidence in a mean. Report D/ST target-scoring discrepancies, active/model status, source cutoff and limits. No roster actions or production model promotions occur.

Terminal equivalent: `npm run scout:evaluate` from PMT using its Node 26 runtime. Outputs are in `output/evaluation/2026-model-performance`. This evaluation currently supports season 2026 and requires a matching current scouting inventory; refresh the weekly scouting report first if roster membership has changed.

## Calibration and pregame archive safety

The season audit now independently scores captured D/ST raw counts with ESPN league rules and fits chronological interval calibration candidates. Each week's correction uses earlier outcomes only. Report before/after coverage and width, unchanged MAE, the final-week holdout and small-sample/dependence limitations. Historical 2015-2025 target-component parity is incomplete. Do not claim that a better coverage result is a promoted or approved model.

Weekly reports attempt immutable pregame archiving automatically. To save already-built candidate forecasts without retraining, use `pmt_archive_pregame_forecasts` with `week`; use `pmt_get_forecast_archives` to verify saved scope/hash/capture time. Terminal: `npm run scout:archive -- --week 6` with PMT's Node 26 PATH. Archives contain exact weights and forecasts, preserve prior snapshots, and reject capture/build at or after first kickoff. Never relabel a late refresh as pregame or put reconstructed predictions into pregame archives. Later audits select the latest verified pregame snapshot for each completed week, separately from causal replays. None of these tools executes an ESPN action or promotes a model.

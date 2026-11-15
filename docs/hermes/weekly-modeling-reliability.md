# Weekly modeling reliability: Week 8, 2026

## Supported recurring command

From `/home/jordan-stovik/Pardon_My_Trade`, after building with the supported Node 26 runtime:

```sh
export PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH"
npm run build
node scripts/weekly-planning.mjs
```

The new launcher runs the existing independently verified Tuesday projection wrapper first, consumes its **explicit published full-week target**, then runs the six-position weekly candidate trainer/report workflow for that exact week. It forces read-role/disabled execution in subprocesses. Failure of priors stops training; failure of training/publication fails the launcher. It does not install schedules or modify Hermes configuration. Do not overlap it with another repo/data writer.

`PMT_HISTORICAL_DATA_PATH` is not a prerequisite. The candidate trainer refreshes NFLverse statistics and rebuilds its candidates from completed outcomes. The separate generic `pmt_update_post_week_outcomes` endpoint still requires explicit observations or its historical-file configuration: it was **not** called or silently converted into an active-model update. Candidate retraining is not promotion, nor is the projection-only prior refresh learned-outcome training of the production store.

## Root causes and minimal changes

- The advisory calendar remains Week 7 on Tuesday October 27; using it as the forecast target would select the wrong priors. The existing Tuesday wrapper already correctly resolves the first whole upcoming published NFL week. The new launcher reuses that exact verified target instead of independently using the calendar or hardcoding Week 8.
- Generic post-week updating and isolated weekly candidate retraining are different data contracts. Calling the former without observations causes `Provide observations or configure PMT_HISTORICAL_DATA_PATH`. The recurring path now uses the existing NFLverse candidate pipeline, which has no dependency on that optional file.
- D/ST construction previously accepted unfiltered player/game outcomes, computed fill statistics, then applied a later fitting cutoff. Outcomes are now filtered **before feature construction**, including games, excluding requested/future weeks and future seasons.
- Checking only the maximum observed week did not prove completion. The trainer now fails before training if any published regular-season game through the cutoff is unfinished or missing from player statistics; its manifest records exact game/row coverage.
- The real run exposed opponent IR player Zach Charbonnet with no current-season NFLverse row. The former identity gate aborted the whole forecast. An authenticated OUT/IR roster entry with no statistical identity now has an explicitly labeled unavailable/zero lineup contribution, **not a fabricated statistical prediction**. Unknown active/ambiguous identities still fail closed. The exception is enumerated in the manifest.

## TDD and real execution

Each new behavior had a regression run red before minimal implementation, then green. The compiled launcher test failed with `weekly orchestration is implemented`; Python regression tests failed on missing causal-boundary/coverage/unavailable APIs before their implementation. Python tests require the existing bundled Python plus `data/scout-pydeps`, not the host Python 3.14.

```sh
npm test                      # 373 passed, 0 failed; includes build
npm run lint                  # passed
PYTHONPATH="$PWD/data/scout-pydeps:$PWD/python/scout" \
 /home/jordan-stovik/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
 -m unittest python/scout/test_weekly_reliability.py   # 3 passed
node scripts/verify-weekly-scout.mjs --week 8         # passed
```

Real launcher run with `env -u PMT_HISTORICAL_DATA_PATH` completed at `2026-10-27T12:35:39.296Z`:

- Week 8 priors: 670 freshly persisted ESPN projections, 1,055 prior models, 9/9 current starters covered.
- Full upcoming schedule: 14 games, 28 playing teams (wrapper validates all 32 teams and explicit byes).
- Completed training source: all 107 published games through Week 7, including all 14 Week 7 games; 2,608 offensive/K source rows, max observed week 7.
- Six candidate position models trained, unpromoted; 31 statistically modeled roster entries plus the explicit unavailable entry; 419 free-agent forecasts.
- Active prior store's final SHA-256 equals the wrapper's pre-candidate SHA-256: `7e3832977b68a8805dfab7dd53cbc005c2a401e04910e1004c31338a0619f78e`. Candidate training did not replace it.
- Verified immutable pregame archive with matching model version; old Week 6 archive retained. No ESPN writes, proposals, or promotion.

Artifacts (relative to repository):

- `data/weekly-projections/2026-W8.json`
- `artifacts/week8-2026-scout/manifest.json`
- `artifacts/week8-2026-scout/player-forecasts.json`
- `output/pdf/week8-scout/workflow-status.json`
- `output/pdf/week8-scout/reliability-verification.json`
- `output/pdf/week8-scout/week8-scout-interactive.html`
- `output/pdf/week8-scout/week8-scout-report.md`
- `output/pdf/week8-scout/week8-scout-report.pdf`
- `output/week8-planning-run.log`, `output/week8-tests.log`, `output/week8-lint.log`

The candidate report is advisory: current lineup mean 79.11; recommended 106.26; opponent optimized 93.92; modeled win probability against optimized opponent 67.4%. Independent player draws, conditional questionable-player forecasts, historical D/ST parity gaps, and retrospective validation limits remain. No roster action is implied, including dropping Aaron Rodgers.

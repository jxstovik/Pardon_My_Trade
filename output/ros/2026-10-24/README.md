# Week 7 recovery and ROS retrieval — 2026-10-24

## Outcome

Week 7 report recovered using existing candidates, then updated from the live post-acquisition roster. ROS pages were force-fetched through the project adapter and cached. ROS import remains blocked; no `2026-ROS` projections were inserted into the live database and no live model priors were rewritten.

## Weekly failure diagnosis and supported recovery

`output/pdf/week7-scout/workflow.log` shows that all six candidate models completed, producing 442 forecasts on October 24. The fatal failure was **after training**, in the PDF build stage: `MODULE_NOT_FOUND` for a hardcoded Codex `mark_artifact_operation_started.mjs` helper. The earlier archive rejection correctly refused to label an after-kickoff snapshot as pregame and was handled non-fatally.

Used existing flags (Node 26 runtime on PATH):

```sh
node scripts/weekly-scout.mjs --week 7 --resume --pdf-operation-started
node scripts/refresh-weekly-scout-rosters.mjs
node scripts/weekly-scout.mjs --week 7 --resume --pdf-operation-started
```

The resume flag does not fetch new model/statistical inputs. Verified candidate build: `2026-10-24T12:00:23.561399+00:00`, completed statistics cutoff Week 6, roster reread `2026-10-24T12:13:42.967Z`, report completion `2026-10-24T12:14:17.876Z`. Current owned roster: Aaron Rodgers starting QB, Josh Allen bench, Bo Nix absent. 16 owned players; 410 modeled matches of 894 available players. Candidate models remain unpromoted; refresh is not a pregame archive.

Generated files are under `output/pdf/week7-scout/`: `week7-scout-report.md`, `week7-scout-report.pdf`, `week7-scout-interactive.html`, `week7-scout-preview-bundle.zip`, `summary.json`, and `workflow-status.json`.

**Known report limitations:** the builder contains hardcoded prose claiming the opponent has a bye-week player and referring to Week 6 validation; do not treat those sentences as freshly verified facts. Displayed news retrieval dates include October 20 even though the news refresh succeeded October 24. Candidate points/probabilities are not the live deterministic ESPN priors and are not authoritative medical availability or ROS keep/drop valuations.

## ROS retrieval and parser fix

Corrected snapshot: `razzball-ros-corrected.json`. Full published tables: `published-ros-tables.csv`. Verification/owned-roster review: `verification.json`.

Fresh retrieval: `2026-10-24T12:15:47.910Z`–`2026-10-24T12:15:48.330Z`. All six pages publish the literal stamp **2026-10-24 05:07:39 AM EST**; no timezone correction was silently applied.

| Position | Raw rows | Adapter candidates |
|---|---:|---:|
| QB | 102 | 102 |
| RB | 163 | 163 |
| WR | 259 | 259 |
| TE | 147 | 147 |
| K | 40 | 40 |
| D/ST | 32 | 0 |
| Total | 743 | 711 |

The original mapper selected `1/2 PPR PPG` for `ppr`. Added a failing regression, fixed preference matching, then reran the live adapter from an **isolated compiled build**, not shared `dist`. Bijan Robinson now returns published full-PPR 27.9 PPG instead of half-PPR 25.5. The existing adapter returns per-game means; CSV preserves the actual remaining-total columns separately. The initial `razzball-ros.json` is diagnostic output from the broken parser and must not be used as corrected full-PPR data.

Code changes: `src/projections/source-table-mapper.ts`, `tests/source-table-mapper.test.ts`. Verification: 23 relevant tests passed and then **341/341** project tests passed from isolated `verification-build`; test log `verification-tests.log`. The isolated test layout includes an unchanged copy of the Tuesday wrapper under this directory's `scripts/` because those tests resolve it relative to the compiled test path. Parent must coordinate any eventual shared `dist` build with other active work; this task never rebuilt or cleaned shared `dist`.

## Remaining blockers

- D/ST source has a `Team` column but no `Name`/`Player` column; the current adapter yields zero candidates despite 32 raw rows.
- WR/TE/K/DST page titles say **2025**, while their Updated stamps say October 24, 2026. Preserve this source conflict; no unsupported season relabeling/import was performed.
- The refresh MCP accepts a week but has no explicit ROS-period parameter; omitting week selects the snapshot/current week. Do not call a weekly refresh an ROS import.
- Per-game means and a name-only review export are not certified league-wide ROS top-100 ranks. Missing ROS ranks must continue to fail closed for non-QB drop protection.
- Read-only database verification shows only `2026-W5` (650), `2026-W6` (659), and `2026-W7` (668) scoped projection rows. There is no completed ROS persistence.

No ESPN writes, action proposals, model promotions, Hermes configuration changes, or edits to the scoring child's ESPN reader/test files.

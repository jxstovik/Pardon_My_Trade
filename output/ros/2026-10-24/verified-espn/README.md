# Verified ROS ingestion — league 98806880 / team 7 / 2026

## Outcome

614 canonical ROS projections persisted through `SqliteKnowledgeRepository.upsertProjections(rows, '98806880')`, under period `2026-ROS`, source `espn-ros-remaining-weekly-sum`. Exact stored rows were read back and compared with every submitted record. Counts: QB 77, RB 136, WR 213, TE 123, K 33, DST 32. All 16 owned players are covered. 440 canonical universe entries fail strict identity/period/coverage/scoring checks and were excluded; this is not complete universe coverage or certified cross-position ROS rankings.

Snapshot: `espn-98806880-6d7bc216-275e-4a27-93e3-ea46d0ddaace`, repaired 47-rule scoring. The script validates exact league/team/season scope before proceeding. No ESPN mutations, proposals, model promotion, or weekly model writes. Before/after hashes verify non-ROS stored rows and `models.json` unchanged.

## Semantics and authoritative source

ESPN fantasy read endpoint, `kona_player_info`, requested independently for each Week 7–18. Source records must explicitly identify season 2026, requested scoring period, `statSourceId=1` and `statSplitTypeId=1`. Each player must match canonical ESPN ID, full name, NFL team and position. Each game's raw stats are normalized through the repaired ESPN stat dictionary and independently re-scored against the league's 47 rules; disagreement beyond rounding rejects the entire player.

`projected_points` is the **sum of the remaining game-specific league-scored forecasts**, not PPG or preseason points. Published mirrored schedule IDs identify every remaining game. Started/completed games and byes are excluded, including the already-played Patriots/Bears Week 7 game. Future TBD kickoff times do not invalidate a known NFL week/game identity. Coverage runs through NFL regular-season Week 18, not only the fantasy playoffs. `remainingGames` is scheduled team opportunities, not a medical prediction of player appearances. PPG is recorded separately in player provenance.

Independent diagnostic comparison: 580 accepted sums match ESPN current-season period-0/split-0 totals to rounding. All 32 DST seasonal applied totals differ from independently re-scored weekly sums; the weekly sums are retained, not substituted with a differently aggregated seasonal total. Two explicit-zero weekly players have no period-0/split-0 total. See `period-semantics-validation.json`.

No calibrated ROS uncertainty is available: canonical floor and ceiling equal the mean, explicitly representing an unmodeled range. Do not use these as calibrated quantiles. Do not mix ROS totals into weekly priors or use a default ROS model resolution for a weekly lineup. Use exact W7 projections for weekly decisions. No certified top-100 keep/drop ranks were created; non-QB drop protection must remain fail-closed.

## Razzball validation and parser repair

The Team-only mapper regression failed with zero candidates before the DST-specific fallback, then passed after the fix. Team-only offense tables still return no candidates. All 743 raw Razzball rows now parse, including 32 DST rows. Existing full-PPR fix is preserved; default mapper values remain PPG rather than being globally changed into totals.

`razzball-validation.json` preserves raw HTML hashes, literal titles and update stamps. It verifies contemporary body evidence against current ESPN identities/teams, including Fernando Mendoza (LV), Carnell Tate (TEN), Kenyon Sadiq (NYJ), Oscar Delp (NO), Isaiah Likely (NYG), Kenneth Walker III (KC), and Brandon McManus (LAR). These are body-level checks, not an inference from a fresh update stamp. WR/TE/K/DST titles still literally say 2025. Raw team-token matching is conservative and does not alias WAS/WSH or JAC/JAX. No Razzball page was blindly relabeled or persisted as league-scored totals.

## Files

- `receipt.json`: exact scope, schedule, source-week URLs/selectors/hashes, counts, owned totals and write verification.
- `canonical-projections.json`: exact 614 persisted Projection records.
- `player-provenance.json`: remaining games, per-game means and contributing weekly scores.
- `week-7.json` through `week-18.json`: original ESPN player-response data with timestamps and hashes.
- `schedule.json`: published ESPN NFL team schedules and source URL.
- `rejected.json`: excluded canonical entries.
- `razzball-validation.json`: source-season/body and parser review.
- `period-semantics-validation.json`: independent seasonal-total comparison.
- `ingestion.log`: last execution result.

## Reproduction

From `/home/jordan-stovik/Pardon_My_Trade`, with Node 26 and existing environment loader:

```sh
npm exec -- tsc -p tsconfig.json --outDir output/ros/2026-10-24/dst-verification-build
node scripts/ingest-verified-ros.mjs --self-test
node scripts/ingest-verified-ros.mjs --audit --build-dir output/ros/2026-10-24/dst-verification-build
node scripts/ingest-verified-ros.mjs --audit --reuse --persist --build-dir output/ros/2026-10-24/dst-verification-build
```

`--audit` performs read-only source discovery plus output-artifact writes, not database/model writes. `--persist` enables only canonical ROS projection upserts. `--reuse` requires intact source hashes and evidence younger than one hour. A fresh run omits `--reuse`. The script does not call `persistCandidates`, because that helper also rebuilds `models.json`.

Verification: isolated TypeScript compilation, all **344/344 project tests passed**, ingestion self-tests passed, exact repository read-back passed. Shared `dist` was neither cleaned nor rebuilt. Test log: `../dst-verification-tests.log`.

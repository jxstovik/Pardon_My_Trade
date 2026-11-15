# Football heartbeat — November 14, 2026

Trigger: 2026-11-14T19:06:40.865Z (14:06:40 EST), **13h 06m 40.865s late** to intended 01:00. Completed 2026-11-14T19:17:44.560Z. Stored automation is ACTIVE with `FREQ=WEEKLY;BYDAY=TH,SA,SU;BYHOUR=1;BYMINUTE=0;BYSECOND=0` and the existing target thread. Recurrence is correct; dispatch/app-availability cause is unproven. No schedule or destination changed. Worker remains gpt-6.1-sol / medium with no delegation or downgrade.

**DONT_NOTIFY:** The previously notified authentication block and actionable lineup recommendation are unchanged. Bench injury updates and source limitations are recorded below; no live action occurred.

Fresh ESPN scope is league 98806880 / team 7 / 2026, active Week 10, opponent 2,15 owned players and 902 available players. PMT calendar and live ESPN agree. Thursday kickoff already occurred; Week 11 was not selected. Scoring, starter/bench/IR counts, eligibility, locks and traditional waiver settings were refreshed. Private pending claims again returned `ESPN_AUTH_REQUIRED`; no retry or live-write attempt. Current-week canonical receipts show **0 completed acquisitions**, but private reservations and executable remaining capacity are **unknown**, under the five-acquisition cap. Week 9 swaps were excluded from Week 10 counting.

Isolated projection refresh persisted 689 ESPN rows and rebuilt 1,061 priors, covering all 9 starters. One normalized 48-hour news refresh ingested 65 ESPN and 0 Razzball items. Razzball was marked degraded: empty/unavailable/unmappable is unknown coverage, not no news. There are 301 unmapped stored items; source completeness remains unknown. Current injury watch, 14 individual owned-athlete reports, bounded candidate evidence and a Smyth role follow-up are retained with actual publication/retrieval times.

Fresh candidate **weekly-2026-W10-19789406c2bc-368dedd8bda2-d1284c4271e7**, built 2026-11-14T19:10:40.473294+00:00, remains `candidate_not_promoted`. Independent published-schedule checks show Week 9 is the latest fully completed week and Week 10 is incomplete. All 136 completed games through Week 9, including all 15 Week 9 games and 3,313 modeled rows, are covered with no missing games; later rows were excluded causally. All source/producer/horizon/DST hashes agree. Validation metrics and uncertainty are preserved in run.json. Production store remains unchanged (dc43a032e6ce4cd5cf841dbd7ef8b2596dc072090517453ba3afc27749f23b52); no promotion. The 487 forecasts cover 456 available players; 446 available identities remain unresolved.

Current lineup remains legal at **110.710** modeled points. Exact-slot preview still recommends **Wan’Dale Robinson for Rico Dowdle** in the starting lineup, reaching **111.170 (+0.460)**. WR/FLEX allocation may swap Jameson and Wan’Dale without changing the objective. The same result appears in the final preview. It was not applied: --execute, preparation, approval and submission were skipped under the known authentication failure. Nabers and Stevens are locked after Thursday; no bye/IR player is starting. These totals are model expectations, not live actual scores.

Shaheed is now ACTIVE, resolving the previous OUT-versus-full-practice conflict, but does not change the optimum. Freiermuth has a new Saturday illness/questionable tag and remains benched behind Kittle. Spears is questionable after full Friday practice; Pollard practiced fully Friday and has no designation. Harvey remains IR; the stale earliest-return article was preserved without renewing timestamps or inventing recovery bounds. No active probabilities were assigned.

Independent model comparisons below are not a combined executable plan. Same-position defense rotation preserves one D/ST; keeper opportunity cost is included in the legal-lineup horizon. Already-started unowned games were excluded from current-week automatic coverage; future-only claim value remains unresolved, not zero. Kicker alternatives from November 12 are no longer current-week options because Stevens is locked.

| Add | Drop | This week | Next three | Remaining season |
|---|---|---:|---:|---:|
| Colts D/ST | Saints D/ST | 3.204 | 7.104 | 6.063 |
| 49ers D/ST | Saints D/ST | 2.086 | 16.522 | 34.902 |
| Chiefs D/ST | Saints D/ST | 2.310 | 8.706 | 10.474 |
| Lions D/ST | Saints D/ST | 1.201 | 7.222 | 12.070 |
| Cardinals D/ST | Saints D/ST | 0.779 | 6.766 | 3.748 |
| Chargers D/ST | Saints D/ST | 1.709 | 9.662 | 8.537 |
| Emanuel Wilson | Pat Freiermuth | 1.135 | 1.135 | 3.135 |

Defense schedules confirm upcoming unit games, but published-at article provenance remains incomplete, so no submission-ready addition review was fabricated. Emanuel Wilson’s freshly retrieved November 11 report still confirms no offensive snaps in two games; he is excluded. Smyth’s latest retrieved article still describes practice-squad reversion and possible elevation, without confirmation. No redundant-TE drop is forced. No exact proposal was prepared.

**Confirmed ESPN writes: zero.** Canonical receipts/audit and production models are unchanged. A canonical migration lock dated November 12 is present and was preserved; isolated SQLite backup was used. No acquisition crash lock or reconciliation marker was found. No other active model/data writer was found. Post-kickoff pregame archiving and the known obsolete optional PDF publication path were skipped; no stale PDF was labeled fresh.

Next: restore the ESPN session and authenticate private pending moves before capacity or execution decisions; reconcile the preserved migration lock before canonical MCP startup if needed. Continue using the existing schedule. The controller may investigate late dispatch history, without creating duplicates or changing a correct recurrence speculatively.

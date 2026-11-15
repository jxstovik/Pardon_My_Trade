# Weekly basketball rankings and roster operations

League `mmioj1mvmvgsc3io`; team `wwc1n3o4mvn1c6hk`, **Board Man Gets pAId**. Balanced remains selected. Last manual implementation run: October 28, 2026, evening Eastern time. Draft is complete for our 14-player team; the full roster was freshly re-read after the draft.

## Verified cadence and implications

Fresh official [rules](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/rules) still say managers enter changes, executed **weekly every Monday**, locked **0:00 before scheduled game start**. Four G, four F/C and two Flex are active; four reserves; no IR. There is no turnover category: PTS, REB, AST, ST, BLK, 3PTM, FG%, FT% each earn a W/L/T. We optimize categories, not a fantasy-points sum.

We can research and revise a proposed lineup daily. The evidence does **not** support changing counted starters daily, rotating reserves between games, or treating Monday midnight/period boundaries as the lineup deadline. Per-player versus whole-roster lock, exact activation, timezone and the first period's exceptional Sunday start still need reconciliation. Until then, prepare before the week's games and do not promise later changes will count. No lineup writer was enabled by the draft-pick authorization.

Claims are unlimited, but priority rotates, waivers last two days with a 23-hour minimum, and undrafted players enter waivers. Twenty settled available rows freshly inspected after the draft all displayed **W (Fri)**. Friday is a displayed label for these players, not a verified processing instant or universal weekly waiver day. Acquisitions after a weekly lock may have no current-period value. No claim/drop/trade is submitted without exact human approval followed by separate execution.

## Operating rhythm

Use the **existing daily 02:30 America/New_York check**, preserving its identity and seasonal expiry. Its prompt now branches by local weekday:

| Run | Work |
| --- | --- |
| Every overnight run | Refresh roster ownership, relevant schedules and actual status/role evidence; recompute current and next-period watchlists only from genuinely refreshed inputs. Report material changes. |
| Thursday | Compare waiver candidates for the upcoming lineup, priority cost, clearance and next-two-period value; prepare reviewable proposals. |
| Friday | Check actual waiver results/clearance and ownership; remove acquired-by-others candidates and rerank. |
| Sunday | Produce the main coming-period lineup proposal, four reserves, sensitivity cases, alternatives and blockers. |
| Monday | Re-read schedules and status; final recommendation before any independently verified lock. If the lock passed or is unknown, flag it and withhold execution. |
| Following completed period | Archive the original forecast against frozen fantasy outcomes; distinguish corrections inside/outside the seven-day freeze. |

This cadence is a configured overnight check-in, not continuous injury monitoring or a guaranteed pre-lock service. Extra deadline-relative checks should only be scheduled after actual lock instants are verified. Keep the computer on and app running for local scheduled work, as described in [official OpenAI documentation](https://learn.chatgpt.com/docs/automations). Configuration and past successful firings do not prove future delivery. Preserve the explicit UTC-hour/DST adjustment procedure in the existing automation.

## Delivered first weekly engine

`src/basketball/weekly.ts`, exposed as `weekly-forecast` in the isolated basketball CLI:

1. Bind the approved corrected category board and weekly capture by content hash, league, team, season and exact player name/school/ID. Preserve baseline source times; a schedule refresh is not a forecast refresh.
2. Scale coherent conditional per-game lines by the games actually listed in the selected scoring-period date columns. Store game IDs and date labels. UTC instants remain null until verified. Missing schedule is **unknown**, never zero; cancellations/postponements are not usable appearances.
3. Rank projected production equally across eight categories. Six count contributions are divided by frozen category SDs; FG/FT impact uses `(makes - reference percentage × attempts) / SD`. This linear, unitless surrogate is schedule-sensitive and attempt-weighted. It is not a points scoring formula, expected category wins or a trained model.
4. Exactly optimize that linear objective under 4 G / 4 F/C / 2 Flex with dual eligibility and unique players. Show aggregate makes/attempts and unchanged fixed minutes-stress low/high totals, explicitly not confidence intervals. Incomplete owned-player data withholds the lineup rather than silently benching an unknown player.
5. Rank the inspected available-player cohort. Re-optimize after a hypothetical replacement to report marginal active-lineup value. Current active core is protected from hypothetical drops by the input policy for this first run; remaining replacements are research, not approved drops. No future-week retention/priority cost is fitted yet.
6. Surface freshness, health/role, schedule, lock, cap/minimum and activation blockers. Always advisory-only; zero live actions. Preserve immutable content-addressed reports.

### First real-data run

[Input capture](../../artifacts/basketball/2026-10-28/weekly/period-1-browser-capture.json): all 14 owned players plus 20 currently available waiver candidates, no unmatched identities. Browser field transcriptions, not raw API exports. The recorded observation time is a conservative lower bound for these post-draft reads. Available scope is the first Fantrax page in its displayed Score order, **not** an exhaustive model-ranked pool. Do not carry these availability labels into later runs without refresh.

The selected UI period is **1 (Nov 1–Nov 8)**, versus **JeffWischer**. Feroah has three displayed game IDs, James one, and the other 12 owned players two each. Conditional optimizer replaces **Karasinski with Feroah**, producing 21 listed active appearances versus the current lineup's 20. This requires confirmation of health/roles and counted-game eligibility before using it as firm lineup advice. It does not establish a win advantage. Cory Wells leads this limited waiver watchlist with three listed appearances; no claim/drop is recommended for execution.

Initial [report](../../artifacts/basketball/2026-10-28/weekly/reports/8b0186b7651859af8eacb04456fba90203d8168ff385edd5b27d67324c03eeb0/weekly-report.md). The approved draft baseline retains its oldest dependency time, October 27, and is flagged over 24 hours old for weekly operational advice. No new current-season rates, role checks, opponent forecasts or trained accuracy are claimed.

### Reproduce

Build first with Node 26 on PATH, then:

```sh
data/runtime/node-v26.11.1-linux-x64/bin/node dist/src/basketball/cli.js weekly-forecast \
  --board artifacts/basketball/2026-10-28/reconciliation/revisions/344df1b91ab3126860cc43ec650a4b03835d9846cf16e067717d4f78a5d203f1/corrected-category-board.json \
  --input artifacts/basketball/2026-10-28/weekly/period-1-browser-capture.json \
  --as-of 2026-10-29T01:57:11Z \
  --out artifacts/basketball/2026-10-28/weekly/reports
```

This reproduces analysis of saved evidence and does not refresh Fantrax. Never update observedAt during replay.

## Next development, in priority order

1. **Resolve operational rules and counted schedules:** inspect platform help/preferences and game detail pages for timezone/UTC, first-period locks and activation; verify cap/minimum/rounding. Reconcile all owned plus candidate game IDs, N/A opponent labels and exhibition/counting policy. Add a validated lock evaluator before any roster writer.
2. **Expand the actual waiver universe:** acquire a fresh allowed full available export, excluding all owned and other-team assets by stable ID; attach schedules to the model-ranked top candidates and position/defense specialists. Current 20-player first-page cohort is insufficient for a best-in-league pickup claim.
3. **Refresh minutes, rates and availability:** obtain public official/current Fantrax box scores and team status evidence for roster plus shortlist. Preserve player/school identity across transfers. Use preseason per-minute priors and explicit exposure shrinkage, then compare season and last-three/last-five minutes; separate DNP, out, zero minutes and missing. Do not double-count the same game or mix historical school stints silently. Fall back to labeled conditional priors when unsupported.
4. **Opponent-aware decisions:** capture JeffWischer and subsequent opponents' actual owned/active rosters and schedules with the same schema. Evaluate legal alternative lineups against shared category forecasts, with percentage attempt volume and uncertainty. Keep the production surrogate as baseline. Only add category-win probabilities after prospective or chronological calibration supports them.
5. **Model validation:** archive immutable pre-lock forecasts now, score availability, minutes, six counts and shooting makes/attempts after games, then weekly category margins and lineup regret. Compare fixed preseason, recent-only and shrinkage candidates on identical covered players/games and point-in-time folds. Include freshmen/transfers/low-minutes coverage, missing data and exclusions. No future injury or actual lineup leakage. Do not promote on a handful of opening games.
6. **Weekly policies and pivots:** compare Balanced/Guards/Bigs on the same schedule/status manifest. Show next-two-period retention, marginal gain over the current legal ten and waiver-priority/drop costs. Recommend a pivot only from sustained category opportunity; avoid daily punts driven by one noisy result. Higher-seed playoff ties increase the value of regular-season category wins.
7. **Execution, separately:** once rules, data and a supported roster writer are validated, offer exact owned-player lineup changes for approval and readback. Draft authorization does not enable in-season automatic roster moves. Claims/drops/trades keep exact per-action review. Store attempts and receipts; unknown result blocks retries.

## Validation record

Node 26 build passed before compiled testing. **67/67 compiled basketball tests passed**, including eight new weekly tests. The first sandboxed broad run failed only because existing copilot-server tests could not bind 127.0.0.1 (`EPERM`); rerun with permitted loopback access passed all 67. Weekly checks cover schedule volume, exact DP versus exhaustive subsets, weighted percentages, missing-vs-zero schedules, cancelled/out handling, identity/hash/scope, period boundaries, stale/future observations, started games and protected replacements. These tests establish arithmetic and control behavior, not forecast accuracy.

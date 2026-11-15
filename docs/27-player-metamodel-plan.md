# NFL player forecasts: source, model, and validation plan

## Goal and safety contract
Build player-level weekly fantasy point distributions and season-long roster value estimates for the imported ESPN league, with every forecast scored under that league's actual scoring configuration. Outputs are advisory: roster/lineup changes stay approval-gated and the workflow must never execute transactions automatically. Persist forecast cutoff, source timestamps, player ID mapping, scoring version, model version, uncertainty, and provenance.

## Source layers

1. **Historical outcomes and opportunity:** nflverse/nflfastR player-game and play-by-play-derived data, schedules, team/player identifiers, snaps/routes/targets/touches where available. Use it as the freely reproducible foundation; verify the feed's actual latest week before any update.
2. **Platform-specific outcomes/rules:** ESPN league settings, actual roster ownership, scoring-period projections, player IDs/news, and finalized fantasy scoring. ESPN is canonical for league context, not the sole feature source.
3. **Independent weekly forecast benchmarks:** Compare ESPN projections with at least one independently timestamped provider (FantasyPros API if licensed credentials are available; alternatively supported public weekly projections, with source stability/terms checked). Never assume projections are actual labels. Record provider ID, timestamp, scoring format and player crosswalk.
4. **Availability and news:** ESPN player-linked news/injury feed and team/NFL official injury/practice/inactive reports; optionally a licensed aggregator such as FantasyPros or SportsDataIO. Capture article/report publication time, observed time, canonical entity match confidence, structured event (practice, status, starter/workload/role change), and source URL. No scraping or API use that violates provider terms.
5. **Context:** schedule/opponent, venue, rest/bye, weather and market-implied environment when available with historical snapshots; omit features whose as-of history cannot be reconstructed.

## Entity and data quality
Use stable ESPN athlete IDs as the league join key and maintain explicit crosswalks to nflverse/provider identifiers. Do not match on display name alone. Reject/flag unmatched or ambiguous records. Store immutable raw snapshots and normalized player-game/player-week and team-game tables. Track nulls and coverage by season/week/position. Keep bye, inactive, limited participation and played-but-injured cases distinct; never fabricate zeros for missing feeds.

## Model stack

- **Baselines:** previous-season/rolling opportunity and ESPN/provider projection, scored with exact custom league settings.
- **Availability model:** probability active/usable using timestamped injury designation, practice participation, role/depth-chart and historical availability. Output point mass at zero plus conditional performance distribution.
- **Bayesian/state-space update:** preseason hierarchical prior shrunk by position/role; update weekly from completed actuals and usage with recency, injury/role-change variance inflation and cold-start pooling.
- **Position specialists:** interpretable quantile boosting for QB, RB, WR, TE and K; team-game model for D/ST. Include opportunity (attempts/routes/targets/carries/red-zone), opponent and team context; estimate quantiles, not only point means.
- **Ensemble/metamodel:** fit out-of-fold weights using only predictions available at each historical decision cutoff. Calibrate intervals/quantiles on prior walk-forward residuals. Promote added complexity only when rolling-origin metrics improve over simple baselines and calibration remains acceptable.
- **Season-long roster value:** simulate schedule, active probability, weekly distributions, bye weeks, role uncertainty and replacement-level/roster constraints; report expected total and range, not a falsely precise deterministic rank. Treat multi-week roster decisions separately from single-week start/sit.

## News augmentation and leakage control
News is an observed, timestamped feature, not an oracle. Keep original source/time and extracted event confidence. Only use information available by the historical forecast cutoff; late inactive reports can affect only forecasts after publication. Never let post-game reports/corrections leak into old forecast rows. Use structured events first; test text embeddings only against timestamped walk-forward baselines.

## Evaluation and promotion gates
Use season-held-out plus rolling week-ahead evaluation; score under the actual league rules. Report MAE/RMSE, pinball loss, CRPS or distributional score, rank/correlation for lineup decisions, interval coverage/sharpness, active-probability calibration and per-position/subgroup results. Compare against ESPN, consensus and simple prior baselines. Preserve model versions, training/data cutoffs, feature manifests, source health, decision records and rollback artifacts. No claimed improvement until evaluation artifacts exist; no historical Week 3 update until Weeks 1–3 coverage and scoring-period mapping are verified.

## Integration phases

1. Verify imported league snapshot/team identity, custom scoring mappings, available model artifacts, ESPN credentials handled only in approved secret storage, repo build/tests, data feed integrity and latest completed week.
2. Keep the public nflverse feed as a historical/actuals layer; integrate one external licensed projection/news source only after terms, key management and player crosswalk are confirmed.
3. Implement/validate source adapters and timestamped feature snapshots; write backtests with leakage tests before training any promoted metamodel.
4. Run advisory weekly lineup and season roster evaluations against real league roster, expose uncertainty and news citations; do not approve or execute queued actions.
5. Schedule refresh/recommendation jobs only after team identity and tool availability are confirmed. Reconcile by reading jobs back. Maintain explicit failure/degraded-source notifications.

## Current known limits to resolve before using live advice
- Existing NFL stats archive was observed to contain weeks 1–4; do not call this “through Week 3” without filtering and verifying week IDs/team-player mapping.
- ESPN live import must be rerun only with credentials loaded through the approved secret mechanism; no league credentials belong in chat, cron prompts, repo files, or shell history.
- Correct team identity must be confirmed by the user/platform ownership mapping before generating personal roster recommendations.
- No Hermes PMT MCP server or fantasy cron jobs are currently configured; don't describe them as installed.

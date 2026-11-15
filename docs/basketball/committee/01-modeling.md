# Basketball modeling committee proposal

Prepared 2026-10-25 for Fantrax league `mmioj1mvmvgsc3io`.

## Decision requested of the final planner

Build a category-distribution and schedule baseline first for **Banging 3s**, with immutable predictions and an evidence ledger from day one. Add a minutes-and-statistics probabilistic model only after the input and scoring contracts pass. Treat complex machine learning as a challenger that must earn activation through chronological evaluation. Most early actionable value is likely to come from correct game counts, legal lineup allocation, availability, and minutes; this is a hypothesis to test, not a measured advantage in this league.

This is a design proposal. No basketball model has been trained, backtested, activated, or shown to beat a benchmark in this work. League facts below come from the committee's field-level transcription of official Fantrax endpoints in [league-evidence.md](../league-evidence.md). It is not a complete saved raw response. Explicit competition/gender, lock policy, game/attempt minima and caps, transaction settings, and playoff tiebreaks remain unverified. Do not turn research defaults into inferred league rules.

Verified scope: eight teams; `HEAD_TO_HEAD_ROTI_MULTI_WIN`, awarding a separate category W/L/T; eight equally weighted categories `PTS`, `REB`, `AST`, `ST`, `BLK`, `3PTM`, `FG%`, and `FT%`; turnovers absent. Team **jxstovik** (`wwc1n3o4mvn1c6hk`) is user-confirmed and **Balanced** is the initial chosen strategy. Roster maxima are 14 total, 10 active, four reserves, with four `G`, four `F/C`, and two `Flx` active constraints. The period-one roster response is empty for every team; no personal player recommendation can be derived yet. Nineteen explicit periods include 17 regular and two playoff periods, beginning March 1 and March 8, 2027; four teams qualify. These period boundaries do not establish lineup-lock timing.

## Evidence and architectural boundaries

Reviewed `docs/03-architecture.md`, `docs/12-testing.md`, `docs/14-coding-standards.md`, `docs/27-player-metamodel-plan.md`, `docs/26-player-points-prediction-plan.md`, `docs/hermes/model-governance.md`, ADRs 0001/0002/0004/0005, and the `pmt-model-operations` skill. Relevant actual code includes `src/models/types.ts`, `src/rules/rule-engine.ts`, and `src/probabilistic/model-governance.ts`.

Reuse ports and adapters, immutable snapshots, deterministic scoring, source provenance, forecast archives, explainability, and candidate/champion comparison. Keep all statistical calculations and legality decisions in code. An LLM may extract a cited status event or explain a computed result; it must not supply an unrecorded projection adjustment, scoring rule, blend weight, or promotion decision.

The existing code is not already a college-basketball implementation:

- `Sport` includes `basketball`, but `Platform` does not include `fantrax`.
- `PlayerPosition` lacks basketball guard/forward position labels; its existing `C` does not establish basketball semantics.
- `ScoringSettings.scoring_type` is football-oriented. Category scoring, points aggregation, scoring windows, games caps, and Fantrax rounding require explicit contracts.
- The present linear scorer ignores `ScoringRule.conditions` and silently skips unavailable statistics. Neither behavior is acceptable as an implicit interpretation of an unknown basketball rule.
- `PostWeekOutcomeUpdateService` assumes one observation per player per NFL-style week and writes updated models even when its reported promotion decision is held/failed. It must not be reused as a basketball activation gate unchanged. Basketball needs game-level observations, multiple games per period, isolated candidate storage, and a separate active-model reference.

Keep basketball state, model IDs, data paths, scoring-period IDs, and scheduler configuration distinct from football. A failed basketball import must not alter the existing football workflow. Build TypeScript before executing compiled tests, as required by the repository's AGENTS instructions.

## 1. Establish what the model is trying to win

Capture a versioned, source-backed `BasketballLeagueRules` object from the actual Fantrax league before fitting a target. Populate the verified facts above and retain unknown competition/gender/division, rounding, lock behavior, minimum appearances/shot attempts, game/start caps, postponed/cancelled/makeup treatment, and waivers/acquisition settings explicitly. Preserve the 19 API period boundaries rather than calculating NFL weeks or fixed Monday hours. The seasonYear field `2026` is a Fantrax convention, while CBBD uses ending-year IDs; do not join those integer values directly.

The default research unit is a player-game statistical line, not a football week. Store real game IDs and explicit UTC tip times alongside source timezone and observed schedule versions. Fantrax's official fantasy accounting is authoritative for the league outcome; NCAA/team statistics provide a reconciliation source. Maintain physical game dates separately from fantasy period assignment so a makeup game cannot silently enter the wrong matchup.

**Primary Banging 3s target:** predict each counted player-game's joint vector of points, total rebounds, assists, steals, blocks, made threes, field goals made/attempted, and free throws made/attempted. Sum the six counting categories across the legal active roster and counted games. Compute `team_FG% = sum(FGM) / sum(FGA)` and `team_FT% = sum(FTM) / sum(FTA)` under the platform's minimum-attempt, zero-denominator, display-versus-comparison precision, and tie policies once those are verified. Averaging player percentages is invalid.

Simulate both teams and derive `P(win)`, `P(tie)`, and `P(loss)` for each of the eight categories. The regular-season objective is expected category wins, `sum_c P(win_c)`, with expected ties/losses reported separately; apply the platform's verified standings treatment of ties when known. A single weekly majority-win probability is not the regular-season objective for this multi-win format. Playoff optimization must wait for the 4–4/tiebreak rule rather than assuming a regular-season category objective and a playoff advancement objective coincide.

Balanced seeks gains across all eight categories without an unrequested punt. More games can improve counting categories while harming shooting percentages, so schedule volume is an input to joint category value, not a blanket command to maximize appearances. Turnovers incur no category penalty here: do not import a nine-category basketball ranking's turnover penalty or a generic fantasy-points score. Shot volume affects team percentage contribution; a high percentage on very few attempts is not equivalent to the same percentage on many attempts.

The following points-scoring function is a future multi-league extension, not this league's objective:

`fantasy_points(player_game, scoring_version) = sum(weight[stat] * observed_stat) + verified_bonuses`

The weights above are imported settings, not proposed standard values. Account for points, made/attempted/missed shots, three-pointers, rebounds and components, assists, steals, blocks, turnovers, fouls, or other fields only when configured. Avoid accidental duplication when a provider includes both totals and components. If Fantrax intentionally scores points and field goals separately, preserve that exact rule.

Bonuses for double-doubles, triple-doubles, thresholds, or period totals require their actual scope and exclusions. Nonlinear bonuses need the full joint stat line: scoring the mean stat line does not generally equal expected fantasy points. Apply the verified scorer to each predictive draw instead. A missing required stat is a missing label, not zero. Unsupported rules must surface a typed error and block the dependent projection.

Do not convert these category weights into an invented points sum. Strategy profiles select objectives and constraints; they do not secretly alter the underlying player forecast. Generalized support for season totals, head-to-head points, roto, or weekly game selection must preserve each format's exact aggregation and tie rules.

Acceptance: real completed Fantrax team-period examples reproduce the six counts, attempt-weighted percentages, category comparisons, and W/L/T outcomes, including zero attempts/minimums, DNPs, overtime, corrections, postponed games, and rounding. Until completed examples exist, synthetic examples validate implementation only and the adapter remains marked unverified. Bonus/negative-score cases apply only to the optional future points extension.

## 2. Primary-source data options and access constraints

The following are candidate sources, not installed integrations or proof that this league's entire pool is covered. Verify actual response schemas, competition coverage, license, and freshness before selecting one. Do not buy a subscription or open a new account as an unspoken dependency.

| Need | Candidate and verified evidence | Use and constraint |
| --- | --- | --- |
| Official definitions and outcome reconciliation | NCAA [men's statistics](https://www.ncaa.org/championships/statistics-and-records/mens-basketball/), [women's statistics](https://www.ncaa.org/championships/statistics-and-records/womens-basketball/), and [2025–26 statisticians' manual](https://fs.ncaa.org.s3.amazonaws.com/Docs/stats/Stats_Manuals/Basketball.pdf) | Consult official definitions and team/game reports when reconciling labels. These web resources do not establish a supported bulk API or blanket automated-use permission. Recheck the applicable season's manual. |
| Reproducible API for schedules, boxes, rosters, movement, and advanced data | CBBD [getting started](https://api.collegebasketballdata.com/getting-started), [coverage](https://api.collegebasketballdata.com/data-availability), and [games endpoints](https://api.collegebasketballdata.com/api/games) | Bearer key required for REST. Coverage is field- and season-dependent; broad requests can truncate. Verify men's/women's and league-pool coverage directly before adopting. Season IDs use the ending year: `2027` denotes 2026–27. |
| Public historical men's research corpus | [hoopR documentation](https://hoopr.sportsdataverse.org/) and [data repository license](https://github.com/sportsdataverse/hoopR-mbb-data/blob/main/LICENSE.md) | Provider documents men's ESPN/NCAA loaders. The cited data repository declares CC BY 4.0; retain attribution, exact release/hash, and change notices. Audit the selected asset's license and upstream conditions rather than assuming every linked source has the same license. |
| Public historical women's research corpus | [wehoop documentation](https://wehoop.sportsdataverse.org/) and [data repository](https://github.com/sportsdataverse/wehoop-wbb-data) | Women's college box scores, schedules, and rosters are documented. Select this branch if the league is women's; never silently substitute men's data. Verify chosen asset license and completeness. |
| Freshness monitoring for public archives | [SportsDataverse status](https://www.sportsdataverse.org/status) | Inspect actual release-through season and producer state; a successful download of an old release is not a fresh live feed. This status page was checked on 2026-10-25. |
| Licensed commercial alternative | [SportsDataIO college basketball API](https://sportsdata.io/developers/api-documentation/ncaa-basketball); [Sportradar women's schedule API](https://developer.sportradar.com/basketball/reference/ncaawb-schedule) | Documented vendor endpoints offer an alternative when scope, rights, reliability, or live needs justify it. Confirm exact competition, injury/player coverage, retention rights, rate limits, and real versus sample/trial data before purchase or integration. |
| Availability | [ACC reporting policy](https://theacc.com/sports/2025/8/28/availability-reporting.aspx), [SEC men's basketball regulations](https://storage.googleapis.com/secsports-prod/upload/2025/10/09/bd7f8ab9-003d-481a-a781-d99a17ed5685.pdf), official team pages | ACC policy covers conference basketball contests and specifies night-before and pregame reports, with consecutive-day exceptions. Policy scope differs by conference and season. Do not assume uniform reports for every college game. |
| Championship availability | [NCAA March 4, 2026 announcement](https://www.ncaa.org/news/media-center-ncaa-releases-penalty-and-process-details-for-march-madness-player-availability-reports/) | Describes a 2026 men's/women's championship pilot. It does not prove a universal regular-season program or unchanged 2027 tournament policy. |
| Transfers and eligibility | [NCAA transfer rules overview](https://www.ncaa.org/eligibility-center/transfer-rules-and-eligibility/), [January 2026 basketball window announcement](https://www.ncaa.org/news/media-center-division-i-cabinet-adopts-new-transfer-windows-in-several-sports/), [October 2026 update](https://www.ncaa.org/news/division-i-cabinet-approves-new-transfer-windows-in-several-sports/) | Use official team rosters and explicit eligibility/availability decisions as current evidence. Portal entry, commitment, a roster listing, and eligibility to play are different facts. Rules change; do not infer an individual's clearance from portal timing. |

CBBD's [current terms](https://collegebasketballdata.com/terms), effective August 12, 2026, permit private caching, historical analysis, backtesting, and model training, while limiting raw-data redistribution and requiring secure, nontransferable keys and quota compliance. Product-specific licenses can differ. Store raw responses privately; publish our derived reports and forecasts under the applicable terms. Preserve source URL, access date, license reference, and raw-payload hash.

Sports Reference explicitly has [data-use restrictions](https://sportsreference.net/data_use.html) and [bot limits](https://www.sports-reference.com/bot-traffic.html). It should not become the default automated training source merely because pages are readable. No anti-bot circumvention belongs in this workflow. KenPom, Torvik, news outlets, and any commercial projection source are optional later integrations only after permitted use and timestamped availability are established.

## 3. Canonical data and label quality

Create immutable raw snapshots and typed normalized tables for competition, season, team-season membership, player, player-team stint, game, schedule-version, player-game box, status-event, forecast, and finalized fantasy outcome. Preserve provider-native IDs and a canonical crosswalk to Fantrax IDs. Never join on display name alone: duplicate names, suffixes, accents, transfers, and same-named schools can collide. Ambiguous mappings are quarantined; a human resolution becomes an auditable mapping record.

Each source observation carries `event_time`, `published_at` when available, `observed_at`, `source`, `source_record_id`, `payload_hash`, and correction lineage. Every feature row carries the latest time at which its inputs became available. Store season span (for example `2026-27`) independently of provider integer season to avoid off-by-one joins.

Use explicit participation states: played; played-limited; confirmed DNP with reason when sourced; scheduled; postponed; cancelled; and unknown/missing. Do not create phantom zero performances for unscheduled dates or missing boxes. Finalized Fantrax zeros may be valid fantasy labels, but the conditional performance model must distinguish them from a played zero-stat game. Unknown missingness cannot be retrospectively relabeled as injury without evidence.

Validate schedules against rostered teams and the actual eligible free-agent universe, including relevant games against non-Division-I opponents or tournaments if this league counts them. Deduplicate rescheduled games by stable game identity. Check makes do not exceed attempts, stat component identities, duplicate player-game rows, final-game status, overtime metadata, and roster membership dates. Retain corrections as new versions; never rewrite old forecast inputs.

## 4. Baselines before machine learning

Use the simplest available auditable baselines and benchmark them on identical player-games:

1. Platform projection, if actually available with its as-of timestamp and scoring basis. If only final/current projections exist, archive them prospectively rather than inventing historical projections.
2. Previous-season per-minute box-stat rates with partial pooling and a separate current minutes/availability prior. For new players, use a pooled cohort prior from historical training seasons.
3. Rolling/recency-weighted current-season minutes and rates, shrunk toward the preseason prior. Select lookback and shrinkage parameters on earlier chronological training/validation folds; do not invent convenient conversational weights.
4. Schedule baseline: eligible expected games multiplied by per-game projection, then routed through the legal roster optimizer. Report counted games separately from scheduled games; caps, slot congestion, lock rules, and bench days can make them differ.

The first usable output should expose source coverage, projected counted games, mean per-game output, availability flags, and replacement alternatives. It must not present a precision-formatted probability of winning before simulation calibration exists.

For Banging 3s, value players through marginal expected category wins after legal lineup assignment. A waiver player can have a high schedule total but add no usable starts, or worsen a close percentage category. Include acquisition cost and opportunity cost under the selected strategy once limits are verified. Per-category z-scores may be a transparent draft heuristic but are not substitutes for opponent-aware, attempt-weighted simulation.

## 5. Proposed probabilistic model

Separate the model into explainable components:

- Availability/participation probability, using sourced pregame status and prior participation. Unknown coverage increases uncertainty. A conference's published status percentage is a reported definition, not evidence of calibrated individual probabilities in our model.
- Minutes conditional on participation, allowing role, starter uncertainty, foul trouble, blowouts, coach rotation, rest, and teammate availability. Forecast distributions, not only the last game's minutes. Team-level simulation must respect total available player-minutes and overtime.
- Player stat rates conditional on minutes and game environment: attempts and shooting accuracy, rebounds/opportunities, assists, steals, blocks, turnovers, and any configured scoring fields. Hierarchical pooling handles small samples. The first opponent/pace adjustment should be simple and learned only from past games.
- Joint simulation with shared game pace, team opportunities, teammate competition, and game script. Preserve correlation across statistics for bonuses, across teammates for role changes, and across opponents for matchup risk. An independent normal draw for every player's fantasy score is an explicit benchmark approximation, not a calibrated final model.

Obtain expected category output by aggregating each sample under the league's actual counting/percentage comparison rules, with period assignment and lineup/cap constraints enforced. Output per-stat means, medians, quantiles or joint samples; makes/attempts; participation probability; expected minutes; forecast horizon; rule version; input snapshot; model version; and degradation reasons. Team reports show category W/L/T probabilities, expected category wins, and percentage-attempt uncertainty. Preserve a generic points scorer only for future leagues that actually need it.

Begin with an interpretable hierarchical/state-space model or equivalent pooled minutes/rate baseline. A quantile boosting challenger can model nonlinear interactions once the data contract works. A neural model, transfer embedding, news embedding, or learned ensemble requires independent evidence that its extra cost improves the selected decision objective. Fit ensemble weights from out-of-fold forecasts only.

## 6. Cold starts and regime changes

Preseason and early season are separate evaluation regimes. Returning players retain uncertain rate priors while minutes depend on their new roster context. Transfers carry player identity/history across schools, while team pace, opponent strength, coach, role, and teammate competition reset appropriately. Test whether and how prior production translates across competition levels; do not assume a fixed discount. Freshmen, international recruits, junior-college transfers, and uncovered players receive explicit cold-start priors and wider uncertainty rather than fabricated college history.

Recruiting grades, exhibition results, reported starters, and external projections are optional timestamped inputs with source rights and coverage recorded. They must prove value by cohort and season. Do not equate a preseason roster listing with clearance to play or a coach's vague comment with a guaranteed minutes allocation.

Role changes should update the minutes distribution and its uncertainty. Preserve played-but-injured outcomes in actual performance; never remove bad games with hindsight. The state update uses finalized prior games only. Train a return-from-absence adjustment only if historical evidence supports it; otherwise expose scenarios and wider uncertainty.

## 7. Chronological validation and leakage controls

Use rolling-origin splits by game date within earlier seasons plus a wholly held-out recent season. Retain a separate season-start test. Fit preprocessing, priors, team ratings, hyperparameters, calibration, and blend weights on the training side of each split. Random player-game splits are inappropriate because team context and later games would leak backward.

Explicitly forbid these historical features unless their as-of version exists: end-of-season efficiencies, later transfer destinations, final roster roles, corrected future box scores, closing betting lines obtained after prediction time, current injury flags applied to old games, and postgame news. CBBD's ratings endpoint is a candidate data source, not proof of pre-tip historical snapshots. Reconstruct past-only ratings or omit the feature from retrospective tests. Public archives that cannot establish original observation time support a clearly labeled retrospective statistical study; they do not prove real-time executable performance.

Archive predictions before the decision cutoff and score them before ingesting outcomes into the next model state. Late news may update a future forecast version but cannot overwrite the earlier forecast being evaluated. Weekly results aggregate frozen eligible game forecasts under the same rule snapshot. Use grouped uncertainty estimates by matchup/day/team where appropriate rather than treating highly correlated player-games as independent trials.

Evaluate three levels:

| Level | Evidence |
| --- | --- |
| Player/game | MAE, RMSE, mean bias; proper probabilistic score such as CRPS or pinball loss; interval coverage and width; availability Brier/log score and reliability; minutes error |
| Cohorts and horizon | Returning/transfer/freshman; observed/missing status coverage; conference and data source; high/low usage; first games versus later season; forecast lead time |
| Fantasy decisions | Legal-lineup category wins and regret; per-category W/L/T calibration; expected category wins; marginal category contribution per acquisition; cap/lock violations; roster turnover/cost; playoff outcomes as secondary, high-variance evidence |

Historical league transaction/ownership history may be incomplete. In that case, run lineup evaluation with the documented available roster and treat waiver-policy replays as constrained scenarios. Do not claim realized waiver profit using players who may never have been available. Opponents' realized future transactions cannot become features available to the simulated manager.

## 8. Evaluation and promotion contract

Proposed gates are acceptance requirements for the implementation, not claimed existing PMT thresholds or measured results. Numerical tolerances, sample-size rules, decision-cost weights, calibration bands, and statistical confidence settings must live in a versioned evaluation configuration and be fixed before the final test. Estimate them from training-fold variation and the league's decision costs; do not choose them after seeing a favored candidate's results. The planner should not copy football's one-sample default gate into basketball.

Required gates:

1. **Data/scoring correctness:** all required rules supported; reconciled scored fixtures; duplicate/unmatched/missing cases handled explicitly; no source-rights or competition-scope ambiguity for activated inputs.
2. **Chronology/reproducibility:** frozen cutoffs, immutable prediction IDs, manifest hashes, replayable transforms, and automated leakage tests. All hyperparameters and preprocessing fitted on the correct side of the split.
3. **Forecast evidence:** compare candidate, champion, and simple baselines on identical holdout cases; disclose excluded coverage and cohort metrics. Added complexity requires useful improvement in the preregistered primary probabilistic/decision metric and no unacceptable calibration or key-cohort regression under the stored policy.
4. **Operational shadow:** complete real refresh→forecast→legal recommendation→outcome ingestion cycles before activation; test stale source, missing status, reschedule, duplicate job, restart, schema change, and model-load failure. A healthy baseline remains available.
5. **Activation/rollback:** persist candidate artifacts separately, retain the champion and rollback reference, and atomically change a versioned active-model pointer only after its activation contract is satisfied. Keep recommendation provenance bound to the model that generated it.

Until evaluation passes, show the baseline and a clearly labeled research challenger. Never claim a model is calibrated because it emits intervals, or better because it has more features. No model was promoted in preparing this document. The user's current broad automation request authorizes implementation work; follow the separately established model-activation and platform-action policies when those concrete operations become reviewable.

## 9. Staged implementation with reviewable outcomes

| Stage | Deliverable | Acceptance criterion |
| --- | --- | --- |
| A: league contract | Verified Fantrax rules/raw snapshot; basketball-only domain types; exact scorer | Unknown fields remain explicit; scorer fails on unsupported rules; synthetic cases pass and real platform examples reconcile when available. No live advice depends on missing critical settings. |
| B: data foundation | Fixture adapter, canonical IDs, schedule/box/status schemas, source/license ledger, immutable raw storage | Reproducible offline import; unambiguous rostered-player mapping; coverage report by required stat and pool; corrections do not alter previous snapshots. |
| C: baseline | Prior/rolling joint stat forecasts, schedule allocator, category replacement-value report | Every number traces to a rule/source/version; counts and attempt-weighted percentages are correct; game counts agree with period and verified lock constraints; deterministic fixtures cover congestion, DNP, and reschedules. |
| D: research replay | Walk-forward dataset builder and benchmark report | Baselines share exact samples; train/test cutoffs enforced; missing as-of information disclosed; no unfounded historical platform-projection comparison. |
| E: challenger | Minutes/rates uncertainty model and calibrated forecast artifact | Preregistered evaluation contract passes on held-out evidence; cold-start and unavailable-status cohorts reported; challenger remains isolated while gates are unmet. |
| F: operational shadow | Scheduled source checks, prospective forecast archive, outcome scoring, model-health report | Repeated complete causal cycles; idempotent runs; failover and rollback demonstrated; freshness/degradation visible to recommendations. |
| G: continuing operation | Daily status/schedule/forecast refresh and post-final outcome update; periodic candidate retraining | Baseline always available; active reference changes audited; strategy switches use the same scoring/rule truth; no platform move is inferred merely from a model update. |

The final planner should prioritize A–C now and start prospective archival immediately after lawful source access and league identity are verified. A personal model becomes credible through that accumulating evidence; the presence of a training script alone is not completion.

## 10. Decision rhythm and pivotable strategy inputs

The model supplies a stable distribution; the strategy layer supplies a separately versioned objective. The user's chosen **Balanced** mode is the default. Candidate pivots are category floor/availability preservation, targeted category attacks, explicit single-category punts, short-horizon category streaming, season asset growth, and playoff schedule preparation. Show the expected category wins sacrificed/gained and the costs of reversibility. Do not recommend a punt just because a familiar nine-category template does; turnovers are already absent, all eight remaining categories count equally, and this format records each category result separately.

Refresh rhythm should follow verified Fantrax deadlines and official source release times. A reasonable implementation pattern is a daily schedule/roster reconciliation, reports after relevant availability releases, recomputation before the actual next lock, and outcome ingestion after games become final. It is a proposed pattern, not a statement of this league's lock schedule. A news event should trigger a source-backed status update and new forecast version, with duplicate suppression and freshness checks.

For pivots, show projected counted games; category means and makes/attempts; category W/L/T probabilities and expected wins; downside/upside; acquisition usage; retained season value; and uncertainty. Derive probabilities from joint opponent-aware simulation and label uncalibrated research estimates. Never guarantee wins or let an LLM substitute an appealing narrative for the optimizer's calculation.

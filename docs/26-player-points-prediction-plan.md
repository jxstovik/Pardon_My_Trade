# Fantasy Football Player-Points Prediction Plan

**Status:** Draft for review  
**Scope:** QB, RB, WR, TE, K, DST  
**Primary targets:** preseason forecasts and sequential weekly forecasts with means, predictive distributions, and calibrated intervals

## 1. Recommendation at a glance

Build a **hybrid hierarchical forecasting system** rather than making a neural network the only source of truth:

1. **Availability model** estimates whether a player/team unit will be active and usable.
2. **Hierarchical Bayesian/state-space model** supplies the preseason prior and the weekly posterior update.
3. **Position-specific quantile models** provide a strong, interpretable tabular challenger.
4. **Joint multi-task neural network** learns shared relationships across positions and same-game outcomes.
5. **Position-specialist neural models** provide a focused challenger with explicit cross-position inputs.
6. **Out-of-fold metamodel** combines these forecasts and calibrates their distributions with conformal methods.

The initial production candidate should be the **Bayesian prior + specialist quantile model + calibrated ensemble**. Architect the joint neural model in parallel, but promote it only if walk-forward evaluation shows better aggregate probabilistic quality without unacceptable calibration or maintenance cost.

This design meets the goal of using preseason forecasts as priors while allowing each completed week to update the next forecast.

### Review defaults

- Use **half-PPR** for the first end-to-end benchmark, while keeping scoring fully parameterized for Standard and PPR.
- Model **DST at team-game level** and K at kicker-game level.
- Begin with the 2010–latest-completed-season range, subject to source coverage and documented exclusions.
- Produce both per-game forecasts and season-total simulations. Season totals should be simulated from expected games active multiplied by the conditional per-game distribution, rather than trained from artificially zero-filled missed games.

## 2. Modeling contract

Every forecast is made as of a specific cutoff:

```text
forecast_id
season
scoring_period
player_or_team_id
position             # QB, RB, WR, TE, K, DST
prediction_cutoff    # timestamp
training_cutoff      # timestamp
scoring_format       # standard, half_ppr, ppr
mean_points
median_points
quantiles            # q05, q10, q25, q50, q75, q90, q95
predictive_samples   # optional; preferred for downstream simulation
active_probability
model_version
inputs_and_sources
```

The target is **actual fantasy points under the configured scoring rules**. Expert rankings, ADP, and third-party projections may be features or priors, but they are never substituted for actual outcomes in the training label.

Use a versioned scoring configuration. At minimum support Standard, half-PPR, and PPR, with explicit handling for passing, rushing, receiving, kicking, return, sack, turnover, defensive touchdown, points allowed, and yardage rules.

## 3. Data foundation

### 3.1 Historical data

### 3.1.1 No-future-leakage invariant

At every forecast cutoff, every feature must be reconstructible from information available at kickoff of the target game. This applies to raw facts, news text, injury status, depth charts, rolling aggregates, model-derived cross-position inputs, and metamodel weights. A post-game correction may improve a source table but must not overwrite the historical as-of snapshot used by a prior forecast. Each feature row therefore carries both `event_time` and `available_time`, and tests must reject `available_time > prediction_cutoff`.

### 3.1.2 Suggested source classes

Start with the widest reliable historical window available, preferably 2010 through the latest completed season. Store raw immutable source data and a normalized feature layer. The minimum fact grain is one row per player-game, plus one row per team-game for K and DST.

Required sources or source classes:

- Offensive and defensive game logs, preferably from `nflfastR` or an equivalent play-by-play-backed source.
- Schedule, opponent, venue, bye, kickoff time, and weather.
- Depth charts, starter designation, offensive-line context, and role changes.
- Injury reports, practice participation, inactive lists, suspensions, and returns from injured reserve.
- Historical player/team news with publication time and entity resolution.
- Optional historical betting totals, spreads, and implied team totals when available. If not available historically, do not fabricate them; use a documented proxy or omit them.

### 3.2 Canonical entities

Create stable IDs for players, teams, games, seasons, and news entities. Preserve team changes. News must be resolved to canonical player/team IDs with confidence and provenance rather than joined by display name alone.

### 3.3 Position-specific target units

- **QB, RB, WR, TE:** player-game actual fantasy points.
- **K:** kicker-game actual fantasy points, with team and venue context.
- **DST:** team-game actual fantasy-defense points, not a sum of individual defensive-player fantasy scores.

## 4. Cleaning and availability policy

Naively converting every missing player-game row to zero teaches the performance model that injured stars are intrinsically poor performers. Separate **availability** from **performance conditional on playing**.

Create a row-level status contract:

```text
did_play: boolean
play_status: played_full | played_limited | out_injury | out_coach |
             out_suspension | bye | rest | out_other | unknown
snap_pct: nullable numeric
points_actual: nullable numeric
status_as_of_kickoff: categorical
status_source_timestamp: timestamp
```

Rules:

1. **Bye weeks** are not observations and are never zero-point performances.
2. **Inactive, suspended, rested, or otherwise did-not-play rows** remain in the availability dataset with active target `0`, but are excluded from the conditional performance target.
3. **Players who play and leave early** remain in the performance dataset. Include snap percentage, limited-participation flags, and an in-game injury indicator so the model can distinguish partial opportunity from ordinary low production.
4. **Actual fantasy points remain the authoritative target**. The separation only prevents the conditional performance model from treating nonparticipation as ability.
5. **Final forecast distribution** is a mixture:
   - probability mass at zero from non-availability;
   - conditional points distribution from the performance model when active.
6. **Unknown missingness** is not silently classified as injury. Flag it, quantify it, and exclude or sensitivity-test it.
7. **Historical status must be as-of kickoff.** Post-game reports cannot be used in a pre-kickoff feature row.
8. A player returning after multiple missed weeks receives an explicit return-from-absence feature and wider uncertainty.
9. Rookie and low-sample players use pooled positional/team priors with wider intervals; they do not receive invented historical performance.

The final expected value is approximately:

```text
E[points] = P(active) * E[points | active]
```

For simulations, use the full mixture rather than multiplying a point estimate.

## 5. Features

All features must have an as-of timestamp and be generated without looking past the target kickoff.

### 5.1 Common features

- Age, seasons of experience, prior-season and career production.
- Rolling and exponentially weighted volume: attempts, carries, targets, routes, snaps, red-zone opportunities.
- Usage share and team pace.
- Team offensive/defensive strength and opponent-adjusted efficiency.
- Home/away, rest days, bye status, travel, weather, surface, and game time.
- Depth-chart rank, starter certainty, role competition, and offensive-line availability.
- Opponent strength by relevant unit and recent defensive tendencies.
- Preseason projection/rank sources as optional external prior features with source, timestamp, and match quality.

### 5.2 Position-specific features

- **QB:** pass attempts, air yards, rushing expectation, pressure rate, offensive-line continuity, pass-defense matchup, receiver availability, team total proxy.
- **WR:** route and target share, air yards, red-zone share, slot/outside role, quarterback quality and expected attempts, secondary matchup, teammate target competition.
- **RB:** carry/target share, goal-line role, route participation, backfield competition, offensive-line availability, run-defense matchup, game-script proxy.
- **TE:** route share, target and red-zone share, quarterback/coverage matchup, blocking role, competing pass-catchers.
- **K:** offensive scoring expectation, field-goal attempt environment, weather/wind, venue, coach tendencies, extra-point opportunity.
- **DST:** opponent QB pressure/interception/sack tendencies, opponent pace and turnover rate, implied scoring environment, defensive injuries, special-teams context.

### 5.3 Cross-position context

Use known pre-kickoff information, not target-week actuals:

- WR/TE models receive the QB prior or QB forecast distribution and expected team attempts.
- QB models receive expected receiver availability and target concentration.
- RB models receive offensive-line availability and opponent run-defense context.
- DST models receive opposing QB and offensive turnover/sack features.
- K models receive team scoring and touchdown/field-goal opportunity features.

Cross-position model outputs used as features must be generated out-of-fold during training to prevent target leakage.

## 6. Historical news augmentation

News is both a structured status source and a contextual feature source.

### 6.1 Structured event extraction

Convert articles and reports into timestamped events:

- out, doubtful, questionable, probable/active;
- practice participation and upgrades/downgrades;
- expected starter, snap limitation, workload restriction;
- return from IR or suspension;
- depth-chart promotion/demotion;
- coaching or scheme change;
- teammate injury affecting role.

Use recency decay so late-week and game-day information has greater influence. Retain the original text, source, timestamp, extraction confidence, and canonical entity IDs.

### 6.2 Text features

Build two tiers:

1. A transparent baseline using event categories, TF-IDF/SVD, keyword flags, and recency counts.
2. An embedding representation from a frozen text encoder, evaluated only if it improves out-of-sample probabilistic metrics.

Do not allow post-kickoff corrections or final inactive designations into historical pre-kickoff rows. News is an input signal, not a substitute target and not proof of causality.

## 7. Forecasting architecture

### 7.1 Preseason prior model

Train season-by-season, with each validation season held completely out. Produce:

- per-game conditional performance distribution;
- expected games/active probability;
- full-season total distribution;
- player/team latent ability and uncertainty;
- prior artifact containing mean, variance or samples, feature snapshot, and model version.

Build three preseason candidates:

1. **Hierarchical Bayesian model:** partial pooling by position, player, team, and role; explicit uncertainty and natural cold-start behavior.
2. **Quantile gradient boosting:** LightGBM/XGBoost/CatBoost-style tabular model for nonlinear interactions and strong benchmark performance.
3. **Tabular MLP ensemble:** useful as a neural baseline, but not assumed superior.

### 7.2 Sequential weekly update

At the start of a season, initialize the player state from the preseason posterior:

```text
latent ability_0 ~ preseason posterior
```

After week `t` completes, update using only observations and news available before week `t+1`:

```text
posterior_t = update(prior_{t-1}, actuals_t, usage_t, news_t, availability_t)
forecast_{t+1} = posterior_predictive(posterior_t, schedule_{t+1}, context_{t+1})
```

Recommended implementation is a dynamic hierarchical model or Kalman-like state-space update with:

- shrinkage toward the preseason prior early in the season;
- recency decay or time-varying latent ability;
- variance inflation after injury, role change, team change, or uncertain status;
- separate availability state and conditional performance state.

In parallel, weekly quantile models may be refit or warm-started on walk-forward data. Their inputs must include preseason prior mean, variance, quantiles, and samples so the model learns when to trust the prior versus current usage.

### 7.3 Predictive distributions

Use multiple uncertainty mechanisms and compare them:

- Bayesian posterior-predictive draws.
- Quantile regression at q05, q10, q25, q50, q75, q90, and q95.
- Deep ensembles across seeds and folds.
- MC dropout only as a tested approximation, not an automatic calibration guarantee.
- Conformal calibration on out-of-fold residuals or nonconformity scores.

The final output should provide a mean, median, quantiles, interval coverage, and preferably 500–2,000 predictive draws. Distinguish **predictive intervals** from parameter confidence intervals: users need uncertainty about the next fantasy score, not only uncertainty about model coefficients.

## 8. Joint model versus specialist models

### Approach A: connected joint multi-task neural network

One model handles all six positions with a shared representation and position-specific output heads.

Suggested structure:

```text
player/team/opponent embeddings
        + numeric context and news features
        -> position-aware encoders
        -> shared trunk with residual blocks and layer normalization
        -> position-specific distribution heads
        -> availability head + conditional-points head
```

Use a distributional objective such as Gaussian/Student-t negative log likelihood, mixture-density output, or discrete/quantile distribution loss. Add auxiliary heads for team points, team pace, target share, and defensive pressure where appropriate. Auxiliary tasks encourage the shared layer to represent game-level relationships.

**Expected benefit:** learns QB-WR/TE co-movement and game-level dependencies without manually creating every interaction.  
**Risks:** position imbalance, negative transfer, underfitting specialist behavior, and difficult calibration.

### Approach B: position-specific specialists with concurrent inputs

Train separate QB, RB, WR, TE, K, and DST models. Each receives position-specific features plus explicitly defined cross-position context.

Examples:

- WR: QB prior distribution, QB expected attempts, teammate availability, opponent coverage.
- RB: offensive-line context, expected game script, opponent run defense.
- DST: opposing QB pressure and turnover features, offensive scoring environment.
- K: team scoring distribution and weather.

Use quantile GBMs and specialist neural nets as separate challengers. Cross-model features must be out-of-fold in training and frozen at forecast time according to the relevant cutoff.

**Expected benefit:** better specialization, easier explanations, and simpler failure isolation.  
**Risks:** manually specified relationships may miss emergent dependencies; independently generated forecasts can be incoherent.

### Recommended comparison

Do not decide by architecture preference. Run both approaches under identical chronological folds, scoring rules, feature availability, and target definitions. Evaluate:

- aggregate quality across all positions;
- quality for each position;
- calibration and interval width;
- performance after injury/news events;
- robustness across seasons and player experience groups;
- training and inference cost;
- interpretability and operational failure rate.

Use a blended production model if the approaches have complementary errors. The joint network should be the **flagship research architecture**; the specialist stack should be the **production baseline and challenger**.

## 9. Metamodel and ensemble

Train a constrained superlearner only on out-of-fold predictions from the Bayesian, GBM, specialist NN, and joint NN systems. Inputs should include each component's distribution summaries, prior age, availability probability, news bucket, and data coverage.

Recommended metamodel behavior:

- learn weights by position and forecast horizon;
- favor preseason priors early in a season and current usage later;
- increase uncertainty when component models disagree;
- preserve noncrossing quantiles;
- calibrate final intervals using rolling conformal calibration;
- optionally combine predictive draws rather than point estimates.

Do not train the metamodel on in-sample component predictions. Do not let it learn from a future week's actuals or news.

## 10. Evaluation design

### 10.1 Backtesting

- **Preseason:** leave-one-season-out or expanding chronological season splits.
- **Weekly:** walk-forward evaluation. For target week `t`, train/update only through the prior week's cutoff. Where the training window permits, use a one- to two-week embargo between training and validation boundaries to expose timing leakage and reduce dependence between adjacent observations.
- **Player grouping:** test cold-start and low-sample players separately; avoid entity leakage from future embeddings or future team assignments. Include grouped sensitivity analyses by player and season, while preserving a realistic expanding-time split for the headline result.
- **News:** replay only what was published by the simulated cutoff.
- **Source corrections:** retain the original as-of snapshot used for each historical forecast; do not retroactively replace it with a later corrected injury or depth-chart record.
- **Stress subsets:** injury return, limited participation, role change, rookie, team change, home/away, early/late season, kicker weather, DST mismatch.

### 10.2 Baselines

Every report must compare against:

1. Position mean.
2. Previous-season per-game mean.
3. Recency-weighted rolling mean.
4. Preseason prior without weekly updates.
5. Simple availability × conditional-average model.

Complex models must demonstrate improvement over these baselines rather than only reporting their own scores.

### 10.3 Metrics

Point accuracy:

- MAE and RMSE by position and overall.
- Bias and error by forecast horizon.
- Spearman rank correlation for lineup/ranking usefulness.

Distribution quality:

- CRPS as the primary full-distribution score.
- Pinball loss by quantile.
- 50%, 80%, and 90% interval coverage.
- Interval width and Winkler/interval score.
- Calibration plots and probability-integral-transform diagnostics where applicable.

Decision quality:

- top-N hit rate and regret versus baseline;
- simulated lineup points using the forecast distribution;
- performance of injury/news subsets;
- bootstrap confidence intervals for model differences;
- Diebold-Mariano tests when sample size and dependence assumptions are reasonable.

Report both overall robustness and specialized accuracy. A model that wins only at QB but degrades K/DST should not be labeled the overall winner.

## 11. Required visualizations

Produce a reproducible evaluation report containing:

- actual-versus-predicted plots by position;
- weekly actuals with mean and 80% bands for representative players;
- nominal-versus-observed interval coverage curves;
- CRPS, MAE, RMSE, and interval-score comparisons by position and model;
- residual distributions for healthy, questionable, returning, and limited players;
- coverage by season and position;
- feature attribution plots for GBM specialists and the metamodel;
- prior-to-posterior plots through the first six weeks;
- disagreement plots showing when joint and specialist models diverge;
- joint-model embedding visualization colored by position/team;
- news-bucket error decomposition;
- forecast dashboard with mean, quantiles, active probability, and sample distribution for each position.

Visualizations are evidence for modeling practice, not decoration. Every chart needs the fold definition, target, scoring format, and sample size.

## 12. Implementation phases

### Phase 0 — contract and data audit

- Freeze scoring rules and canonical schemas.
- Inventory source coverage by season, position, and field.
- Build entity resolution and as-of timestamp checks.
- Produce a missingness and status-quality report.

### Phase 1 — cleaned feature store

- Implement raw-to-normalized pipeline.
- Add availability/status rows and partial-game flags.
- Build historical news event table and baseline text features.
- Add feature-generation tests that fail on future timestamps.

### Phase 2 — preseason prior system

- Implement hierarchical Bayesian model.
- Implement quantile GBM and tabular MLP baselines.
- Persist prior artifacts and predictive draws.
- Generate initial model card and preseason backtest.

### Phase 3 — weekly state updates

- Implement posterior/state update logic.
- Replay each historical season week by week.
- Add prior features to walk-forward GBM/MLP models.
- Validate injury and return-from-absence behavior.

### Phase 4 — competing neural architectures

- Implement Approach A joint multi-task model.
- Implement Approach B specialist models with out-of-fold concurrent inputs.
- Add deep ensembles, distributional losses, and uncertainty sampling.

### Phase 5 — metamodel and calibration

- Generate out-of-fold component forecasts.
- Train constrained superlearner.
- Add conformal calibration and quantile crossing repair.
- Produce full predictive samples and interval tables.

### Phase 6 — evaluation and deployment

- Run the complete backtest and visualization suite.
- Select production champion by probabilistic and operational criteria.
- Register model artifacts, feature snapshots, provenance, and limitations.
- Integrate weekly refresh and monitoring without automatic roster actions.

## 13. Suggested subagent assignments and models

Subagents should work from contracts and artifacts, not rewrite neighboring components. Each must leave source code, tests, a model card, data scope, leakage checks, and reproducible commands.

| Subagent | Responsibility | Recommended technical models/tools |
|---|---|---|
| Data engineering | Ingestion, canonical IDs, cleaning, feature store, status logic | Python/pandas or Polars, DuckDB/Parquet, Great Expectations-style checks, SQL validation |
| News and availability | As-of news replay, event extraction, entity resolution, active model | Rule-based baseline + TF-IDF/SVD; logistic or calibrated gradient boosting; embedding experiment later |
| Bayesian prior | Preseason distributions and sequential state updates | PyMC/NumPyro if available; hierarchical Student-t model; Kalman/state-space update |
| Tabular baseline | Strong nonlinear benchmark and quantiles | LightGBM or XGBoost quantile models; isotonic/conformal calibration |
| Joint NN | Approach A shared multi-task architecture | PyTorch; embeddings, residual MLP trunk, Student-t/mixture or quantile heads, deep ensemble |
| Specialist NN | Approach B six position-specific models | PyTorch; compact position-specific encoders, cross-position OOF inputs, position-specific losses |
| Metamodel | Combine distributions and calibrate | Constrained linear/stacking superlearner, quantile stacking, conformal prediction |
| Evaluation | Backtest, metrics, statistical tests, visualizations | scikit-learn, scipy, matplotlib/seaborn/plotly; bootstrap and Diebold-Mariano tests |
| Platform integration | Artifacts, schemas, weekly refresh, monitoring | Existing TypeScript PMT interfaces, versioned JSON/JSONL artifacts, provenance metadata |

### LLM model guidance for coding subagents

Use the strongest reasoning/code model for the data contract, Bayesian state-space design, joint architecture, and metamodel review. Use a fast code model for repetitive adapters, fixture generation, metric plumbing, and visualization boilerplate. Do not let a subagent select a production model from intuition: model promotion must be based on the shared walk-forward evaluation artifact.

A practical delegation order is:

```text
Data/cleaning -> news/availability -> Bayesian + GBM + NN in parallel
             -> metamodel -> evaluation -> platform integration
```

The Bayesian and GBM baselines should be implemented before neural optimization. They provide a defensible fallback and reveal whether additional neural complexity is justified.

## 14. Acceptance criteria

The system is ready for review when it can:

- generate preseason forecasts for QB, RB, WR, TE, K, and DST;
- generate week `t+1` forecasts after replaying only weeks through `t`;
- show actual-target provenance for every training row;
- distinguish inactive, bye, partial-game, and ordinary low-score observations;
- use historical news only as known at the forecast cutoff;
- output means, distributions, and calibrated intervals;
- compare joint and specialist approaches under identical folds;
- beat or explainably match simple baselines on CRPS and interval score;
- produce the required visualizations and model cards;
- persist model version, cutoff, inputs, scoring format, and limitations with every forecast.

## 15. Open review questions

1. Which fantasy scoring formats must be supported in the first implementation: Standard, half-PPR, PPR, or all three?
2. What minimum historical season range and source coverage are acceptable for K and DST?
3. Should external preseason projections be included as features, priors, or both, with separate ablation tests?
4. Is a full text-embedding pipeline justified for the first release, or should structured news events be the initial production path?
5. Should the production champion be selected globally or separately by position when results differ materially?

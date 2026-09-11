# Plan 27 — Local Model Training, Data Inspection, and Feature Discovery

**Audience:** the owner training Plan 26 models on a local laptop with 16 GB RAM and an i7 CPU.

**Primary objective:** make model training inspectable and repeatable. Every local run should make it possible to answer:

1. What data entered training and testing?
2. What information was available at the forecast cutoff?
3. Which features were used, missing, or suspicious?
4. Which model won under chronological validation?
5. Did a new feature improve the model without creating leakage or overfitting?

**Scoring default:** full PPR (`fp_ppr`). Half-PPR and Standard remain configurable. Do not compare runs made with different scoring formats as if they were the same experiment.

---

## 1. Local environment setup

Use a dedicated Python environment. Do not install training packages into the system Python.

```bash
cd Pardon_My_Trade
python -m venv .venv-plan26
# Windows PowerShell:
.venv-plan26\\Scripts\\Activate.ps1
# macOS/Linux:
source .venv-plan26/bin/activate

python -m pip install --upgrade pip
python -m pip install -r laptop/requirements-training.txt
```

Recommended packages:

```text
numpy
pandas
pyarrow
scipy
scikit-learn
lightgbm
matplotlib
seaborn
jupyterlab
ipykernel
tabulate
tqdm
joblib
PyYAML
```

For the joint neural network:

```bash
python -m pip install torch
```

Use the CPU wheel if the laptop has no compatible GPU. A GPU is optional; the workflow must remain valid on CPU.

Record the environment before every release:

```bash
python --version
python -m pip freeze > artifacts/plan26/training-environment.txt
```

Use fixed random seeds for comparison runs. Do not change seeds, data cutoff, scoring format, and features simultaneously.

---

## 2. Repository layout for a local run

The local training kit should eventually use this structure:

```text
laptop/
  requirements-training.txt
  Makefile                  # or PowerShell equivalents
  README.md
  run_training.py
  inspect_data.py
  inspect_features.py
  feature_experiment.py
  export_forecast.py

artifacts/plan26/
  raw/                       # downloaded immutable source files
  player_games.parquet
  player_games_ctx.parquet
  kicker_games.parquet
  dst_games_partial.parquet
  reports/
    data-audit-<run>.html
    feature-audit-<run>.json
    backtest-<run>.json
    feature-ablation-<run>.csv
  runs/
    <run-id>/
      manifest.json
      metrics.json
      predictions.parquet
      plots/
```

Keep raw files immutable. If a provider corrects a historical file, save it under a new source snapshot rather than overwriting the old file.

Every run gets a unique ID:

```text
2026-09-11T143000Z__ppr__train2010-2023__test2024__gbm-v2
```

The run manifest must include:

- Git commit and branch
- Python and package versions
- Scoring format
- Training, calibration, and test seasons
- Source URLs and download timestamps
- Feature schema version
- Random seed(s)
- Model hyperparameters
- Missing-data policy
- Leakage-check result

---

## 3. Training workflow

Run the workflow in this order. Do not train before the data audit passes.

### Step 1 — Download and inventory source data

```bash
python python/chatpft_modeling/plan26_ingest.py
python python/chatpft_modeling/plan26_k_dst.py
python python/chatpft_modeling/plan26_backfill_2025.py
```

The current player-game store covers 2010–2025 after the 2025 parquet backfill. The 2025 DST team-game backfill remains a separate task and must be marked as missing rather than silently filled.

### Step 2 — Inspect the data

```bash
python laptop/inspect_data.py \
  --input artifacts/plan26/player_games.parquet \
  --positions QB,RB,WR,TE \
  --report artifacts/plan26/reports/data-audit-latest
```

The audit must report:

- Row count and unique players
- Seasons and weeks present
- Counts by position, season, and week
- Duplicate player-season-week rows
- Target nulls, negative values, and extreme values
- Missingness by feature and position
- Players appearing under multiple teams
- Players with long gaps or abrupt role changes
- Whether bye weeks are absent rather than zero-point observations
- Whether did-not-play rows are represented in the availability table
- Timestamp availability and forecast cutoff coverage

Open the generated report locally in a browser. Never rely only on aggregate metrics; inspect samples of suspicious rows.

### Step 3 — Inspect train/calibration/test boundaries

The headline split should be chronological:

```text
training:    seasons <= 2022
calibration: season 2023
headline test: season 2024
future holdout: season 2025 or later when available
```

For a weekly replay:

```text
forecast week t uses only observations and news available before week t kickoff
```

Run a boundary check:

```bash
python laptop/inspect_data.py \
  --check-cutoffs \
  --prediction-cutoff 2024-09-05T00:00:00Z \
  --input artifacts/plan26/player_games_ctx.parquet
```

A run fails if any feature has `available_time > prediction_cutoff`.

### Step 4 — Build context features

```bash
python python/chatpft_modeling/plan26_context.py
```

The context store currently includes home/away, rest, roof, surface, temperature, wind, opponent defensive rolling context, and lagged team target volume. Inspect the generated store before training:

```bash
python laptop/inspect_features.py \
  --input artifacts/plan26/player_games_ctx.parquet \
  --position WR \
  --season 2024
```

### Step 5 — Train baseline models first

```bash
python python/chatpft_modeling/plan26_models.py
python python/chatpft_modeling/plan26_bayes.py
```

Required baselines:

1. Position mean
2. Previous-season mean
3. Recency-weighted rolling mean
4. Preseason prior without weekly updates
5. Availability × conditional-average model

A complex model is not an improvement unless it beats or clearly explains its relationship to these baselines.

### Step 6 — Train the specialist and joint models

```bash
python python/chatpft_modeling/plan26_metamodel.py
python python/chatpft_modeling/plan26_joint_nn_v2.py
```

On a 16 GB laptop:

- Use LightGBM with 4–8 threads, not unrestricted thread creation.
- Train one joint NN ensemble per complete table, then evaluate all position heads.
- Use 3 seeds while experimenting; use 5 seeds for a release candidate.
- Keep batch size between 256 and 1,024 depending on memory.
- Save intermediate predictions after each component so an interrupted run can resume.
- Do not run multiple full NN jobs concurrently.

### Step 7 — Run the availability-aware metamodel

```bash
python python/chatpft_modeling/plan26_metamodel_aware.py
```

This combines:

- GBM conditional estimate
- Bayesian weekly estimate
- Joint NN conditional estimate multiplied by `P(active)`

Fit blend weights only on out-of-fold/calibration predictions. Evaluate on a later untouched season. Never fit weights on the headline test season.

### Step 8 — Export a release artifact

```bash
python laptop/export_forecast.py \
  --run-id <run-id> \
  --scoring-format ppr \
  --output laptop/releases/<run-id>
```

The export must contain forecasts, quantiles, active probability, model components, feature schema, cutoff, source provenance, metrics, and checksums. Hermes should consume the artifact rather than reproduce the heavy training process.

---

## 4. How to inspect training and test data

### 4.1 Inspect one player timeline

For any player, print every historical row ordered by season and week:

```bash
python laptop/inspect_data.py \
  --player-id 00-0034857 \
  --input artifacts/plan26/player_games_ctx.parquet
```

Review:

- Target points
- Did-play/status flag
- Team and opponent
- Prior rolling features
- Feature values immediately before and after a team change
- Whether a feature changes before the first observation that could justify it

### 4.2 Inspect a random sample

Use a reproducible sample:

```bash
python laptop/inspect_data.py \
  --sample 100 \
  --seed 42 \
  --season 2024 \
  --output artifacts/plan26/reports/sample-2024.csv
```

Check the rows manually, especially:

- Rookies
- Players returning from injury
- Players changing teams
- Backup quarterbacks
- Committee running backs
- Tight ends with low samples
- Kickers in extreme weather
- DST units facing unusual quarterbacks

### 4.3 Compare train and test distributions

Generate distribution comparisons for every feature:

```bash
python laptop/inspect_features.py \
  --train-seasons 2010:2022 \
  --calibration-season 2023 \
  --test-season 2024 \
  --plots artifacts/plan26/reports/distributions
```

Look for:

- Features present in test but absent in training
- Large mean or variance shifts
- New categorical values
- Features whose missingness changes materially
- Target distribution shifts by position
- Test rows with no historical prior

Distribution shift does not automatically mean leakage, but it must be documented and stress-tested.

### 4.4 Inspect model predictions against actuals

Every evaluation run should write a row-level predictions file containing:

```text
player_id
season
week
position
prediction_cutoff
actual_points
mean
median
q05
q25
q50
q75
q95
active_probability
model_version
```

Use it to inspect:

```bash
python laptop/inspect_predictions.py \
  --input artifacts/plan26/runs/<run-id>/predictions.parquet \
  --position RB \
  --largest-errors 25
```

The largest-error report should show feature values, status, source inputs, and model disagreement. Do not inspect only the best or worst players; inspect random rows too.

---

## 5. How to identify the best features

Feature selection must be based on chronological out-of-sample improvement, not feature importance alone.

### 5.1 Establish a locked baseline

Before testing a feature:

1. Freeze the data version.
2. Freeze the train/calibration/test split.
3. Freeze seeds and hyperparameters.
4. Record the baseline metrics.
5. Record the exact feature list.

Create an experiment file:

```yaml
experiment_id: context-weather-v1
target: fp_ppr
positions: [QB, RB, WR, TE, K, DST]
train_seasons: [2010, 2022]
calibration_season: 2023
test_season: 2024
baseline_features: [roll3, prior_season_mean]
added_features: [temp, wind, rest, is_home]
seeds: [11, 22, 33]
```

### 5.2 Use feature groups before individual features

Test coherent groups:

- **Role:** carries, targets, routes, snap share, red-zone usage
- **Quarterback/pass environment:** attempts, team pace, receiver availability
- **Opponent:** opponent defensive efficiency, pressure, sacks, coverage
- **Game environment:** spread, total, implied team points, home/away, rest
- **Weather:** temperature, wind, roof, precipitation, surface
- **Availability:** practice status, inactive status, injury recency, return flag
- **Cross-position:** QB forecast for WR/TE, receiver availability for QB, opponent QB for DST
- **External projections:** Razzball, FantasyPros, ESPN, FFToday when available

A group ablation answers whether the feature family adds signal. Individual ablations then identify which fields inside the group matter.

### 5.3 Evaluate with the right metrics

For every experiment report:

- MAE and RMSE
- Spearman rank correlation
- CRPS
- Pinball loss by quantile
- 50%, 80%, and 90% coverage
- Interval width
- Calibration by position
- Performance on injury/DNP/return/rookie/team-change subsets
- Training time and artifact size

A feature is provisionally useful only if it improves the primary metric without materially damaging calibration or subgroup performance.

### 5.4 Feature importance is diagnostic, not proof

Use multiple views:

- LightGBM gain and split importance
- Permutation importance on the test fold
- SHAP values calculated on held-out rows
- Ablation delta
- Stability of importance across seasons and seeds

Reject a feature if it is highly important in one season but unstable across chronological folds, unless there is a documented regime explanation.

### 5.5 Use nested or rolling ablation

For a serious candidate feature:

```text
Experiment A: no feature
Experiment B: feature added
Experiment C: feature added with missingness indicator
Experiment D: feature plus interaction
```

Run the same experiments across multiple validation seasons, not only 2024:

```text
train <= 2019, validate 2020
train <= 2020, validate 2021
train <= 2021, validate 2022
train <= 2022, validate 2023
train <= 2023, test 2024
```

Promote features based on the average improvement and the worst-season degradation, not the best single result.

---

## 6. How to find new features

Use a feature-discovery backlog. Each proposed feature needs:

```text
feature name
business hypothesis
source
entity grain
available timestamp
expected direction or mechanism
missing-data behavior
leakage risk
implementation owner
ablation plan
```

### High-value feature candidates

1. **Official injury reports and inactive lists**
   - Separate out, doubtful, questionable, limited, and active.
   - Preserve publication time and kickoff cutoff.
   - This is the highest-priority missing capability because it improves availability directly.

2. **Practice participation and workload restriction**
   - Wednesday/Thursday/Friday participation.
   - Return-from-absence and limited-workload indicators.

3. **Historical depth charts and role changes**
   - Starter rank, route role, backfield share, red-zone role.
   - Capture changes before the target game only.

4. **Team and opponent environment**
   - Implied team total, spread, game total.
   - Pace, neutral pass rate, early-down pass rate.
   - Pressure rate and coverage tendencies.

5. **Offensive-line availability and continuity**
   - Starting linemen out, replacements, continuity score.

6. **Cross-position dependencies**
   - QB attempts and receiver availability for WR/TE.
   - Opposing QB sack/interception tendency for DST.
   - Team scoring distribution for K.

7. **Market and external projection features**
   - Treat them as timestamped features or priors, not labels.
   - Run ablations with and without each provider.

8. **News features**
   - Begin with structured event categories and recency counts.
   - Add embeddings only after the structured baseline passes leakage checks.

### Feature discovery rules

- Do not add a feature because it sounds predictive.
- Do not use post-kickoff status, final inactive designation, post-game news, or corrected statistics in a pre-kickoff row.
- Do not use target-week actual usage as a pregame feature.
- Do not use future player/team IDs or embeddings.
- Preserve missingness indicators when missingness itself may carry information.
- Prefer a slightly weaker feature with reliable as-of provenance over a stronger feature that is difficult to replay.

---

## 7. Experiment result template

Each experiment should produce a short Markdown summary:

```text
Experiment: opponent-pressure-v2
Date:
Git commit:
Data snapshot:
Scoring:
Target:
Train/calibration/test:
Baseline features:
Added features:

Results by position:
- MAE:
- CRPS:
- Spearman:
- Coverage:
- Interval width:

Subgroup results:
- Injury/DNP:
- Rookie:
- Return:
- Team change:

Leakage checks:
Runtime:
Conclusion: promote / reject / investigate
Reason:
```

A feature is promoted only when:

- The cutoff check passes.
- It improves or maintains CRPS and point accuracy across several chronological folds.
- It does not create unacceptable calibration loss.
- Its missing-data policy is explicit.
- The feature can be regenerated on the laptop and replayed historically.
- The feature and source provenance are recorded in the release manifest.

---

## 8. Recommended first experiments

Run these in order:

1. **Data audit and target audit** — no model change.
2. **Schedule/context ablation** — home, rest, weather, opponent rolling features.
3. **2025 expansion comparison** — train with and without 2025; evaluate an earlier untouched season to avoid using 2025 as both training and validation.
4. **Availability features** — DNP labels, inactive status, practice participation, return-from-absence.
5. **External projection ablation** — Razzball only vs Razzball + FantasyPros vs all available sources.
6. **Market environment** — spread, total, implied team points.
7. **Role features** — depth charts, snaps, routes, target share, red-zone usage.
8. **News baseline** — structured events before embeddings.
9. **Joint-NN auxiliary-task ablation** — team points heads on/off.
10. **Ensemble seed stability** — 3 vs 5 vs 10 seeds.

The laptop should publish experiment reports and only publish a model release after the acceptance gates pass. Hermes should consume approved releases; it should not select features or promote a model based on intuition.

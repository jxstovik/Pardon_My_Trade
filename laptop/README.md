# Plan 27 local training kit

This directory contains the reproducible local workflow described in
`docs/27-local-model-training-and-feature-discovery.md`. Run it on a laptop or
workstation, not in the Hermes gateway. The gateway cannot use your computer's
CPU, RAM, or filesystem.

## Setup

```bash
cd Pardon_My_Trade
python -m venv .venv-plan26
# macOS/Linux
source .venv-plan26/bin/activate
# Windows PowerShell
.venv-plan26\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r laptop/requirements-training.txt
# Needed only for the joint neural-network stage:
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Use Python 3.11–3.13. Keep the venv out of commits. The kit uses full PPR
(`fp_ppr`) by default and writes generated data under `artifacts/plan26/`.
Raw source files are not overwritten; reruns reuse existing downloads.

## Workflow

Run the audit before training:

```bash
python laptop/inspect_data.py --input artifacts/plan26/player_games.parquet \
  --positions QB,RB,WR,TE --report artifacts/plan26/reports/data-audit-latest
python laptop/inspect_data.py --check-cutoffs \
  --prediction-cutoff 2024-09-05T00:00:00Z \
  --input artifacts/plan26/player_games_ctx.parquet
python laptop/inspect_features.py --input artifacts/plan26/player_games_ctx.parquet \
  --train-seasons 2010:2022 --calibration-season 2023 --test-season 2024 \
  --report artifacts/plan26/reports/feature-audit-latest.json
python laptop/run_training.py --scoring-format fp_ppr --threads 4
```

`run_training.py` runs ingestion, context construction, baseline/GBM,
Bayesian, metamodel, availability-aware metamodel, and optionally the joint NN
stage. Use `--skip-download` when the parquet stores already exist and
`--skip-joint-nn` when PyTorch is not installed. It writes a manifest and
training environment under `artifacts/plan26/runs/<run-id>/`.

### Live progress

While a run is active, monitor these files from another terminal or file
viewer:

```bash
python -m json.tool artifacts/plan26/runs/<run-id>/progress.json
# append-only event stream
Get-Content artifacts/plan26/runs/<run-id>/progress.jsonl -Wait  # PowerShell
```

`progress.json` contains the current status, stage number, total stages,
return code, and log path. `progress.jsonl` preserves every state transition.
Each stage also writes a live `<stage>.log` file in the run directory. The
runner streams each child process line to both its stage log and the console.

Inspect predictions and export a release:

```bash
python laptop/inspect_predictions.py --input artifacts/plan26/runs/<run-id>/predictions.parquet --largest-errors 25
python laptop/export_forecast.py --run-id <run-id> --scoring-format ppr --output laptop/releases/<run-id>
```

On Windows, use the same commands in PowerShell; the scripts do not require
`make`, bash, or Unix path syntax.

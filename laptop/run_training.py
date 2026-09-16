#!/usr/bin/env python3
"""Run the Plan 27 local, CPU-friendly training pipeline."""
from __future__ import annotations
import argparse, json, os, platform, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "python" / "chatpft_modeling"

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scoring-format", default="fp_ppr", choices=["fp_ppr", "fp_half_ppr"])
    ap.add_argument("--threads", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    ap.add_argument("--skip-download", action="store_true")
    ap.add_argument("--skip-joint-nn", action="store_true")
    ap.add_argument("--run-id")
    args = ap.parse_args()
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"__{args.scoring_format}__plan27"
    run_dir = ROOT / "artifacts" / "plan26" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    env = os.environ.copy()
    for key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "LIGHTGBM_NUM_THREADS"):
        env[key] = str(args.threads)
    commands = []
    if not args.skip_download:
        commands += [["plan26_ingest.py"], ["plan26_k_dst.py"], ["plan26_backfill_2025.py"]]
    commands += [["plan26_context.py"], ["plan26_models.py"], ["plan26_bayes.py"], ["plan26_metamodel.py"], ["plan26_metamodel_aware.py"]]
    if not args.skip_joint_nn:
        commands += [["plan26_joint_nn_v2.py"]]
    results = []
    for (script,) in commands:
        path = MODEL / script
        if not path.exists():
            raise SystemExit(f"missing pipeline script: {path}")
        cmd = [sys.executable, str(path)]
        print("+", " ".join(cmd), flush=True)
        completed = subprocess.run(cmd, cwd=ROOT, env=env)
        results.append({"script": script, "returncode": completed.returncode})
        if completed.returncode:
            (run_dir / "manifest.json").write_text(json.dumps({"status":"failed", "results":results}, indent=2))
            return completed.returncode
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False)
    manifest = {"status":"complete", "run_id":run_id, "git_commit":git.stdout.strip(), "platform":platform.platform(), "python":sys.version, "scoring_format":args.scoring_format, "threads":args.threads, "results":results}
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    freeze = subprocess.run([sys.executable, "-m", "pip", "freeze"], text=True, capture_output=True, check=False)
    (run_dir / "training-environment.txt").write_text(freeze.stdout)
    print(json.dumps(manifest, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Run the Plan 27 local, CPU-friendly training pipeline."""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "python" / "chatpft_modeling"


class ProgressTracker:
    """Publish a live JSON snapshot and append-only event history."""

    def __init__(self, run_dir: Path, total: int) -> None:
        self.run_dir = run_dir
        self.total = total
        self.completed = 0
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.progress_path = self.run_dir / "progress.json"
        self.history_path = self.run_dir / "progress.jsonl"

    def log_path(self, script: str) -> Path:
        safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", script)
        return self.run_dir / f"{safe_name.removesuffix('.py')}.log"

    def publish(self, status: str, *, script: str | None = None,
                index: int | None = None, returncode: int | None = None,
                message: str | None = None) -> dict:
        if status == "completed" and index is not None:
            self.completed = max(self.completed, index)
        event = {
            "status": status,
            "completed": self.completed,
            "total": self.total,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if script is not None:
            event["script"] = script
        if index is not None:
            event["index"] = index
        if returncode is not None:
            event["returncode"] = returncode
        if message is not None:
            event["message"] = message
        self.progress_path.write_text(json.dumps(event, indent=2) + "\n", encoding="utf-8")
        with self.history_path.open("a", encoding="utf-8") as history:
            history.write(json.dumps(event) + "\n")
        return event


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

    tracker = ProgressTracker(run_dir, len(commands))
    tracker.publish("started", message=f"starting {len(commands)} stages")
    results = []
    for index, (script,) in enumerate(commands, start=1):
        path = MODEL / script
        if not path.exists():
            tracker.publish("failed", script=script, index=index, returncode=2, message=f"missing pipeline script: {path}")
            raise SystemExit(f"missing pipeline script: {path}")
        cmd = [sys.executable, str(path)]
        log_path = tracker.log_path(script)
        tracker.publish("running", script=script, index=index, message=f"log: {log_path}")
        print("+", " ".join(cmd), flush=True)
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, bufsize=1)
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                log.flush()
                print(line, end="", flush=True)
            returncode = process.wait()
        results.append({"script": script, "returncode": returncode, "log": str(log_path)})
        if returncode:
            tracker.publish("failed", script=script, index=index, returncode=returncode,
                            message=f"stage failed; see {log_path}")
            (run_dir / "manifest.json").write_text(json.dumps({"status": "failed", "results": results}, indent=2))
            return returncode
        tracker.publish("completed", script=script, index=index, returncode=returncode)

    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False)
    manifest = {"status": "complete", "run_id": run_id, "git_commit": git.stdout.strip(), "platform": platform.platform(), "python": sys.version, "scoring_format": args.scoring_format, "threads": args.threads, "results": results}
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    freeze = subprocess.run([sys.executable, "-m", "pip", "freeze"], text=True, capture_output=True, check=False)
    (run_dir / "training-environment.txt").write_text(freeze.stdout)
    tracker.publish("complete", message="all stages completed")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

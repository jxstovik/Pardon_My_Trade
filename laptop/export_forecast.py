#!/usr/bin/env python3
"""Create a self-contained, checksummed forecast release directory."""
from __future__ import annotations
import argparse, hashlib, json, shutil
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--run-id",required=True); ap.add_argument("--scoring-format",default="ppr"); ap.add_argument("--output",required=True); a=ap.parse_args()
 src=ROOT/"artifacts"/"plan26"; dest=Path(a.output); dest.mkdir(parents=True,exist_ok=True); copied=[]
 for f in ["backtest_report_2024.json","bayes_report_2024.json","metamodel_report_2024.json","joint_nn_v2_report_2024.json"]:
  p=src/f
  if p.exists(): shutil.copy2(p,dest/f); copied.append(f)
 manifest={"run_id":a.run_id,"scoring_format":a.scoring_format,"created_at":datetime.now(timezone.utc).isoformat(),"files":{f:hashlib.sha256((dest/f).read_bytes()).hexdigest() for f in copied}}
 (dest/"manifest.json").write_text(json.dumps(manifest,indent=2)); print(json.dumps(manifest,indent=2)); return 0
if __name__=="__main__": raise SystemExit(main())

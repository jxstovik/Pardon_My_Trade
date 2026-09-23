#!/usr/bin/env python3
"""Compare feature availability and distributions across chronological splits."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import pandas as pd

def seasons(spec):
    lo,hi=map(int,spec.split(":")); return list(range(lo,hi+1))
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--input",required=True); ap.add_argument("--train-seasons",default="2010:2022"); ap.add_argument("--calibration-season",type=int,default=2023); ap.add_argument("--test-season",type=int,default=2024); ap.add_argument("--report",default="artifacts/plan26/reports/feature-audit-latest.json"); ap.add_argument("--position"); ap.add_argument("--plots")
    a=ap.parse_args(); df=pd.read_parquet(a.input)
    if a.position and "position" in df: df=df[df.position==a.position]
    groups={"train":df[df.season.isin(seasons(a.train_seasons))],"calibration":df[df.season==a.calibration_season],"test":df[df.season==a.test_season]}
    numeric=df.select_dtypes("number").columns
    report={"input":a.input,"rows":{k:len(v) for k,v in groups.items()},"features":{c:{k:{"missing":int(v[c].isna().sum()),"missing_rate":round(float(v[c].isna().mean()),6),"mean":float(v[c].mean()) if v[c].notna().any() else None,"std":float(v[c].std()) if v[c].notna().any() else None} for k,v in groups.items()} for c in numeric}}
    out=Path(a.report); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2)); return 0
if __name__=="__main__": raise SystemExit(main())

#!/usr/bin/env python3
"""Audit a parquet training store for Plan 27."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import pandas as pd

def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument("--input",required=True); ap.add_argument("--positions"); ap.add_argument("--report",default="artifacts/plan26/reports/data-audit-latest"); ap.add_argument("--check-cutoffs",action="store_true"); ap.add_argument("--prediction-cutoff"); ap.add_argument("--player-id"); ap.add_argument("--sample",type=int); ap.add_argument("--seed",type=int,default=42); ap.add_argument("--season",type=int); ap.add_argument("--output")
    a=ap.parse_args(); df=pd.read_parquet(a.input)
    if a.positions and "position" in df: df=df[df.position.isin(a.positions.split(","))].copy()
    key=[c for c in ["player_id","entity_id","season","week"] if c in df]
    targets=[c for c in ["fp_ppr","fp_half_ppr","fantasy_points_ppr","kicker_points","dst_points"] if c in df]
    report={"input":a.input,"rows":len(df),"columns":len(df.columns),"unique_players":int(df[key[0]].nunique()) if key else None,"seasons":sorted(map(int,df.season.dropna().unique())) if "season" in df else [],"weeks":sorted(map(int,df.week.dropna().unique())) if "week" in df else [],"counts_by_position":df.position.value_counts().to_dict() if "position" in df else {},"duplicates":int(df.duplicated(key).sum()) if key else None,"targets":{c:{"null":int(df[c].isna().sum()),"negative":int((df[c].dropna()<0).sum()),"min":float(df[c].min()),"max":float(df[c].max())} for c in targets},"missingness":{c:round(float(df[c].isna().mean()),6) for c in df.columns},"players_multiple_teams":int(df.groupby(key[0]).recent_team.nunique().gt(1).sum()) if key and "recent_team" in df else None}
    if a.check_cutoffs:
        if "available_time" not in df: report["cutoff_check"]={"status":"not_available","reason":"available_time column missing"}
        else:
            cutoff=pd.Timestamp(a.prediction_cutoff,utc=True); t=pd.to_datetime(df.available_time,utc=True,errors="coerce"); report["cutoff_check"]={"status":"pass" if not (t>cutoff).any() else "fail","after_cutoff":int((t>cutoff).sum()),"unparseable":int(t.isna().sum())}
    out=Path(a.output) if a.output else Path(a.report+".json"); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2,default=str))
    if a.player_id: df=df[df[key[0]]==a.player_id]
    if a.season is not None and "season" in df: df=df[df.season==a.season]
    if a.sample: df=df.sample(min(a.sample,len(df)),random_state=a.seed)
    if a.player_id or a.sample or a.season is not None: df.to_csv(a.output or Path(a.report).with_suffix(".csv"),index=False)
    print(json.dumps(report,indent=2,default=str)); return 0
if __name__ == "__main__": raise SystemExit(main())

#!/usr/bin/env python3
"""Inspect largest and random prediction errors."""
from __future__ import annotations
import argparse
from pathlib import Path
import pandas as pd

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--input",required=True); ap.add_argument("--largest-errors",type=int,default=25); ap.add_argument("--output"); a=ap.parse_args(); p=Path(a.input); df=pd.read_parquet(p) if p.suffix==".parquet" else pd.read_json(p)
    pred=next((c for c in ["mean","prediction","predicted","metamodel_mean"] if c in df),None); actual=next((c for c in ["actual_points","actual","target"] if c in df),None)
    if not pred or not actual: raise SystemExit(f"need prediction and actual columns; found {list(df.columns)}")
    df=df.copy(); df["absolute_error"]=(df[pred]-df[actual]).abs(); out=df.sort_values("absolute_error",ascending=False).head(a.largest_errors); dest=Path(a.output) if a.output else p.with_name(p.stem+"-largest-errors.csv"); out.to_csv(dest,index=False); print(dest); return 0
if __name__=="__main__": raise SystemExit(main())

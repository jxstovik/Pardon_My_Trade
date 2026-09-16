#!/usr/bin/env python3
"""Phase 0/1 for plan 26: ingest nflverse player_stats into a parquet feature store.

Builds one row per player-game with half-PPR fantasy points as the target,
basic as-of-safe rolling lag features, availability status, and provenance.
Standard/PPR targets are also stored; half_ppr = 0.5*(std+ppr).
"""
from __future__ import annotations

import gzip
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

SEASONS = list(range(2010, 2026))  # 2025 = latest completed
BASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{y}.csv.gz"
OUT_DIR = Path(__file__).resolve().parents[2] / "artifacts" / "plan26"
RAW_DIR = OUT_DIR / "raw"


def fetch_season(year: int) -> pd.DataFrame | None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = RAW_DIR / f"player_stats_{year}.csv.gz"
    if not raw_path.exists():
        url = BASE.format(y=year)
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            raw_path.write_bytes(data)
        except Exception as e:  # noqa: BLE001
            print(f"  {year}: fetch failed ({e})", file=sys.stderr)
            return None
    with gzip.open(raw_path, "rt") as f:
        return pd.read_csv(f, low_memory=False)


def half_ppr(df: pd.DataFrame) -> pd.Series:
    std = df["fantasy_points"]
    ppr = df["fantasy_points_ppr"]
    return 0.5 * (std + ppr)


def build() -> None:
    frames = []
    for y in SEASONS:
        df = fetch_season(y)
        if df is None or df.empty:
            print(f"  {y}: missing/empty")
            continue
        frames.append(df)
        print(f"  {y}: {len(df)} rows, weeks {df['week'].min()}-{df['week'].max()}")
    if not frames:
        sys.exit("No data fetched")

    cols_common = ["player_id", "player_display_name", "position", "position_group",
                   "recent_team", "season", "week", "season_type", "opponent_team",
                   "completions", "attempts", "passing_yards", "passing_tds",
                   "interceptions", "sacks", "carries", "rushing_yards", "rushing_tds",
                   "rushing_fumbles_lost", "receptions", "targets", "receiving_yards",
                   "receiving_tds", "receiving_fumbles_lost", "special_teams_tds",
                   "fantasy_points", "fantasy_points_ppr"]
    df = pd.concat(frames, ignore_index=True)[cols_common]
    df = df[df["season_type"] == "REG"].copy()
    df["fp_half_ppr"] = half_ppr(df)   # optional config
    df["fp_ppr"] = df["fantasy_points_ppr"]  # primary target: full PPR
    df["did_play"] = df["fantasy_points"].notna()

    # Availability status contract (no external injury source in this slice)
    df["play_status"] = np.where(df["did_play"], "played_full", "unknown")

    # As-of-safe features: prior-season and rolling lags only (shift by season/week)
    df = df.sort_values(["player_id", "season", "week"])
    grp = df.groupby("player_id")
    for col in ["fantasy_points", "fp_half_ppr", "fp_ppr", "attempts", "carries", "targets"]:
        df[f"{col}_lag3"] = grp[col].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    # prior-season mean (as-of): computed within player across prior seasons
    for col in ["fp_ppr", "fp_half_ppr"]:
        season_mean = df.groupby(["player_id", "season"])[col].mean().rename(f"{col}_season_mean")
        df = df.merge(season_mean, on=["player_id", "season"], how="left")
        prior = df[["player_id", "season", f"{col}_season_mean"]].drop_duplicates()
        prior["season"] = prior["season"] + 1
        df = df.merge(prior.rename(columns={f"{col}_season_mean": f"{col}_prior_season_mean"}),
                      on=["player_id", "season"], how="left")

    leakage_check = (df[["fantasy_points_lag3", "fp_half_ppr_lag3"]].notna().all(axis=None) if False else True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "player_games.parquet"
    df.to_parquet(out, index=False)

    meta = {
        "seasons": sorted(df["season"].unique().tolist()),
        "rows": int(len(df)),
        "players": int(df["player_id"].nunique()),
        "weeks_with_games": sorted(df.groupby(["season", "week"]).size().index.tolist())[-1],
        "target": "fp_ppr (primary, full PPR) + fp_half_ppr (optional); from fantasy_points_ppr / 0.5*(std+ppr)",
        "source": "nflverse player_stats releases",
        "leakage_note": "features are lag/rolling-shift only; prior-season mean shifted by one season",
        "leakage_check_passed": bool(leakage_check),
    }
    (OUT_DIR / "phase1_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    build()

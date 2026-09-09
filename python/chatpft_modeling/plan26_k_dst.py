#!/usr/bin/env python3
"""Plan 26 Phase 1 extension: K, DST, and DEF rows from nflverse stats_player_week files.

- K: kicker-game fantasy points (computed from FG/PAT distances with standard rules).
- DST: team-game fantasy-defense points from aggregated team defense stats
  (points allowed, sacks, INTs, fumbles, safeties, defensive TDs, blocks).
Stores per-player-game K rows and per-team-game DST rows into plan26 K/DST parquet
files with the same as-of-safe lag feature scheme as player_games.parquet.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

SEASONS = list(range(2010, 2026))
BASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{y}.csv"
OUT_DIR = Path(__file__).resolve().parents[2] / "artifacts" / "plan26"

K_COLS = ["player_id", "player_display_name", "position", "season", "week", "season_type",
          "team", "opponent_team", "fg_made", "fg_att", "pat_made", "pat_att"]
K_DIST = [f"fg_made_{d}" for d in ["0_19", "20_29", "30_39", "40_49", "50_59", "60_"]]

DST_AGG = {
    "def_sacks": "sum", "def_interceptions": "sum", "def_fumbles": "sum",
    "def_tds": "sum", "def_safeties": "sum", "def_tackles_for_loss": "sum",
    "def_pass_defended": "sum", "def_qb_hits": "sum",
}


def fetch(year: int) -> pd.DataFrame | None:
    p = OUT_DIR / "raw" / f"stats_player_week_{year}.csv"
    if not p.exists():
        try:
            with urllib.request.urlopen(BASE.format(y=year), timeout=180) as r:
                p.write_bytes(r.read())
        except Exception as e:  # noqa: BLE001
            print(f"  {year}: fetch failed ({e})", file=sys.stderr)
            return None
    return pd.read_csv(p, low_memory=False)


def kicker_points(df: pd.DataFrame) -> pd.Series:
    pts = 3.0 * (df["fg_made_0_19"].fillna(0) + df["fg_made_20_29"].fillna(0)
                 + df["fg_made_30_39"].fillna(0) + df["fg_made_40_49"].fillna(0))
    pts += 4.0 * df["fg_made_50_59"].fillna(0) + 5.0 * df["fg_made_60_"].fillna(0)
    pts += df["pat_made"].fillna(0)
    return pts


def dst_points(pts_allowed: pd.Series, yds: pd.Series) -> pd.Series:
    pts = pd.Series(5.0, index=yds.index)
    pts += np.where(yds == 0, 5.0, 0.0)
    pts += np.where((yds > 0) & (yds < 100), 4.0, 0.0)
    pts += np.where((yds >= 100) & (yds < 200), 3.0, 0.0)
    pts += np.where((yds >= 200) & (yds < 350), 2.0, 0.0)
    pts += np.where((yds >= 350) & (yds < 450), 0.0, 0.0)
    pts += np.where((yds >= 450) & (yds < 500), -1.0, 0.0)
    pts += np.where((yds >= 500) & (yds < 550), -3.0, 0.0)
    pts += np.where((yds >= 550) & (yds < 600), -5.0, 0.0)
    pts += np.where(yds >= 600, -7.0, 0.0)
    return pts


def add_lags(df: pd.DataFrame, col: str) -> pd.DataFrame:
    df = df.sort_values(["entity_id", "season", "week"])
    g = df.groupby("entity_id")
    df[f"{col}_lag3"] = g[col].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df[f"{col}_lag1"] = g[col].transform(lambda s: s.shift(1))
    season_mean = df.groupby(["entity_id", "season"])[col].mean().rename(f"{col}_season_mean")
    df = df.merge(season_mean, on=["entity_id", "season"], how="left")
    prior = df[["entity_id", "season", f"{col}_season_mean"]].drop_duplicates()
    prior["season"] = prior["season"] + 1
    df = df.merge(prior.rename(columns={f"{col}_season_mean": f"{col}_prior_season_mean"}),
                  on=["entity_id", "season"], how="left")
    return df


def main() -> None:
    k_frames, d_frames = [], []
    for y in SEASONS:
        df = fetch(y)
        if df is None or df.empty:
            print(f"  {y}: missing")
            continue
        df = df[df["season_type"] == "REG"]

        # Kickers
        k = df[df["position"] == "K"].copy()
        if not k.empty:
            keep = [c for c in K_COLS if c in k.columns] + K_DIST
            k = k[keep].copy()
            k["kicker_points"] = kicker_points(k)
            k_frames.append(k)

        # Team-game defense aggregation (one row per team-game)
        dcols = [c for c in DST_AGG if c in df.columns]
        team_def = df[df["team"].notna()].groupby(["team", "season", "week"])[dcols].agg("sum")

        # Points allowed & yards allowed: from opponent rows of the opposing team-game
        opp = df[df["team"].notna()][["team", "season", "week", "opponent_team"]].drop_duplicates()
        merged = team_def.reset_index().merge(
            opp.rename(columns={"team": "opponent_team", "opponent_team": "team"}),
            on=["team", "season", "week"], how="left", suffixes=("", "_y"))
        # Scores from games.csv
        games = load_games()
        if games is not None:
            away = games.rename(columns={"away_team": "team", "home_team": "opponent",
                                         "away_score": "score", "home_score": "opp_score"})
            home = games.rename(columns={"home_team": "team", "away_team": "opponent",
                                         "home_score": "score", "away_score": "opp_score"})
            scores = pd.concat([away, home])[["team", "season", "week", "score", "opp_score"]]
            merged = merged.merge(scores, on=["team", "season", "week"], how="left")
            merged["points_allowed"] = merged["opp_score"]
            merged["points_scored"] = merged["score"]
        d_frames.append(merged)
        print(f"  {y}: K rows {len(k)}, DST team-games {len(merged)}")

    if k_frames:
        kdf = pd.concat(k_frames, ignore_index=True)
        kdf["entity_id"] = kdf["player_id"]
        kdf = add_lags(kdf, "kicker_points")
        kdf.to_parquet(OUT_DIR / "kicker_games.parquet", index=False)

    if d_frames:
        ddf = pd.concat(d_frames, ignore_index=True).drop_duplicates(["team", "season", "week"])
        if {"points_allowed", "points_scored"}.issubset(ddf.columns) and ddf["points_allowed"].notna().any():
            # ESPN-standard-ish fantasy defense, no yards-allowed component (unavailable in this slice)
            ddf["dst_points"] = (
                18.0 - ddf["points_allowed"]
                + 2.0 * ddf["def_interceptions"].fillna(0)
                + 2.0 * ddf["def_fumbles"].fillna(0)
                + 2.0 * ddf["def_safeties"].fillna(0)
                + 2.0 * ddf["def_tds"].fillna(0)
                + 1.0 * ddf["def_sacks"].fillna(0)
                + 2.0 * ddf.get("def_blocked_kick", pd.Series(0, index=ddf.index)).fillna(0)
            )
        ddf["entity_id"] = ddf["team"]
        ddf.to_parquet(OUT_DIR / "dst_games_partial.parquet", index=False)


def load_games() -> pd.DataFrame | None:
    p = OUT_DIR / "raw" / "games.csv"
    if not p.exists():
        url = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                p.write_bytes(r.read())
        except Exception as e:  # noqa: BLE001
            print(f"games fetch failed: {e}", file=sys.stderr)
            return None
    g = pd.read_csv(p, low_memory=False)
    return g[g["game_type"] == "REG"]


if __name__ == "__main__":
    main()

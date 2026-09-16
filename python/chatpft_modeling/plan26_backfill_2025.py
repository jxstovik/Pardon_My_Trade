#!/usr/bin/env python3
"""Plan 26: backfill the 2025 season into the player-games store.

2025 weekly data lives in the stats_player release as a parquet
(stats_player_week_2025.parquet) — the CSV path 404s for 2025. This script
converts it into the same schema as the 2010-2024 player_games.parquet rows
and appends it, then refits nothing (models refit on next run).

Also rebuilds the kicker store for 2025 (K rows exist in the same parquet).
DST 2025 team-game rows are NOT rebuilt here (defense stats live in the
team-level release; follow-up).
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
       "stats_player/stats_player_week_2025.parquet")


def fetch() -> pd.DataFrame:
    p = OUT / "raw" / "stats_player_week_2025.parquet"
    if not p.exists():
        with urllib.request.urlopen(URL, timeout=180) as r:
            p.write_bytes(r.read())
    return pd.read_parquet(p)


COLS = ["player_id", "player_display_name", "position", "position_group",
        "recent_team", "season", "week", "season_type", "opponent_team",
        "completions", "attempts", "passing_yards", "passing_tds",
        "interceptions", "sacks", "carries", "rushing_yards", "rushing_tds",
        "rushing_fumbles_lost", "receptions", "targets", "receiving_yards",
        "receiving_tds", "receiving_fumbles_lost", "special_teams_tds",
        "fantasy_points", "fantasy_points_ppr"]


def main() -> None:
    df25 = fetch()
    reg = df25[df25["season_type"] == "REG"].copy()
    for col in COLS:
        if col not in reg.columns and col not in ("recent_team",):
            reg[col] = np.nan
    # the weekly file uses `team`; player_games uses `recent_team`
    reg["recent_team"] = reg["team"] if "team" in reg.columns else reg.get("recent_team")

    pg = pd.read_parquet(OUT / "player_games.parquet")
    before_seasons = sorted(pg["season"].unique())

    new = reg[COLS].copy()
    new["fp_half_ppr"] = 0.5 * (new["fantasy_points"] + new["fantasy_points_ppr"])
    new["fp_ppr"] = new["fantasy_points_ppr"]
    new["did_play"] = new["fantasy_points"].notna()
    new["play_status"] = np.where(new["did_play"], "played_full", "unknown")

    combined = pd.concat([pg, new], ignore_index=True)
    combined = combined.sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    combined.to_parquet(OUT / "player_games.parquet", index=False)

    # kicker rows for 2025
    k25 = reg[reg["position"] == "K"].copy()
    if not k25.empty:
        dist = {f"fg_made_{d}": k25.get(f"fg_made_{d}") for d in
                ["0_19", "20_29", "30_39", "40_49", "50_59", "60_"]}
        kdf = k25[["player_id", "player_display_name", "position", "season", "week",
                   "season_type", "team", "opponent_team", "fg_made", "fg_att",
                   "pat_made", "pat_att"]].copy()
        for k, v in dist.items():
            kdf[k] = v if v is not None else np.nan
        kdf["entity_id"] = kdf["player_id"]
        kdf["kicker_points"] = (3.0 * (kdf["fg_made_0_19"].fillna(0) + kdf["fg_made_20_29"].fillna(0)
                                       + kdf["fg_made_30_39"].fillna(0) + kdf["fg_made_40_49"].fillna(0))
                                + 4.0 * kdf["fg_made_50_59"].fillna(0) + 5.0 * kdf["fg_made_60_"].fillna(0)
                                + kdf["pat_made"].fillna(0))
        kdf = kdf.sort_values(["entity_id", "season", "week"]).reset_index(drop=True)
        g = kdf.groupby("entity_id")["kicker_points"]
        kdf["kicker_points_lag3"] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
        kdf["kicker_points_lag1"] = g.transform(lambda s: s.shift(1))
        kall = pd.read_parquet(OUT / "kicker_games.parquet")
        kall = kall[~((kall.season == 2025))].copy()
        kall = pd.concat([kall, kdf], ignore_index=True).sort_values(["entity_id", "season", "week"])
        kall.to_parquet(OUT / "kicker_games.parquet", index=False)

    meta = {
        "backfilled_season": 2025,
        "rows_added": int(len(new)),
        "kicker_rows_added": int(len(k25)),
        "store_seasons": sorted(combined["season"].unique().tolist()),
        "store_rows": int(len(combined)),
        "source": URL,
        "note": "DST 2025 team-game rows not backfilled (team-level release follow-up)",
    }
    (OUT / "backfill_2025_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()

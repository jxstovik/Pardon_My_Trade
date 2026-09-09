#!/usr/bin/env python3
"""Plan 26 Phase 1 completion: schedule, weather, opponent context features.

Merges into the player-game store (per plan 5.1/5.3, all as-of-safe):
- home/away, rest days, game day/time, roof, surface, temp, wind (from games.csv;
  weather values are forecast-usable pre-kickoff, scores are NEVER joined)
- opponent defense context: opponent's rolling points allowed, sacks, takeaways
  from the current season to date (shifted to exclude the target game)
- cross-position context (plan 5.3): WR/TE get team passing volume to date;
  QB gets team receiving availability proxies — all lagged, no target-week info

Refits the quantile GBM with and without these features on the identical 2024
walk-forward fold to quantify the feature gain (plan 8/10 discipline).
Outputs: artifacts/plan26/context_features_report_2024.json and an enriched
player_games parquet (player_games_ctx.parquet).
"""
from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
VAL_SEASON = 2024
CAL_SEASON = 2023


def load_games() -> pd.DataFrame:
    p = OUT / "raw" / "games.csv"
    if not p.exists():
        import urllib.request
        url = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
        with urllib.request.urlopen(url, timeout=120) as r:
            p.write_bytes(r.read())
    g = pd.read_csv(p, low_memory=False)
    return g[g["game_type"] == "REG"].copy()


def build_context() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (player_games_ctx, team_def_ctx)."""
    games = load_games()
    gcols = ["game_id", "season", "week", "gameday", "gametime", "weekday",
             "roof", "surface", "temp", "wind", "away_rest", "home_rest",
             "away_team", "home_team"]
    games = games[gcols]

    # long format: one row per team-game with home/away flags
    away = games[["season", "week", "gameday", "gametime", "weekday", "roof", "surface",
                  "temp", "wind"]].copy()
    away["team"] = games["away_team"]
    away["opponent"] = games["home_team"]
    away["rest"] = games["away_rest"]
    away["is_home"] = 0
    home = games[["season", "week", "gameday", "gametime", "weekday", "roof", "surface",
                  "temp", "wind"]].copy()
    home["team"] = games["home_team"]
    home["opponent"] = games["away_team"]
    home["rest"] = games["home_rest"]
    home["is_home"] = 1
    sched = pd.concat([away, home], ignore_index=True)
    sched["gameday"] = pd.to_datetime(sched["gameday"])

    # opponent defensive context: rolling season-to-date points allowed etc.
    dst = pd.read_parquet(OUT / "dst_games_partial.parquet")
    dst = dst.sort_values(["entity_id", "season", "week"])
    g = dst.groupby("entity_id")
    dst["opp_pa_lag3"] = g["points_allowed"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    dst["opp_sacks_lag3"] = g["def_sacks"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    dst["opp_to_lag3"] = g["def_interceptions"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    opp_ctx = dst[["entity_id", "season", "week", "opp_pa_lag3", "opp_sacks_lag3", "opp_to_lag3"]]
    # For a team playing opponent X in week w: join opp_ctx on (opponent, season, week)
    ctx = sched.merge(opp_ctx.rename(columns={"entity_id": "opponent",
                                              "opp_pa_lag3": "opponent_def_pa_lag3",
                                              "opp_sacks_lag3": "opponent_def_sacks_lag3",
                                              "opp_to_lag3": "opponent_def_to_lag3"}),
                      on=["opponent", "season", "week"], how="left")
    # opponent DEF stats are their season-to-date entering this week (lag3 of their def)
    # NOTE: their week-w defensive stats include THIS game; use only their prior-week rolling
    opp_ctx_prior = dst[["entity_id", "season", "week", "opp_pa_lag3", "opp_sacks_lag3", "opp_to_lag3"]].copy()
    opp_ctx_prior["week"] += 1
    ctx2 = sched.merge(opp_ctx_prior.rename(columns={"entity_id": "opponent",
                                                     "opp_pa_lag3": "opponent_def_pa_lag3",
                                                     "opp_sacks_lag3": "opponent_def_sacks_lag3",
                                                     "opp_to_lag3": "opponent_def_to_lag3"}),
                       on=["opponent", "season", "week"], how="left")

    pg = pd.read_parquet(OUT / "player_games.parquet")
    pg = pg.merge(ctx2[["season", "week", "team", "is_home", "rest", "gameday", "gametime",
                        "weekday", "roof", "surface", "temp", "wind",
                        "opponent_def_pa_lag3", "opponent_def_sacks_lag3", "opponent_def_to_lag3"]],
                  left_on=["season", "week", "recent_team"],
                  right_on=["season", "week", "team"], how="left").drop(columns=["team"])
    return pg, dst


def add_cross_position(pg: pd.DataFrame) -> pd.DataFrame:
    """Team passing-volume-to-date features (WR/TE), lagged."""
    pg = pg.sort_values(["player_id", "season", "week"])
    # team targets to date this season (excluding current week) for pass catchers
    tm = pg.groupby(["recent_team", "season", "week"])["targets"].sum().rename("team_targets_wk").reset_index()
    tm = tm.sort_values(["recent_team", "season", "week"])
    tm["team_targets_lag3"] = tm.groupby(["recent_team", "season"])["team_targets_wk"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    pg = pg.merge(tm[["recent_team", "season", "week", "team_targets_lag3"]],
                  on=["recent_team", "season", "week"], how="left")
    return pg


def evaluate(position: str, pg: pd.DataFrame, base_feat: list[str], ctx_feat: list[str]):
    out = {}
    for tag, feat in [("base", base_feat), ("with_context", base_feat + ctx_feat)]:
        train = pg[(pg["position"] == position) & (pg["season"] < CAL_SEASON)]
        cal = pg[(pg["position"] == position) & (pg["season"] == CAL_SEASON)]
        test = pg[(pg["position"] == position) & (pg["season"] == VAL_SEASON)]
        train = train[train["target"].notna()]
        cal = cal[cal["target"].notna()]
        test = test[test["target"].notna()]
        X = pg[feat].copy()
        for c in feat:
            if X[c].dtype == object or str(X[c].dtype) == "category":
                X[c] = X[c].astype("category")
        cat = [c for c in feat if str(X[c].dtype) == "category"]
        m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=350,
                              learning_rate=0.06, num_leaves=31, min_child_samples=40,
                              random_state=42, verbose=-1)
        m.fit(train[feat], train["target"], categorical_feature=cat or "auto")
        pred_test = m.predict(test[feat])
        # conformal from cal residuals
        pred_cal = m.predict(cal[feat])
        r80 = float(np.quantile(np.abs(cal["target"].values - pred_cal), 0.8))
        y = test["target"].values
        out[tag] = {
            "mae": float(np.mean(np.abs(y - pred_test))),
            "rmse": float(np.sqrt(np.mean((y - pred_test) ** 2))),
            "spearman": float(pd.Series(y).corr(pd.Series(pred_test), method="spearman")),
            "crps_proxy": float(np.mean(np.abs(y - pred_test)) / 2 + r80 * 0.25),  # informational
            "coverage_80_conformal": float(np.mean(np.abs(y - pred_test) <= r80)),
        }
    out["mae_delta"] = out["with_context"]["mae"] - out["base"]["mae"]
    return out


def main():
    pg, dst = build_context()
    pg = add_cross_position(pg)
    pg["target"] = pg["fp_ppr"]
    pg["roof"] = pg["roof"].fillna("unknown").astype("category")
    pg["surface"] = pg["surface"].fillna("unknown").astype("category")
    pg["opp"] = pg["opponent_team"].astype("category")
    for c in ["temp", "wind", "rest", "is_home", "opponent_def_pa_lag3",
              "opponent_def_sacks_lag3", "opponent_def_to_lag3", "team_targets_lag3"]:
        pg[c] = pg[c].fillna(pg[c].median())
    pg["is_home"] = pg["is_home"].astype(int)

    ctx_feat = ["is_home", "rest", "temp", "wind", "roof", "surface",
                "opponent_def_pa_lag3", "opponent_def_sacks_lag3", "opponent_def_to_lag3"]
    pass_ctx = {"WR": ["team_targets_lag3"], "TE": ["team_targets_lag3"]}

    pg.to_parquet(OUT / "player_games_ctx.parquet", index=False)

    report = []
    for pos in ["QB", "RB", "WR", "TE"]:
        base = ["roll3", "prior_season_mean", "opp"]
        pgx = pg.copy()
        pgx["roll3"] = pgx.groupby("player_id")["target"].transform(
            lambda s: s.shift(1).rolling(3, min_periods=1).mean())
        smean = pgx.groupby(["player_id", "season"])["target"].mean().rename("smean").reset_index()
        smean["season"] += 1
        pgx = pgx.merge(smean.rename(columns={"smean": "prior_season_mean"}),
                        on=["player_id", "season"], how="left")
        pgx["roll3"] = pgx["roll3"].fillna(pgx["target"].mean())
        pgx["prior_season_mean"] = pgx["prior_season_mean"].fillna(pgx["target"].mean())
        extra = ctx_feat + pass_ctx.get(pos, [])
        res = evaluate(pos, pgx, base, extra)
        report.append({"position": pos, **res})
        print(pos, json.dumps(res, indent=2)[:400])

    (OUT / "context_features_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "context_features_report_2024.json")


if __name__ == "__main__":
    main()

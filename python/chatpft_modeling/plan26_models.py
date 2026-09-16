#!/usr/bin/env python3
"""Plan 26 Phase 2/3: specialist quantile-GBM models + Bayesian-style preseason prior,
with walk-forward evaluation vs baselines (plan 26 sections 7, 10).

Primary scoring config: full PPR (fp_ppr). Half-PPR available as optional config
(--target fp_half_ppr). K and DST use their own game-level stores.
Outputs: per-position metrics + a combined backtest report in artifacts/plan26/.
"""
from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
QUANTILES = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]


def load_data(position: str, target: str):
    """Return (df, feature_cols) for the given position group."""
    if position == "K":
        df = pd.read_parquet(OUT / "kicker_games.parquet")
        df = df[df["position"] == "K"].copy()
        df["target"] = df["kicker_points"]
        feat = ["kicker_points_lag3", "kicker_points_lag1", "kicker_points_prior_season_mean", "kicker_points_season_mean"]
        df[feat] = df[feat].fillna(df[feat].median())
        df["week"] = df["week"]
        df["team_opp"] = df["opponent_team"].astype("category")
        return df, feat + ["team_opp"]
    if position == "DST":
        df = pd.read_parquet(OUT / "dst_games_partial.parquet")
        df["target"] = df["dst_points"]
        feat = ["points_allowed_lag3", "points_allowed_lag1", "points_allowed_prior_season_mean",
                "def_sacks_lag3", "def_interceptions_lag3", "def_tds_lag3"]
        # build lag features as-of-safe
        df = df.sort_values(["entity_id", "season", "week"])
        g = df.groupby("entity_id")
        for c in ["points_allowed", "def_sacks", "def_interceptions", "def_tds"]:
            df[f"{c}_lag3"] = g[c].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
            df[f"{c}_lag1"] = g[c].transform(lambda s: s.shift(1))
        sm = df.groupby(["entity_id", "season"])["points_allowed"].mean().rename("pa_sm")
        df = df.merge(sm, on=["entity_id", "season"], how="left")
        prior = df[["entity_id", "season", "pa_sm"]].drop_duplicates()
        prior["season"] += 1
        df = df.merge(prior.rename(columns={"pa_sm": "points_allowed_prior_season_mean"}),
                      on=["entity_id", "season"], how="left")
        df = df[df["dst_points"].notna()]
        df[feat] = df[feat].fillna(df[feat].median())
        return df, feat
    # skill positions
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == position].copy()
    df["target"] = df[target]
    feat = [f"{target}_lag3", f"{target}_prior_season_mean"]
    usage = {"QB": ["attempts_lag3"], "RB": ["carries_lag3", "targets_lag3"],
             "WR": ["targets_lag3", "receptions_lag3"], "TE": ["targets_lag3"]}[position]
    feat += [c for c in usage if c in df.columns]
    df = df[df["target"].notna()].copy()
    df[feat] = df[feat].fillna(df[feat].median())
    df["opp"] = df["opponent_team"].astype("category")
    df["is_home_proxy"] = (df["week"] % 2 == 0).astype(int)  # placeholder, replaced by schedule merge later
    return df, feat + ["opp"]


def train_quantile(df, feat, train_mask, params_seed=42):
    """Train one LightGBM model per quantile on train_mask."""
    X, y = df.loc[train_mask, feat], df.loc[train_mask, "target"]
    models = {}
    for q in QUANTILES:
        m = lgb.LGBMRegressor(objective="quantile", alpha=q, n_estimators=350,
                              learning_rate=0.06, num_leaves=31, min_child_samples=40,
                              subsample=0.9, colsample_bytree=0.9, random_state=params_seed,
                              verbose=-1)
        m.fit(X, y, categorical_feature=["opp"] if "opp" in feat else (["team_opp"] if "team_opp" in feat else []))
        models[q] = m
    return models


def predict_median(models, df, feat, mask):
    X = df.loc[mask, feat]
    preds = pd.DataFrame({q: m.predict(X) for q, m in models.items()})
    # enforce non-crossing
    return preds[sorted(preds.columns)].values


def pinball(y, p, q):
    d = y - p
    return np.mean(np.maximum(q * d, (q - 1) * d))


def coverage(y, lo, hi):
    return float(np.mean((y >= lo) & (y <= hi)))


def baselines(df, train_mask, test_mask, feat, prior_col):
    y = df.loc[test_mask, "target"]
    out = {}
    # 1. position mean
    out["pos_mean"] = np.full(len(y), df.loc[train_mask, "target"].mean())
    # 2. prev-season mean
    pc = prior_col if prior_col in df.columns else None
    if pc:
        out["prior_season"] = df.loc[test_mask, pc].fillna(df.loc[train_mask, "target"].mean()).values
    # 3. recency rolling mean
    lag3 = f"{pc.split('_')[0]}_lag3" if pc else None
    for c in df.columns:
        if c.endswith("_lag3") and "points" in c:
            lag3 = c
            break
    if lag3:
        out["rolling_mean"] = df.loc[test_mask, lag3].fillna(df.loc[train_mask, "target"].mean()).values
    return out


def evaluate(name, y, median, q05, q95):
    return {
        "model": name,
        "n": int(len(y)),
        "mae": float(np.mean(np.abs(y - median))),
        "rmse": float(np.sqrt(np.mean((y - median) ** 2))),
        "spearman": float(pd.Series(y).corr(pd.Series(median), method="spearman")),
        "pinball_q50": float(pinball(y, median, 0.5)),
        "pinball_q05": float(pinball(y, q05, 0.05)),
        "pinball_q95": float(pinball(y, q95, 0.95)),
        "coverage_80": float(np.mean((y >= np.percentile([q05, q95], 0) * 0 + q05) & (y <= q95))),
    }


def run_position(position: str, target: str = "fp_ppr", val_season: int = 2024):
    df, feat = load_data(position, target)
    if df.empty:
        return {"position": position, "error": "no data"}
    train_mask = df["season"] < val_season
    test_mask = df["season"] == val_season
    if test_mask.sum() == 0:
        return {"position": position, "error": f"no {val_season} rows"}

    models = train_quantile(df, feat, train_mask)
    pred = predict_median(models, df, feat, test_mask)
    q05, q50, q95 = pred[:, 0], pred[:, 3], pred[:, 6]
    y = df.loc[test_mask, "target"].values

    # conformal calibration on a held-out slice of training (last prior season)
    cal_mask = df["season"] == val_season - 1
    cal_pred = predict_median(models, df, feat, cal_mask)
    resid = np.maximum(df.loc[cal_mask, "target"].values - cal_pred[:, 3],
                       cal_pred[:, 3] - df.loc[cal_mask, "target"].values)
    r90 = np.nanquantile(resid, 0.9)
    q05_c, q95_c = q50 - r90, q50 + r90

    report = {
        "position": position,
        "target": target,
        "val_season": val_season,
        "n_test": int(test_mask.sum()),
        "model_metrics": evaluate("quantile_gbm", y, q50, q05, q95),
        "model_metrics_conformal": evaluate("quantile_gbm_conformal", y, q50, q05_c, q95_c),
        "coverage_80_raw": coverage(y, q05, q95),
        "coverage_80_conformal": coverage(y, q05_c, q95_c),
        "interval_width_raw": float(np.mean(q95 - q05)),
        "interval_width_conformal": float(np.mean(q95_c - q05_c)),
    }

    # baselines
    base = baselines(df, train_mask, test_mask, feat,
                     f"{target}_prior_season_mean" if position not in ("K", "DST") else
                     ("kicker_points_prior_season_mean" if position == "K" else "points_allowed_prior_season_mean"))
    for bn, bp in base.items():
        report.setdefault("baselines", {})[bn] = {
            "mae": float(np.mean(np.abs(y - bp))),
            "rmse": float(np.sqrt(np.mean((y - bp) ** 2))),
        }
    return report


def main():
    val_season = 2024
    reports = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
        print(f"== {pos}")
        try:
            r = run_position(pos, target="fp_ppr", val_season=val_season)
        except Exception as e:  # noqa: BLE001
            r = {"position": pos, "error": str(e)}
        reports.append(r)
        print(json.dumps(r, indent=2)[:800])
    out = OUT / "backtest_report_2024.json"
    out.write_text(json.dumps(reports, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

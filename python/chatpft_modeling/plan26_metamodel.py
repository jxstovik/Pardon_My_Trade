#!/usr/bin/env python3
"""Plan 26 Phase 5: metamodel (constrained superlearner) + conformal calibration.

Combines out-of-fold component forecasts per plan section 9:
  - Bayesian weekly posterior mean (production spine prior component)
  - Quantile GBM median
Constrained non-negative weighted blend by position, with weights chosen on a
validation season (2023) and applied to the test season (2024). Rolling conformal
calibration of the blended distribution using 2023 residuals.

Design notes (per plan):
  - No in-sample component training: GBM trains on <2023, metamodel weights fit
    on 2023, evaluated on 2024. Bayesian component uses pre-2023 data for
    weight-fitting consistency and continues updating through 2023 for the
    2024 evaluation, exactly as in plan26_bayes.py.
  - Quantile crossing repaired by sorting.
  - Conformal: absolute-residual quantile from 2023 blend residuals, applied to
    2024 blended median intervals (symmetric split conformal).
Outputs: artifacts/plan26/metamodel_report_2024.json
"""
from __future__ import annotations

import json
from math import erf, exp, pi, sqrt
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
VAL_SEASON = 2024
CAL_SEASON = 2023
LAMBDA = 0.97


def crps_normal(y: np.ndarray, mu: np.ndarray, sd: np.ndarray) -> np.ndarray:
    out = np.empty(len(y))
    for i, (yy, m, s) in enumerate(zip(y, mu, sd)):
        z = (yy - m) / s
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        phi = exp(-0.5 * z * z) / sqrt(2 * pi)
        out[i] = s * (z * (2 * Phi - 1) + 2 * phi - 1 / sqrt(pi))
    return out


# ---------------------------------------------------------------- components

def gbm_component(position: str, test_season: int, train_through: int):
    """Quantile GBM median for one season, trained strictly before train_through."""
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == position].copy()
    df["target"] = df["fp_ppr"]
    df = df[df["target"].notna()].sort_values(["player_id", "season", "week"])
    df["roll3"] = df.groupby("player_id")["target"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    prior = df.groupby(["player_id", "season"])["target"].mean().rename("smean").reset_index()
    prior["season"] += 1
    df = df.merge(prior.rename(columns={"smean": "prior_season_mean"}),
                  on=["player_id", "season"], how="left")
    feat = ["roll3", "prior_season_mean"]
    df[feat] = df[feat].fillna(df["target"].mean())
    test = df[df["season"] == test_season]
    train = df[(df["season"] < train_through)]
    if test.empty or train.empty:
        return None
    m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=350,
                          learning_rate=0.06, num_leaves=31, min_child_samples=40,
                          subsample=0.9, colsample_bytree=0.9, random_state=42, verbose=-1)
    m.fit(train[feat], train["target"])
    pred = m.predict(test[feat])
    return test[["player_id", "week", "target"]].assign(gbm=pred).reset_index(drop=True)


class State:
    def __init__(self, mean, var, sigma2, n_eff=0.0):
        self.mean, self.var, self.sigma2, self.n_eff = mean, var, sigma2, n_eff

    def observe(self, x):
        if x is None or np.isnan(x):
            self.var *= 1.5
            self.n_eff *= LAMBDA
            return
        self.n_eff = LAMBDA * self.n_eff + 1.0
        pp = 1.0 / max(self.var, 1e-9)
        po = self.n_eff / self.sigma2
        self.mean = (pp * self.mean + po * x) / (pp + po)
        self.var = 1.0 / (pp + po)

    def forecast(self):
        return self.mean, sqrt(self.var + self.sigma2)


def bayes_component(position: str, test_season: int, prior_through: int):
    """Bayesian weekly forecasts for test_season; prior from < prior_through."""
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == position].copy()
    df["target"] = df["fp_ppr"]
    df = df[df["target"].notna()].sort_values(["player_id", "season", "week"])
    hist = df[df["season"] < prior_through]
    test = df[df["season"] == test_season]

    grp = hist.groupby("player_id")["target"].agg(["mean", "std", "count"])
    pos_mean = hist["target"].mean()
    tau2 = float(hist.groupby("player_id")["target"].mean().var() or 25.0)
    sigma2 = float((grp["std"] ** 2).mean() or 49.0)
    states = {}
    for pid, r in grp.iterrows():
        pp = 1 / tau2
        pd_ = r["count"] / sigma2
        states[pid] = State((pp * pos_mean + pd_ * r["mean"]) / (pp + pd_),
                            1 / (pp + pd_), sigma2, float(r["count"]))
    pos_sigma2 = float(hist["target"].var() or 49.0)
    rows = []
    for w in sorted(test["week"].unique()):
        wk = test[test["week"] == w]
        for _, r in wk.iterrows():
            pid = r["player_id"]
            st = states.get(pid) or State(pos_mean, tau2, pos_sigma2)
            mu, sd = st.forecast()
            rows.append({"player_id": pid, "week": w, "target": r["target"],
                         "bayes": mu, "bayes_sd": sd})
        done = wk.set_index("player_id")["target"].to_dict()
        for pid in list(states):
            states[pid].observe(done.get(pid, np.nan))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- metamodel

def fit_weights(comp: pd.DataFrame):
    """Non-negative weights summing to 1, minimizing MAE of the blend (simple grid)."""
    best_w, best_mae = (0.5, 0.5), np.inf
    y = comp["target"].values
    for w in np.linspace(0, 1, 21):
        blend = w * comp["gbm"].values + (1 - w) * comp["bayes"].values
        mae = np.mean(np.abs(y - blend))
        if mae < best_mae:
            best_mae, best_w = mae, (w, 1 - w)
    return {"gbm": best_w[0], "bayes": best_w[1]}, best_mae


def main():
    report = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
        print(f"== {pos}")
        try:
            entry = {"position": pos}
            # ---- weight fitting on 2023 (components trained on <2023)
            comp_cal = None
            if pos in ("K", "DST"):
                comp_cal = kdst_component(pos, CAL_SEASON, prior_through=CAL_SEASON)
            else:
                g = gbm_component(pos, CAL_SEASON, train_through=CAL_SEASON)
                b = bayes_component(pos, CAL_SEASON, prior_through=CAL_SEASON)
                if g is not None and b is not None:
                    comp_cal = g.merge(b, on=["player_id", "week", "target"], how="inner")
            if comp_cal is None or comp_cal.empty:
                entry["error"] = "no calibration component overlap"
                report.append(entry)
                continue
            weights, cal_mae = fit_weights(comp_cal)
            entry["weights_2023"] = weights

            # conformal residual scale from 2023 blend
            blend_cal = weights["gbm"] * comp_cal["gbm"].values + weights["bayes"] * comp_cal["bayes"].values
            resid = np.abs(comp_cal["target"].values - blend_cal)
            r80 = float(np.quantile(resid, 0.8))
            crps_cal = float(np.mean(crps_normal(
                comp_cal["target"].values, blend_cal,
                np.maximum(resid.std(), 1e-6) * np.ones(len(resid)))))

            # ---- 2024 evaluation
            if pos in ("K", "DST"):
                comp_test = kdst_component(pos, VAL_SEASON, prior_through=CAL_SEASON)
            else:
                g = gbm_component(pos, VAL_SEASON, train_through=CAL_SEASON)
                b = bayes_component(pos, VAL_SEASON, prior_through=CAL_SEASON)
                comp_test = g.merge(b, on=["player_id", "week", "target"], how="inner")
            if comp_test is None or comp_test.empty:
                entry["error"] = "no test overlap"
                report.append(entry)
                continue
            blend = weights["gbm"] * comp_test["gbm"].values + weights["bayes"] * comp_test["bayes"].values
            y = comp_test["target"].values
            sd_blend = np.maximum(np.std(comp_cal["target"].values - blend_cal), 1e-6)
            entry.update({
                "n_test": len(y),
                "metamodel_2023_mae": float(cal_mae),
                "conformal_r80_2023": r80,
                "crps_2023": crps_cal,
                "metamodel_2024_mae": float(np.mean(np.abs(y - blend))),
                "metamodel_2024_rmse": float(np.sqrt(np.mean((y - blend) ** 2))),
                "metamodel_2024_spearman": float(pd.Series(y).corr(pd.Series(blend), method="spearman")),
                "crps_2024": float(np.mean(crps_normal(y, blend, sd_blend * np.ones(len(y))))),
                "coverage_80_conformal": float(np.mean(np.abs(y - blend) <= r80)),
            })
            # component-only references on the same rows
            entry["gbm_only_mae"] = float(np.mean(np.abs(y - comp_test["gbm"].values)))
            entry["bayes_only_mae"] = float(np.mean(np.abs(y - comp_test["bayes"].values)))
            report.append(entry)
            print(json.dumps(entry, indent=2)[:500])
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            report.append({"position": pos, "error": str(e)})
    (OUT / "metamodel_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "metamodel_report_2024.json")


def kdst_component(pos: str, test_season: int, prior_through: int):
    if pos == "K":
        df = pd.read_parquet(OUT / "kicker_games.parquet")
        df["target"] = df["kicker_points"]
    else:
        df = pd.read_parquet(OUT / "dst_games_partial.parquet")
        df["target"] = df["dst_points"]
    df = df[df["target"].notna()].sort_values(["entity_id", "season", "week"])
    df = df.reset_index(drop=True)
    df["roll3"] = df.groupby("entity_id")["target"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    prior = df.groupby(["entity_id", "season"])["target"].mean().rename("smean").reset_index()
    prior["season"] += 1
    df = df.merge(prior.rename(columns={"smean": "prior_season_mean"}),
                  on=["entity_id", "season"], how="left")
    df["pid"] = df["entity_id"]
    feat = ["roll3", "prior_season_mean"]
    df[feat] = df[feat].fillna(df["target"].mean())
    test = df[df["season"] == test_season]
    train = df[df["season"] < prior_through]
    if test.empty or train.empty:
        return None
    m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=300,
                          learning_rate=0.06, num_leaves=31, min_child_samples=40,
                          random_state=42, verbose=-1)
    m.fit(train[feat], train["target"])
    out = test[["pid", "week", "target"]].rename(columns={"pid": "player_id"}).assign(gbm=m.predict(test[feat])).reset_index(drop=True)
    b = bayes_kdst(pos, test_season, prior_through)
    return out.merge(b, on=["player_id", "week", "target"], how="inner")


def bayes_kdst(pos: str, test_season: int, prior_through: int):
    if pos == "K":
        df = pd.read_parquet(OUT / "kicker_games.parquet")
        df["target"] = df["kicker_points"]
    else:
        df = pd.read_parquet(OUT / "dst_games_partial.parquet")
        df["target"] = df["dst_points"]
    df = df[df["target"].notna()].sort_values(["entity_id", "season", "week"])
    hist = df[df["season"] < prior_through]
    test = df[df["season"] == test_season]
    grp = hist.groupby("entity_id")["target"].agg(["mean", "std", "count"])
    pos_mean = hist["target"].mean()
    tau2 = float(grp["mean"].var() or 25.0)
    sigma2 = float((grp["std"] ** 2).mean() or 49.0)
    states = {}
    for pid, r in grp.iterrows():
        pp = 1 / tau2
        po = r["count"] / sigma2
        states[pid] = State((pp * pos_mean + po * r["mean"]) / (pp + po), 1 / (pp + po), sigma2, float(r["count"]))
    rows = []
    for w in sorted(test["week"].unique()):
        wk = test[test["week"] == w]
        for _, r in wk.iterrows():
            pid = r["entity_id"]
            st = states.get(pid) or State(pos_mean, tau2, sigma2)
            mu, sd = st.forecast()
            rows.append({"player_id": pid, "week": w, "target": r["target"], "bayes": mu, "bayes_sd": sd})
        done = wk.set_index("entity_id")["target"].to_dict()
        for pid in list(states):
            states[pid].observe(done.get(pid, np.nan))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    main()

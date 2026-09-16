#!/usr/bin/env python3
"""Plan 26 Phase 5 completion: availability-aware metamodel.

Blends three components per player-week on the identical 2024 fold:
  1. Quantile-GBM median (usage-driven sharpness)
  2. Bayesian weekly posterior mean (prior spine)
  3. Joint-NN conditional mean x P(active) (availability-aware expectation)
Weights fit on 2023 out-of-sample rows (non-negative, sum=1, MAE grid).
Conformal 80% intervals from 2023 blend residuals.

The NN component's P(active) multiplies its conditional mean, so the blend
learns how much weight the availability-aware expectation deserves per position.
Outputs: artifacts/plan26/metamodel_aware_report_2024.json
"""
from __future__ import annotations

import json
from math import erf, exp, pi, sqrt
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
CAL_SEASON = 2023
VAL_SEASON = 2024
LAMBDA = 0.97


def crps_normal(y, mu, sd):
    out = np.empty(len(y))
    for i, (yy, m, s) in enumerate(zip(y, mu, sd)):
        z = (yy - m) / s
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        phi = exp(-0.5 * z * z) / sqrt(2 * pi)
        out[i] = s * (z * (2 * Phi - 1) + 2 * phi - 1 / sqrt(pi))
    return out


def gbm_component(position: str, test_season: int, train_through: int):
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == position].copy()
    df["target"] = df["fp_ppr"]
    df = df[df["target"].notna()].sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    df["roll3"] = df.groupby("player_id")["target"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    prior = df.groupby(["player_id", "season"])["target"].mean().rename("smean").reset_index()
    prior["season"] += 1
    df = df.merge(prior.rename(columns={"smean": "prior_season_mean"}), on=["player_id", "season"], how="left")
    feat = ["roll3", "prior_season_mean"]
    df[feat] = df[feat].fillna(df["target"].mean())
    test = df[df["season"] == test_season]
    train = df[df["season"] < train_through]
    if test.empty or train.empty:
        return None
    import lightgbm as lgb
    m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=350,
                          learning_rate=0.06, num_leaves=31, min_child_samples=40,
                          random_state=42, verbose=-1)
    m.fit(train[feat], train["target"])
    return test[["player_id", "week", "target"]].assign(gbm=m.predict(test[feat])).reset_index(drop=True)


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
        po = r["count"] / sigma2
        states[pid] = State((pp * pos_mean + po * r["mean"]) / (pp + po), 1 / (pp + po), sigma2, float(r["count"]))
    rows = []
    for w in sorted(test["week"].unique()):
        wk = test[test["week"] == w]
        for _, r in wk.iterrows():
            pid = r["player_id"]
            st = states.get(pid) or State(pos_mean, tau2, sigma2)
            mu, sd = st.forecast()
            rows.append({"player_id": pid, "week": w, "target": r["target"], "bayes": mu})
        done = wk.set_index("player_id")["target"].to_dict()
        for pid in list(states):
            states[pid].observe(done.get(pid, np.nan))
    return pd.DataFrame(rows)


def nn_component(position: str, test_season: int, prior_through: int, seeds=(11, 22, 33)):
    """Run the v2 joint-NN table build for one position; return NN-conditional mean
    x P(active) per row. Trains one small ensemble (3 seeds) — enough for the blend."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "v2", str(Path(__file__).resolve().parent / "plan26_joint_nn_v2.py"))
    v2 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v2)
    tbl, _ = v2.build_table()
    cal_rows = tbl[(tbl["position"] == position) & (tbl["season"].isin([test_season, prior_through]))]
    if cal_rows.empty:
        return None
    models = [v2.train_one(tbl, list(range(2010, prior_through)), s) for s in seeds]
    # predict on both seasons; compute P(active) from the availability head
    import torch
    frames = []
    for season in (prior_through, test_season):
        sl = tbl[(tbl["position"] == position) & (tbl["season"] == season)].reset_index(drop=True)
        if sl.empty:
            continue
        Xdf = sl[v2.NUM_COLS].copy()
        Xdf = Xdf.fillna(Xdf.median()).fillna(0.0)
        X = torch.tensor(Xdf.values, dtype=torch.float32)
        P = torch.tensor(sl["pos_id"].values.astype(int), dtype=torch.long)
        mus, avs = [], []
        with torch.no_grad():
            for m in models:
                m.eval()
                mu, _lv, av, _, _ = m(X, P)
                mus.append(mu.numpy())
                avs.append(av.numpy())
        mu = np.mean(mus, 0)
        p_active = 1 / (1 + np.exp(-np.mean(avs, 0)))
        frames.append(pd.DataFrame({
            "player_id": sl["player_id"], "week": sl["week"], "season": season,
            "target": sl["target"], "nn_ev": mu * p_active,
            "p_active": p_active,
        }))
    out = pd.concat(frames, ignore_index=True)
    return out


def fit3(comp: pd.DataFrame):
    y = comp["target"].values
    g, b, n = comp["gbm"].values, comp["bayes"].values, comp["nn_ev"].values
    best, best_mae = (0.5, 0.5, 0.0), np.inf
    for wg in np.linspace(0, 1, 11):
        for wb in np.linspace(0, 1 - wg, 11):
            wn = 1 - wg - wb
            mae = np.mean(np.abs(y - (wg * g + wb * b + wn * n)))
            if mae < best_mae:
                best_mae, best = mae, (wg, wb, wn)
    return {"gbm": round(best[0], 2), "bayes": round(best[1], 2), "nn_ev": round(best[2], 2)}, best_mae


def main():
    report = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
        print(f"== {pos}")
        try:
            comp_cal = None
            # 2023 components (GBM trains <2023, Bayes prior <2023)
            g = gbm_component(pos, CAL_SEASON, CAL_SEASON)
            b = bayes_component(pos, CAL_SEASON, CAL_SEASON)
            nn = nn_component(pos, CAL_SEASON, CAL_SEASON)
            if g is not None and b is not None and nn is not None:
                comp_cal = g.merge(b, on=["player_id", "week", "target"]).merge(
                    nn[nn.season == CAL_SEASON][["player_id", "week", "nn_ev", "p_active"]],
                    on=["player_id", "week"], how="inner")
            if comp_cal is None or comp_cal.empty:
                report.append({"position": pos, "error": "no cal overlap"})
                continue
            weights, cal_mae = fit3(comp_cal)
            blend_cal = (weights["gbm"] * comp_cal["gbm"].values
                         + weights["bayes"] * comp_cal["bayes"].values
                         + weights["nn_ev"] * comp_cal["nn_ev"].values)
            resid = np.abs(comp_cal["target"].values - blend_cal)
            r80 = float(np.quantile(resid, 0.8))

            # 2024 components
            g24 = gbm_component(pos, VAL_SEASON, CAL_SEASON)
            b24 = bayes_component(pos, VAL_SEASON, CAL_SEASON)
            nn24 = nn_component(pos, VAL_SEASON, CAL_SEASON)
            if g24 is None or b24 is None or nn24 is None:
                report.append({"position": pos, "error": "no test component"})
                continue
            comp_test = g24.merge(b24, on=["player_id", "week", "target"]).merge(
                nn24[nn24.season == VAL_SEASON][["player_id", "week", "nn_ev", "p_active"]],
                on=["player_id", "week"], how="inner")
            blend = (weights["gbm"] * comp_test["gbm"].values
                     + weights["bayes"] * comp_test["bayes"].values
                     + weights["nn_ev"] * comp_test["nn_ev"].values)
            y = comp_test["target"].values
            entry = {
                "position": pos,
                "weights_2023": weights,
                "n_test": len(y),
                "meta3_mae": float(np.mean(np.abs(y - blend))),
                "meta3_rmse": float(np.sqrt(np.mean((y - blend) ** 2))),
                "meta3_spearman": float(pd.Series(y).corr(pd.Series(blend), method="spearman")),
                "crps_2024": float(np.mean(crps_normal(y, blend, np.maximum(resid.std(), 1e-6) * np.ones(len(y))))),
                "coverage_80_conformal": float(np.mean(np.abs(y - blend) <= r80)),
                "gbm_only_mae": float(np.mean(np.abs(y - comp_test["gbm"].values))),
                "bayes_only_mae": float(np.mean(np.abs(y - comp_test["bayes"].values))),
                "nn_ev_only_mae": float(np.mean(np.abs(y - comp_test["nn_ev"].values))),
                "mean_p_active_test": float(comp_test["p_active"].mean()),
            }
            report.append(entry)
            print(json.dumps({k: entry[k] for k in ["weights_2023", "meta3_mae", "gbm_only_mae", "nn_ev_only_mae", "coverage_80_conformal"]}, indent=1)[:400])
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            report.append({"position": pos, "error": str(e)})
    (OUT / "metamodel_aware_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "metamodel_aware_report_2024.json")


if __name__ == "__main__":
    main()

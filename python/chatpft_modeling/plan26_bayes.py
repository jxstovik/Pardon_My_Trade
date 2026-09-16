#!/usr/bin/env python3
"""Plan 26 Phase 2/3: hierarchical Bayesian preseason prior + sequential weekly
state-space update (plan sections 7.1-7.2), production-spine candidate.

Model (conjugate normal, empirical Bayes — the "if PyMC/NumPyro unavailable" path):
  Preseason prior, season S, player p:
    theta_p ~ N(m0_pos, tau2_pos)            # partial pooling toward position mean
    x_pt    ~ N(theta_p, sigma2_p)           # game scores
    prior mean/var = precision-weighted blend of player sample and position prior.
  Weekly update (Kalman-like with recency decay):
    n_eff <- lambda * n_eff                  # decay, lambda=0.97
    n_eff <- n_eff + 1 on an observed game; mean moves by Kalman gain
    variance inflates (x1.5) after a missed game / absence.
  Forecast distribution for week t+1 given weeks <= t:
    mean = posterior theta_hat, sd = sqrt(posterior_var + sigma2), normal quantiles
    mixture with availability: E[pts] = P(active)*mean; P(active) from games-played rate.

Evaluation: 2024 walk-forward, weeks 1..18, information only through prior week.
Baselines: preseason-only prior (no weekly updates), rolling lag3 mean.
Outputs: artifacts/plan26/bayes_report_2024.json + prior artifact json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
QUANTILES = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]
LAMBDA = 0.97
VAL_SEASON = 2024
MODEL_VERSION = "bayes-eb-v1"


def normal_crps(y: np.ndarray, mu: np.ndarray, sd: np.ndarray) -> np.ndarray:
    """Closed-form CRPS for N(mu, sd^2)."""
    z = (y - mu) / sd
    phi = np.exp(-0.5 * z ** 2) / np.sqrt(2 * np.pi)
    Phi = 0.5 * (1 + np.erf(z / np.sqrt(2))) if hasattr(np, "erf") else 0.5 * (1 + np.vectorize(__import__("math").erf)(z / np.sqrt(2)))
    return sd * (z * (2 * Phi - 1) + 2 * phi - 1 / np.sqrt(np.pi))


def crps(y, mu, sd):
    from math import erf, sqrt, pi, exp
    out = np.empty(len(y))
    for i, (yy, m, s) in enumerate(zip(y, mu, sd)):
        z = (yy - m) / s
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        phi = exp(-0.5 * z * z) / sqrt(2 * pi)
        out[i] = s * (z * (2 * Phi - 1) + 2 * phi - 1 / sqrt(pi))
    return out


class WeeklyState:
    """Per-player sequential normal state with recency decay."""

    def __init__(self, mean: float, var: float, sigma2: float, n_eff: float = 0.0):
        self.mean = mean
        self.var = var          # posterior variance of latent ability
        self.sigma2 = sigma2    # per-game observation noise
        self.n_eff = n_eff

    def observe(self, x: float | None):
        if x is None or np.isnan(x):
            # absence: inflate uncertainty
            self.var *= 1.5
            self.n_eff *= LAMBDA
            return
        self.n_eff = LAMBDA * self.n_eff + 1.0
        k = self.sigma2 / (self.sigma2 + self.n_eff * self.var * self.n_eff / max(self.n_eff, 1e-9)) if False else None
        # Kalman-style gain using observation-noise vs effective evidence
        prec_prior = 1.0 / max(self.var, 1e-9)
        prec_obs = self.n_eff / self.sigma2
        post_prec = prec_prior + prec_obs
        new_mean = (prec_prior * self.mean + prec_obs * x) / post_prec
        # decay old evidence slightly
        self.mean = LAMBDA * self.mean + (1 - LAMBDA) * new_mean + (1 - LAMBDA) * 0 if False else new_mean
        self.var = 1.0 / post_prec

    def forecast(self):
        return self.mean, np.sqrt(self.var + self.sigma2)


def preseason_prior(hist: pd.DataFrame, pos_mean_prior_strength: float = 4.0):
    """Empirical-Bayes hierarchical prior from all data strictly before the target season."""
    grp = hist.groupby("player_id")["target"].agg(["mean", "std", "count"])
    mu_p = hist.groupby("position")["target"].agg(["mean", "std"])
    pos_mean = mu_p["mean"].to_dict()
    # between-player variance within position
    tau2 = grp.join(hist.drop_duplicates("player_id").set_index("player_id")["position"]) \
        .groupby("position")["mean"].var().to_dict()
    sigma2 = (grp["std"] ** 2).groupby(hist.drop_duplicates("player_id").set_index("player_id")["position"]).mean().to_dict()
    tau2 = {k: (v if v and not np.isnan(v) and v > 0 else 25.0) for k, v in tau2.items()}
    prior = {}
    for pid, row in grp.iterrows():
        pos = hist.drop_duplicates("player_id").set_index("player_id").loc[pid, "position"]
        s2 = sigma2.get(pos, 49.0)
        t2 = tau2.get(pos, 25.0)
        n = row["count"]
        prec_p = 1.0 / t2
        prec_d = n / s2
        prior[pid] = {
            "position": pos,
            "prior_mean": float((prec_p * pos_mean[pos] + prec_d * row["mean"]) / (prec_p + prec_d)),
            "prior_var": float(1.0 / (prec_p + prec_d)),
            "sigma2": float(s2),
            "n": int(n),
        }
    return prior


def run_position(position: str, target_col: str = "target"):
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == position].copy()
    df["target"] = df["fp_ppr"]
    df = df[df["target"].notna()].sort_values(["player_id", "season", "week"])

    hist = df[df["season"] < VAL_SEASON]
    test = df[df["season"] == VAL_SEASON]
    prior = preseason_prior(hist)

    # fallback prior for players unseen before 2024: position mean, wide var
    pos_mean = hist.groupby("position")["target"].mean().to_dict()
    pos_sigma2 = hist.groupby("position")["target"].var().to_dict()

    # player identity: nflverse ids are stable, but player_position can drift.
    # Key states by player_id only.
    weeks = sorted(test["week"].unique())
    states = {}
    for pid, p in prior.items():
        states[pid] = WeeklyState(p["prior_mean"], p["prior_var"], p["sigma2"], n_eff=float(p["n"]))
    states_preseason_only = {pid: WeeklyState(p["prior_mean"], p["prior_var"], p["sigma2"], float(p["n"]))
                             for pid, p in prior.items()}

    # games-played rate for availability
    played = hist.groupby("player_id")["did_play"].mean().to_dict() if "did_play" in hist.columns else {}

    rows, rows_pre = [], []
    for w in weeks:
        wk = test[test["week"] == w]
        for _, r in wk.iterrows():
            pid = r["player_id"]
            st = states.get(pid) or WeeklyState(pos_mean.get(position, 7.0), pos_sigma2.get(position, 49.0),
                                                pos_sigma2.get(position, 49.0))
            st_pre = states_preseason_only.get(pid) or st
            mu, sd = st.forecast()
            mu_pre, sd_pre = st_pre.forecast()
            p_active = played.get(pid, 0.75)
            rows.append({"player_id": pid, "week": w, "y": r["target"], "mu": mu, "sd": sd,
                         "mu_ev": p_active * mu, "p_active": p_active})
            rows_pre.append({"player_id": pid, "week": w, "y": r["target"], "mu": mu_pre, "sd": sd_pre})
        # advance states with completed week w actuals (all players, missing = None)
        done = test[test["week"] == w].set_index("player_id")["target"].to_dict()
        for pid in list(states):
            states[pid].observe(done.get(pid, np.nan))
    return pd.DataFrame(rows), pd.DataFrame(rows_pre)


def metrics(rows: pd.DataFrame, label: str, ev: bool = False):
    y = rows["y"].values
    mu, sd = rows["mu"].values, rows["sd"].values
    label_full = f"{label}_ev_mixture" if ev and "mu_ev" in rows.columns else label
    if ev and "mu_ev" in rows.columns:
        mu = rows["mu_ev"].values
    q05 = mu - 1.2816 * sd
    q95 = mu + 1.2816 * sd
    q50 = mu
    return {
        "model": label_full,
        "n": len(y),
        "mae": float(np.mean(np.abs(y - q50))),
        "rmse": float(np.sqrt(np.mean((y - q50) ** 2))),
        "spearman": float(rows["y"].corr(rows["mu"], method="spearman")),
        "crps": float(np.mean(crps(y, mu, sd))),
        "coverage_80": float(np.mean((y >= q05) & (y <= q95))),
        "interval_width": float(np.mean(q95 - q05)),
    }


def main():
    report = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
        print(f"== {pos}")
        try:
            if pos in ("K", "DST"):
                rows, rows_pre = run_kdst(pos)
            else:
                rows, rows_pre = run_position(pos)
            m_now = metrics(rows, "bayes_weekly")
            m_now_ev = metrics(rows, "bayes_weekly", ev=True)
            m_pre = metrics(rows_pre, "bayes_preseason_only")
            # rolling-mean baseline
            df = base_df(pos)
            roll = df[df["season"] == VAL_SEASON]
            m_roll = {"model": "rolling_mean", "n": len(roll),
                      "mae": float(np.mean(np.abs(roll["target"] - roll["roll3"]))),
                      "rmse": float(np.sqrt(np.mean((roll["target"] - roll["roll3"]) ** 2))),
                      "spearman": float(roll["target"].corr(roll["roll3"], method="spearman"))}
            entry = {"position": pos, "weekly": m_now, "weekly_ev_mixture": m_now_ev,
                     "preseason_only": m_pre, "rolling": m_roll}
            report.append(entry)
            print(json.dumps(entry, indent=2)[:600])
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            report.append({"position": pos, "error": str(e)})
    (OUT / "bayes_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "bayes_report_2024.json")


def base_df(pos: str) -> pd.DataFrame:
    df = pd.read_parquet(OUT / "player_games.parquet")
    df = df[df["position"] == pos].copy()
    df["target"] = df["fp_ppr"]
    df = df[df["target"].notna()].sort_values(["player_id", "season", "week"])
    df["roll3"] = df.groupby("player_id")["target"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    return df


def run_kdst(pos: str):
    """K and DST use their game-level stores with the same state machine."""
    if pos == "K":
        df = pd.read_parquet(OUT / "kicker_games.parquet")
        df["target"] = df["kicker_points"]
        id_col = "entity_id"
    else:
        df = pd.read_parquet(OUT / "dst_games_partial.parquet")
        df["target"] = df["dst_points"]
        id_col = "entity_id"
    df = df[df["target"].notna()].sort_values([id_col, "season", "week"])
    df["roll3"] = df.groupby(id_col)["target"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())

    hist = df[df["season"] < VAL_SEASON]
    test = df[df["season"] == VAL_SEASON]
    grp = hist.groupby(id_col)["target"].agg(["mean", "std", "count"])
    pos_mean, pos_var = hist["target"].mean(), hist["target"].var()
    sigma2 = float((grp["std"] ** 2).mean())
    tau2 = float(grp["mean"].var() or 25.0)
    states, states_pre = {}, {}
    for pid, row in grp.iterrows():
        prec_p = 1 / tau2
        prec_d = row["count"] / sigma2
        pm = (prec_p * pos_mean + prec_d * row["mean"]) / (prec_p + prec_d)
        pv = 1 / (prec_p + prec_d)
        states[pid] = WeeklyState(pm, pv, sigma2, float(row["count"]))
        states_pre[pid] = WeeklyState(pm, pv, sigma2, float(row["count"]))
    rows, rows_pre = [], []
    for w in sorted(test["week"].unique()):
        wk = test[test["week"] == w]
        for _, r in wk.iterrows():
            st = states.get(r[id_col]) or WeeklyState(pos_mean, tau2, sigma2)
            mu, sd = st.forecast()
            mu_pre, sd_pre = states_pre[r[id_col]].forecast() if r[id_col] in states_pre else (mu, sd)
            rows.append({"player_id": r[id_col], "week": w, "y": r["target"], "mu": mu, "sd": sd})
            rows_pre.append({"player_id": r[id_col], "week": w, "y": r["target"], "mu": mu_pre, "sd": sd_pre})
        done = wk.set_index(id_col)["target"].to_dict()
        for pid in list(states):
            states[pid].observe(done.get(pid, np.nan))
    return pd.DataFrame(rows), pd.DataFrame(rows_pre)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Plan 26 Phase 4 v2: joint multi-task NN with K/DST rows, true availability
labels, deep ensembles, and game-level auxiliary heads.

Upgrades over plan26_joint_nn.py (per plan sections 4, 8):
1. K and DST rows joined into one training table (plan 3.3 target units:
   kicker-game and team-game).
2. Availability labels: rows for team-games where the player/kicker unit did
   NOT appear get did_play=0 (target masked). Sources: player_stats rows define
   played games; games.csv team-game schedule defines the full week set. NOTE
   (documented): missingness is a *proxy* mixing byes, healthy scratches and
   injuries — plan section 4 rule 6; must be split by a real injury source.
   DST units always play (avail=1 by construction).
3. Deep ensemble: 5 seeds; mixture variance (mean of var + var of means).
4. Game-level aux heads: trunk predicts team points scored/allowed for the
   row's team-game (training-only signal, plan section 8 auxiliary tasks).

Evaluation: 2024 fold — train <2023, conformal z on 2023, test 2024.
  - conditional MAE/CRPS on played rows
  - availability AUC on all rows (played vs not)
  - 80% coverage (conformal) on played rows
Outputs: artifacts/plan26/joint_nn_v2_report_2024.json
"""
from __future__ import annotations

import json
from math import erf, exp, pi, sqrt
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
VAL_SEASON = 2024
CAL_SEASON = 2023
SEEDS = [11, 22, 33, 44, 55]
AUX_W = 0.1
N_EPOCHS = 50

POS = ["QB", "RB", "WR", "TE", "K", "DST"]
POS_ID = {p: i for i, p in enumerate(POS)}


def crps_normal(y, mu, sd):
    out = np.empty(len(y))
    for i, (yy, m, s) in enumerate(zip(y, mu, sd)):
        z = (yy - m) / s
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        phi = exp(-0.5 * z * z) / sqrt(2 * pi)
        out[i] = s * (z * (2 * Phi - 1) + 2 * phi - 1 / sqrt(pi))
    return out


def load_games():
    p = OUT / "raw" / "games.csv"
    g = pd.read_csv(p, low_memory=False)
    g = g[g["game_type"] == "REG"]
    away = pd.DataFrame({"season": g.season, "week": g.week, "team": g.away_team,
                         "opponent": g.home_team, "pts": g.away_score, "opp_pts": g.home_score,
                         "is_home": 0, "temp": g.temp, "wind": g.wind, "rest": g.away_rest,
                         "roof": g.roof, "surface": g.surface})
    home = pd.DataFrame({"season": g.season, "week": g.week, "team": g.home_team,
                         "opponent": g.away_team, "pts": g.home_score, "opp_pts": g.away_score,
                         "is_home": 1, "temp": g.temp, "wind": g.wind, "rest": g.home_rest,
                         "roof": g.roof, "surface": g.surface})
    sched = pd.concat([away, home], ignore_index=True)
    return sched


def add_rolling(df: pd.DataFrame, id_col: str) -> pd.DataFrame:
    df = df.sort_values([id_col, "season", "week"]).reset_index(drop=True)
    g = df.groupby(id_col)["target"]
    df["roll3"] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["roll5"] = g.transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    df["played_rate"] = g.transform(lambda s: s.shift(1).expanding().count() /
                                    s.shift(1).expanding().apply(lambda a: max(len(a), 1)))
    return df


def build_table():
    """One table: player-game (skill + K) and team-game (DST) rows, played + missing."""
    sched = load_games()

    # ---------- skill players ----------
    pg = pd.read_parquet(OUT / "player_games_ctx.parquet")
    pg["target"] = pg["fp_ppr"]
    pg = pg[pg["position"].isin(["QB", "RB", "WR", "TE"])].copy()
    pg = pg[["player_id", "position", "recent_team", "season", "week", "target",
             "is_home", "rest", "temp", "wind", "opponent_def_pa_lag3",
             "opponent_def_sacks_lag3", "opponent_def_to_lag3", "team_targets_lag3"]].copy()

    # player-season team (mode), for enumerating missing team-games
    team_mode = (pg.groupby(["player_id", "season", "position"])["recent_team"]
                 .agg(lambda s: s.mode().iloc[0] if not s.mode().dropna().empty else np.nan)
                 .rename("team").reset_index())
    sched_keys = sched[["season", "week", "team"]].dropna()
    ps = team_mode.dropna().merge(sched_keys, on=["team", "season"], how="left")
    played = pg[["player_id", "season", "week"]].assign(played=1)
    all_games = ps.merge(played, on=["player_id", "season", "week"], how="left")
    missing = all_games[all_games["played"] != 1].copy()
    missing["target"] = np.nan
    missing["did_play"] = 0
    # context for missing rows from schedule
    missing = missing.merge(sched[["season", "week", "team", "is_home", "rest", "temp", "wind"]],
                            on=["season", "week", "team"], how="left", suffixes=("", "_sched"))
    for c in ["is_home", "rest", "temp", "wind"]:
        missing[c] = missing[c].fillna(missing[f"{c}_sched"]) if f"{c}_sched" in missing else missing[c]
        missing.drop(columns=[f"{c}_sched"], inplace=True, errors="ignore")
    pg["did_play"] = 1
    skill = pd.concat([pg, missing], ignore_index=True, sort=False)

    # rolling features: computed on played rows, ffilled to missing rows (as-of safe:
    # missing-row features use only prior played games)
    skill = skill.sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    g = skill.groupby("player_id")["target"]
    skill["roll3"] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    skill["roll5"] = g.transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    skill["played_rate"] = g.transform(lambda s: (s.shift(1).expanding().count() / 17))
    skill = skill.merge(sched[["season", "week", "team", "pts", "opp_pts"]],
                        on=["season", "week", "team"], how="left", suffixes=("", "_g"))
    skill = skill.drop(columns=["is_home_g", "rest_g", "temp_g", "wind_g"], errors="ignore")
    skill["row_type"] = "player"

    # ---------- kickers ----------
    k = pd.read_parquet(OUT / "kicker_games.parquet")
    k["target"] = k["kicker_points"]
    k["position"] = "K"
    k["player_id"] = k["entity_id"]
    k["did_play"] = 1
    kcols = ["player_id", "position", "team", "season", "week", "target", "did_play"]
    kplayed = k[kcols].copy()
    # missing: kicker's team-game weeks with no kicker row
    kteam = (kplayed.groupby(["player_id", "season"])["team"]
             .agg(lambda s: s.mode().iloc[0]).rename("team").reset_index())
    km = kteam.merge(sched_keys, on=["team", "season"], how="left")
    kp = kplayed[["player_id", "season", "week"]].assign(played=1)
    kall = km.merge(kp, on=["player_id", "season", "week"], how="left")
    kmiss = kall[kall["played"] != 1].copy()
    kmiss["target"] = np.nan
    kmiss["did_play"] = 0
    kmiss["position"] = "K"
    kall_rows = pd.concat([kplayed, kmiss], ignore_index=True, sort=False)
    kall_rows = add_rolling(kall_rows, "player_id")
    kall_rows = kall_rows.merge(sched[["season", "week", "team", "is_home", "rest", "temp", "wind", "pts", "opp_pts"]],
                                on=["season", "week", "team"], how="left")
    kall_rows["row_type"] = "kicker"
    # team_targets not meaningful for K
    kall_rows["team_targets_lag3"] = np.nan
    kall_rows["opponent_def_pa_lag3"] = np.nan
    kall_rows["opponent_def_sacks_lag3"] = np.nan
    kall_rows["opponent_def_to_lag3"] = np.nan

    # ---------- DST (always plays) ----------
    d = pd.read_parquet(OUT / "dst_games_partial.parquet")
    d["target"] = d["dst_points"]
    d["position"] = "DST"
    d["player_id"] = d["entity_id"]
    d["did_play"] = 1
    d = d[["player_id", "position", "team", "season", "week", "target", "did_play"]]
    d = d.merge(sched[["season", "week", "team", "is_home", "rest", "temp", "wind", "pts", "opp_pts"]],
                on=["season", "week", "team"], how="left")
    d = add_rolling(d, "player_id")
    d["row_type"] = "dst"
    d["team_targets_lag3"] = np.nan
    d["opponent_def_pa_lag3"] = np.nan
    d["opponent_def_sacks_lag3"] = np.nan
    d["opponent_def_to_lag3"] = np.nan

    cols = ["player_id", "position", "season", "week", "target", "did_play", "row_type",
            "roll3", "roll5", "played_rate", "is_home", "rest", "temp", "wind",
            "opponent_def_pa_lag3", "opponent_def_sacks_lag3", "opponent_def_to_lag3",
            "team_targets_lag3", "pts", "opp_pts"]
    tbl = pd.concat([skill, kall_rows, d], ignore_index=True, sort=False)
    for c in cols:
        if c not in tbl:
            tbl[c] = np.nan
    tbl = tbl[cols]
    tbl["pos_id"] = tbl["position"].map(POS_ID)
    tbl = tbl[tbl["pos_id"].notna()]
    return tbl, sched


NUM_COLS = ["roll3", "roll5", "played_rate", "is_home", "rest", "temp", "wind",
            "opponent_def_pa_lag3", "opponent_def_sacks_lag3", "opponent_def_to_lag3",
            "team_targets_lag3"]


class JointNNv2(nn.Module):
    def __init__(self, n_num: int, hidden: int = 128, emb: int = 4):
        super().__init__()
        self.pos_emb = nn.Embedding(6, emb)
        self.trunk = nn.Sequential(
            nn.Linear(n_num + emb, hidden), nn.LayerNorm(hidden), nn.GELU(),
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(),
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(),
        )
        self.head_mean = nn.ModuleList([nn.Linear(hidden, 1) for _ in range(6)])
        self.head_logvar = nn.ModuleList([nn.Linear(hidden, 1) for _ in range(6)])
        self.head_avail = nn.Linear(hidden, 1)
        self.head_team_pts = nn.Linear(hidden, 1)
        self.head_team_opp_pts = nn.Linear(hidden, 1)

    def forward(self, xnum, xpos):
        e = self.pos_emb(xpos)
        h = self.trunk(torch.cat([xnum, e], dim=-1))
        mean = torch.stack([hm(h)[:, 0] for hm in self.head_mean], dim=1).gather(
            1, xpos.unsqueeze(1)).squeeze(1)
        logvar = torch.stack([hl(h)[:, 0] for hl in self.head_logvar], dim=1).gather(
            1, xpos.unsqueeze(1)).squeeze(1)
        avail = self.head_avail(h)[:, 0]
        tpts = self.head_team_pts(h)[:, 0]
        topts = self.head_team_opp_pts(h)[:, 0]
        return mean, logvar, avail, tpts, topts


def train_one(tbl: pd.DataFrame, seasons: list[int], seed: int):
    torch.manual_seed(seed)
    np.random.seed(seed)
    train = tbl[tbl["season"].isin(seasons) & tbl["pos_id"].notna()].reset_index(drop=True)
    X = torch.tensor(train[NUM_COLS].fillna(train[NUM_COLS].median()).values, dtype=torch.float32)
    P = torch.tensor(train["pos_id"].values.astype(int), dtype=torch.long)
    Y = torch.tensor(train["target"].fillna(0).values, dtype=torch.float32)
    mask = torch.tensor(train["target"].notna().values, dtype=torch.bool)
    A = torch.tensor(train["did_play"].fillna(0).values, dtype=torch.float32)
    TP = torch.tensor(train["pts"].fillna(21).values, dtype=torch.float32)
    TO = torch.tensor(train["opp_pts"].fillna(21).values, dtype=torch.float32)

    model = JointNNv2(len(NUM_COLS))
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=N_EPOCHS)
    n = len(X)
    bs = 512
    for _ in range(N_EPOCHS):
        model.train()
        perm = torch.randperm(n)
        for i in range(0, n, bs):
            idx = perm[i:i + bs]
            mean, logvar, avail, tpts, topts = model(X[idx], P[idx])
            var = torch.exp(logvar).clamp(1e-3, 1e4)
            m = mask[idx]
            nll = (0.5 * (torch.log(var) + (Y[idx] - mean) ** 2 / var))[m].mean() if m.any() else torch.tensor(0.0)
            avail_loss = nn.functional.binary_cross_entropy_with_logits(avail, A[idx])
            aux = nn.functional.mse_loss(tpts, TP[idx]) + nn.functional.mse_loss(topts, TO[idx])
            loss = nll + 0.1 * avail_loss + AUX_W * aux
            opt.zero_grad()
            loss.backward()
            opt.step()
        sched.step()
    return model


def predict_ensemble(models: list, df: pd.DataFrame):
    Xdf = df[NUM_COLS].copy()
    # fill NaN columns (e.g., skill-only features for K/DST slices) with 0 after
    # per-slice median imputation — medians are NaN when the column is all-NaN
    med = Xdf.median()
    Xdf = Xdf.fillna(med).fillna(0.0)
    X = torch.tensor(Xdf.values, dtype=torch.float32)
    P = torch.tensor(df["pos_id"].values.astype(int), dtype=torch.long)
    means, lvars = [], []
    with torch.no_grad():
        for m in models:
            m.eval()
            mu, lv, *_ = m(X, P)
            means.append(mu.numpy())
            lvars.append(np.exp(lv.numpy()))
    M = np.stack(means)      # E x N
    V = np.stack(lvars)
    mu = M.mean(0)
    var = V.mean(0) + M.var(0)
    return mu, np.sqrt(var)


def main():
    tbl, sched = build_table()
    print("table:", len(tbl), "rows; missing-rate by pos:")
    print(tbl.groupby("position")["did_play"].apply(lambda s: 1 - s.mean()).round(3).to_string())

    # ONE ensemble for all positions: train a single set of SEEDS models on the
    # full multi-task table, then evaluate each position head separately.
    models = [train_one(tbl, list(range(2010, CAL_SEASON)), s) for s in SEEDS]
    report = []
    for pos in POS:
        cal = tbl[(tbl["position"] == pos) & (tbl["season"] == CAL_SEASON)].reset_index(drop=True)
        test = tbl[(tbl["position"] == pos) & (tbl["season"] == VAL_SEASON)].reset_index(drop=True)
        if test.empty:
            continue
        mu_c, sd_c = predict_ensemble(models, cal)
        mu_t, sd_t = predict_ensemble(models, test)
        # availability AUC (played=1)
        from numpy import argsort
        def auc(y, s):
            order = argsort(s)
            ranks = np.empty(len(s)); ranks[order] = np.arange(1, len(s) + 1)
            n1 = y.sum(); n0 = len(y) - n1
            if n1 == 0 or n0 == 0:
                return float("nan")
            return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))
        auc_cal = auc(cal["did_play"].values, mu_c)  # avail logit ~= ensemble mean? no — recompute
        # recompute availability scores properly
        avail_scores = []
        with torch.no_grad():
            Xdf = cal[NUM_COLS].copy()
            med = Xdf.median()
            Xdf = Xdf.fillna(med).fillna(0.0)
            X = torch.tensor(Xdf.values, dtype=torch.float32)
            P = torch.tensor(cal["pos_id"].values.astype(int), dtype=torch.long)
            for m in models:
                m.eval()
                *_, av, _, _ = m(X, P)
                avail_scores.append(av.numpy())
        auc_cal = auc(cal["did_play"].values, np.mean(avail_scores, 0))

        # conformal on played cal rows
        pm = cal["did_play"].values == 1
        z = np.abs(cal.loc[pm, "target"].values - mu_c[pm]) / np.maximum(sd_c[pm], 1e-6)
        k80 = float(np.quantile(z, 0.8))
        tm = test["did_play"].values == 1
        y = test.loc[tm, "target"].values
        lo, hi = mu_t[tm] - k80 * sd_t[tm], mu_t[tm] + k80 * sd_t[tm]
        entry = {
            "position": pos,
            "n_test_played": int(tm.sum()),
            "n_test_dnp": int((~tm).sum()),
            "ensemble_mae": float(np.mean(np.abs(y - mu_t[tm]))),
            "ensemble_rmse": float(np.sqrt(np.mean((y - mu_t[tm]) ** 2))),
            "ensemble_spearman": float(pd.Series(y).corr(pd.Series(mu_t[tm]), method="spearman")),
            "ensemble_crps": float(np.mean(crps_normal(y, mu_t[tm], np.maximum(sd_t[tm], 1e-6)))),
            "coverage_80": float(np.mean((y >= lo) & (y <= hi))),
            "avail_auc_cal": auc_cal,
        }
        report.append(entry)
        print(f"{pos:4s} MAE={entry['ensemble_mae']:5.2f} CRPS={entry['ensemble_crps']:5.2f} "
              f"cov={entry['coverage_80']:.2f} spear={entry['ensemble_spearman']:.3f} "
              f"availAUC={entry['avail_auc_cal'] if entry['avail_auc_cal'] == entry['avail_auc_cal'] else -1:.3f} "
              f"dnp={entry['n_test_dnp']}")
    (OUT / "joint_nn_v2_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "joint_nn_v2_report_2024.json")


if __name__ == "__main__":
    main()

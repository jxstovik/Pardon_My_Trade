#!/usr/bin/env python3
"""Plan 26 Phase 4 (Approach A): joint multi-task neural network.

One model, all six positions, per plan section 8:
  - position embedding + numeric context -> shared trunk (residual MLP)
  - position-specific output heads:
      * conditional points head (median regression, pinball-free: MSE on median
        plus Gaussian NLL head for spread)
      * availability head (played / did-not-play)
  - auxiliary head: nothing yet (game-level team points need team rows aligned;
    planned follow-up)

Implementation: pure PyTorch if available, else a NumPy fallback MLP is NOT
attempted (quality gate) — script exits with instructions. Check the venv.

Evaluation: identical 2024 walk-forward fold as the GBM/Bayes/metamodel work:
train <2023, calibrate conformal on 2023, test 2024. Comparison vs components
must use the same rows. Outputs: artifacts/plan26/joint_nn_report_2024.json
"""
from __future__ import annotations

import json
from math import erf, exp, pi, sqrt
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts" / "plan26"
VAL_SEASON = 2024
CAL_SEASON = 2023
SEED = 42

try:
    import torch
    import torch.nn as nn
    TORCH = True
except ImportError:
    TORCH = False


def crps_normal(y, mu, sd):
    out = np.empty(len(y))
    for i, (yy, m, s) in enumerate(zip(y, mu, sd)):
        z = (yy - m) / s
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        phi = exp(-0.5 * z * z) / sqrt(2 * pi)
        out[i] = s * (z * (2 * Phi - 1) + 2 * phi - 1 / sqrt(pi))
    return out


def build_dataset():
    pg = pd.read_parquet(OUT / "player_games_ctx.parquet")
    pg["target"] = pg["fp_ppr"]
    pg = pg[pg["target"].notna()].sort_values(["player_id", "season", "week"]).reset_index(drop=True)

    # rolling features (as-of-safe)
    g = pg.groupby("player_id")["target"]
    pg["roll3"] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    pg["roll5"] = g.transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    pg["played_lag1"] = pg.groupby("player_id")["target"].transform(lambda s: s.shift(1).notna().astype(float))
    smean = pg.groupby(["player_id", "season"])["target"].mean().rename("smean").reset_index()
    smean["season"] += 1
    pg = pg.merge(smean.rename(columns={"smean": "prior_season_mean"}), on=["player_id", "season"], how="left")

    num_cols = ["roll3", "roll5", "prior_season_mean", "played_lag1",
                "is_home", "rest", "temp", "wind",
                "opponent_def_pa_lag3", "opponent_def_sacks_lag3", "opponent_def_to_lag3",
                "team_targets_lag3"]
    pg[num_cols] = pg[num_cols].fillna(pg[num_cols].median())

    # position id — only the six fantasy positions are modeled; other junk
    # position rows (FB/P/etc.) are dropped so pos_id never exceeds 5.
    keep_pos = ["QB", "RB", "WR", "TE", "K", "DST"]
    pos_map = {p: i for i, p in enumerate(keep_pos)}
    pg = pg[pg["position"].isin(keep_pos)].copy()
    pg["pos_id"] = pg["position"].map(pos_map)
    # availability target: rows exist only for games played in this store, so
    # augment: availability head uses played_lag1 as input; label = 1 here.
    # (True did-not-play rows require the injury source — Phase 1 follow-up.)
    return pg, num_cols, pos_map


class JointNN(nn.Module):
    def __init__(self, n_num: int, n_pos: int = 6, emb: int = 4, hidden: int = 128):
        super().__init__()
        self.pos_emb = nn.Embedding(n_pos, emb)
        d_in = n_num + emb
        self.trunk = nn.Sequential(
            nn.Linear(d_in, hidden), nn.LayerNorm(hidden), nn.GELU(),
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(),
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(),
        )
        # heads keyed by position: mean + log-variance
        self.head_mean = nn.ModuleList([nn.Linear(hidden, 1) for _ in range(n_pos)])
        self.head_logvar = nn.ModuleList([nn.Linear(hidden, 1) for _ in range(n_pos)])
        self.head_avail = nn.Linear(hidden, 1)

    def forward(self, xnum, xpos):
        e = self.pos_emb(xpos)
        h = self.trunk(torch.cat([xnum, e], dim=-1))
        means = torch.stack([hm(h)[:, 0] for hm in self.head_mean], dim=1)   # B x 6
        logvars = torch.stack([hl(h)[:, 0] for hl in self.head_logvar], dim=1)
        avail = self.head_avail(h)[:, 0]
        mean = means.gather(1, xpos.unsqueeze(1)).squeeze(1)
        logvar = logvars.gather(1, xpos.unsqueeze(1)).squeeze(1)
        return mean, logvar, avail


def train_joint(pg: pd.DataFrame, num_cols: list[str], seasons: list[int]):
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    train = pg[pg["season"].isin(seasons)]
    X = torch.tensor(train[num_cols].values, dtype=torch.float32)
    P = torch.tensor(train["pos_id"].values, dtype=torch.long)
    Y = torch.tensor(train["target"].values, dtype=torch.float32)
    A = torch.ones_like(Y)  # all rows played (store limitation)

    model = JointNN(len(num_cols))
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=60)
    n = len(X)
    bs = 512
    for epoch in range(60):
        model.train()
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, bs):
            idx = perm[i:i + bs]
            mean, logvar, avail = model(X[idx], P[idx])
            var = torch.exp(logvar).clamp(1e-3, 1e4)
            nll = 0.5 * (torch.log(var) + (Y[idx] - mean) ** 2 / var)
            avail_loss = nn.functional.binary_cross_entropy_with_logits(avail, A[idx])
            loss = nll.mean() + 0.1 * avail_loss
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
        sched.step()
    return model


def predict(model, df: pd.DataFrame, num_cols: list[str]):
    model.eval()
    with torch.no_grad():
        X = torch.tensor(df[num_cols].values, dtype=torch.float32)
        P = torch.tensor(df["pos_id"].values, dtype=torch.long)
        mean, logvar, _ = model(X, P)
    return mean.numpy(), np.exp(logvar.numpy())


def main():
    if not TORCH:
        raise SystemExit("PyTorch not installed in .venv-pmt — install torch to run the joint NN (Phase 4).")
    pg, num_cols, _ = build_dataset()

    model = train_joint(pg, num_cols, seasons=list(range(2010, CAL_SEASON)))

    report = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
        cal = pg[(pg["position"] == pos) & (pg["season"] == CAL_SEASON)]
        test = pg[(pg["position"] == pos) & (pg["season"] == VAL_SEASON)]
        if test.empty:
            continue
        mu_c, sd_c = predict(model, cal, num_cols)
        mu_t, sd_t = predict(model, test, num_cols)
        # conformal: scale sd by the 2023 z-residual quantile to hit ~80%
        z = np.abs(cal["target"].values - mu_c) / np.maximum(sd_c, 1e-6)
        k80 = float(np.quantile(z, 0.8))
        y = test["target"].values
        lo, hi = mu_t - k80 * sd_t, mu_t + k80 * sd_t
        entry = {
            "position": pos,
            "n_test": len(y),
            "nn_mae": float(np.mean(np.abs(y - mu_t))),
            "nn_rmse": float(np.sqrt(np.mean((y - mu_t) ** 2))),
            "nn_spearman": float(pd.Series(y).corr(pd.Series(mu_t), method="spearman")),
            "nn_crps": float(np.mean(crps_normal(y, mu_t, np.maximum(sd_t, 1e-6)))),
            "nn_coverage_80": float(np.mean((y >= lo) & (y <= hi))),
        }
        report.append(entry)
        print(f"{pos:4s} MAE={entry['nn_mae']:5.2f} CRPS={entry['nn_crps']:5.2f} "
              f"cov={entry['nn_coverage_80']:.2f} spear={entry['nn_spearman']:.3f}")
    (OUT / "joint_nn_report_2024.json").write_text(json.dumps(report, indent=2))
    print("wrote", OUT / "joint_nn_report_2024.json")


if __name__ == "__main__":
    main()

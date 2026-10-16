#!/usr/bin/env python3
"""Create an advisory sample bundle from a recorded historical player-game.

Uses the league's *current* scoring rules as a what-if over historical stats;
it is not evidence that these were the league rules or bettable quotes in 2025.
No verified source-availability timestamp means no forecast_cutoff or betting EV.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from evaluate_raw import YEARS, load_games
from raw_stats import OpportunityRateModel, sample_raw_outcomes, stat_columns


def load_scoring_snapshot(db_path: Path) -> dict:
    db = sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True)
    try:
        row = db.execute("select snapshot_id, data, created_at from league_snapshots order by created_at desc limit 1").fetchone()
    finally:
        db.close()
    if row is None:
        raise ValueError("No stored league snapshot")
    data = json.loads(row[1])
    scoring = data["league"]["scoring_settings"]
    if not scoring.get("rules"):
        raise ValueError("League snapshot lacks scoring rules")
    return {"snapshot_id": row[0], "captured_at": row[2], "scoring": scoring}


def build(data_dir: Path, db_path: Path, prior_report: Path, player_id: str,
          position: str, season: int, week: int, sample_count: int) -> dict:
    if position not in ("QB", "RB", "WR", "TE") or season not in (2024, 2025) or not 1 <= week <= 18:
        raise ValueError("Historical prototype supports QB/RB/WR/TE in 2024/25 weeks 1–18 only")
    if sample_count < 1:
        raise ValueError("sample_count must be positive")
    rows, hashes = load_games(data_dir, YEARS)
    params = json.loads(prior_report.read_text())["calibration"]["settings"][position]
    config = {"lag": params["lag"], "recency": params["recency"],
              "shrink": params["shrink"], "rate_shrink": 20}
    model = OpportunityRateModel(rows, prior_seasons=tuple(range(2019, season)), **config)
    if player_id not in model.by_player:
        raise ValueError("GSIS player ID not present; never guess a name crosswalk")
    forecast = model.predict(player_id, position, season, week)
    cal_model = OpportunityRateModel(rows, prior_seasons=(2019, 2020, 2021), **config)
    calibration = [r for r in rows if r["season"] == 2022 and r["position"] == position]
    residuals = [{stat: row[stat] - predicted[stat] for stat in stat_columns()}
                 for row in calibration
                 for predicted in [cal_model.predict(row["player_id"], position, 2022, row["week"])]]
    sample = sample_raw_outcomes(forecast, residuals, n=sample_count, seed=8762022)
    return {"player_id": player_id, "position": position, "season": season, "week": week,
            "model": "opportunity-rate-v1", "calibration": "2022 joint stat residuals; 2023 hyperparameters",
            "status": "conditional_on_recorded_game", "source": "nflverse weekly data",
            "data_sha256": hashes, "raw_mean": forecast, "samples": sample,
            "scoring_source": load_scoring_snapshot(db_path)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--snapshot-db", type=Path, required=True)
    parser.add_argument("--prior-report", type=Path, required=True)
    parser.add_argument("--player-id", required=True)
    parser.add_argument("--position", required=True)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = build(args.data_dir, args.snapshot_db, args.prior_report,
                   args.player_id, args.position, args.season, args.week, args.samples)
    # The reader's top-level scoring contract is explicit; never include roster/news/credentials.
    scoring_source = result.pop("scoring_source")
    result["scoring"] = scoring_source["scoring"]
    result["scoring_snapshot_id"] = scoring_source["snapshot_id"]
    result["scoring_captured_at"] = scoring_source["captured_at"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(args.output)

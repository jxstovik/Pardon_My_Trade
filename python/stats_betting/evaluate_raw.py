#!/usr/bin/env python3
"""Replay NFLverse player-game raw-stat forecasts against prior PMT replays.

No sportsbook odds are supplied. This tool does NOT claim wagering ROI.
Conditional-on-recorded-game cohort only; do not infer inactive zeros.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from raw_stats import RawStatModel, evaluate, fantasy_ppr, paired_week_bootstrap, stat_columns

POSITIONS = ("QB", "RB", "WR", "TE")
YEARS = range(2019, 2026)


def load_games(data_dir: Path, years) -> tuple[list[dict], dict[str, str]]:
    rows, hashes = [], {}
    for year in years:
        source = data_dir / f"stats_player_week_{year}.csv.gz"
        if not source.is_file():
            raise FileNotFoundError(source)
        hashes[str(source)] = hashlib.sha256(source.read_bytes()).hexdigest()
        with gzip.open(source, "rt", newline="") as f:
            reader = csv.DictReader(f)
            required = set(stat_columns()) | {"player_id", "season", "week", "season_type", "position", "fantasy_points_ppr"}
            if missing := required - set(reader.fieldnames or ()):
                raise ValueError(f"missing raw stats/metadata in {source}: {sorted(missing)}")
            for line in reader:
                if line["season_type"] != "REG" or line["position"] not in POSITIONS:
                    continue
                if not line["player_id"] or not line["fantasy_points_ppr"]:
                    continue
                if any(line[key] in (None, "") for key in stat_columns()):
                    raise ValueError(f"blank raw stat for {line['player_id']} in {source}")
                row: dict = {k: float(line[k]) for k in stat_columns()}
                row.update(player_id=line["player_id"], position=line["position"],
                           season=int(line["season"]), week=int(line["week"]),
                           fantasy_points_ppr=float(line["fantasy_points_ppr"]))
                rows.append(row)
    rows.sort(key=lambda r: (r["season"], r["week"], r["player_id"]))
    return rows, hashes


def replay_predictions(artifacts: Path, regime: str = "adaptive_expanding") -> dict[tuple, float]:
    predictions = {}
    for position in POSITIONS:
        path = artifacts / f"{position.lower()}-2024-replay" / "weekly-predictions.jsonl"
        if not path.is_file():
            raise FileNotFoundError(path)
        with path.open() as f:
            for line in f:
                row = json.loads(line)
                if row["regime"] != regime:
                    continue
                season, week = row["target_period"].split("-W")
                if not row.get("prediction_cutoff"):
                    raise ValueError("replay missing decision cutoff")
                # The weekly historic replay has dated pregame cutoffs; never
                # silently accept an undated or post-season record.
                cutoff = datetime.fromisoformat(row["prediction_cutoff"])
                max_year = int(season) + (int(week) >= 17)
                if cutoff.year > max_year or cutoff.year < int(season) - 1:
                    raise ValueError("replay cutoff outside target season")
                key = row["player_id"], int(season), int(week), position
                if key in predictions:
                    raise ValueError(f"duplicate replay prediction {key}")
                predictions[key] = float(row["mean"])
    return predictions


def replay_observed_outcomes(artifacts: Path) -> dict[tuple, float]:
    """The original replay's labeled evaluation universe, not its full player pool."""
    outcomes = {}
    for position in POSITIONS:
        path = artifacts / f"{position.lower()}-2024-replay" / "weekly-outcomes.jsonl"
        if not path.is_file():
            raise FileNotFoundError(path)
        with path.open() as f:
            for line in f:
                row = json.loads(line)
                if row.get("actual_points") is None:
                    continue
                season, week = row["target_period"].split("-W")
                key = row["player_id"], int(season), int(week), position
                if key in outcomes:
                    raise ValueError(f"duplicate replay outcome {key}")
                outcomes[key] = float(row["actual_points"])
    return outcomes


def row_scores(model: RawStatModel, cohort: list[dict]) -> list[dict]:
    predictions = []
    for row in cohort:
        forecast = model.predict(row["player_id"], row["position"], row["season"], row["week"])
        predictions.append({"season": row["season"], "week": row["week"],
                            "player_id": row["player_id"], "position": row["position"],
                            "actual": row["fantasy_points_ppr"], "raw": fantasy_ppr(forecast),
                            "stats": forecast,
                            "actual_stats": {stat: row[stat] for stat in stat_columns()}})
    return predictions


def tune(rows: list[dict]) -> dict:
    validation = [r for r in rows if r["season"] == 2023]
    settings = {}
    # All hyperparameters are chosen in 2023. Never use 2024/25 outcomes here.
    for position in POSITIONS:
        cohort = [r for r in validation if r["position"] == position]
        best = None
        for lag in (2, 4, 8):
            for recency in (0.3, 0.7, 1.0):
                for shrink in (2.0, 8.0):
                    model = RawStatModel(rows, prior_seasons=tuple(range(2019, 2023)),
                                         recency=recency, shrink=shrink, lag=lag)
                    predicted = row_scores(model, cohort)
                    mae = sum(abs(x["raw"] - x["actual"]) for x in predicted) / len(predicted)
                    candidate = (mae, lag, recency, shrink)
                    if best is None or candidate < best:
                        best = candidate
        settings[position] = {"lag": best[1], "recency": best[2], "shrink": best[3],
                              "calibration_mae_2023": best[0], "calibration_rows": len(cohort)}
    return settings


def run(data_dir: Path, artifacts: Path, output: Path) -> dict:
    rows, hashes = load_games(data_dir, YEARS)
    parity = [r for r in rows if r["season"] == 2024]
    bad = [r for r in parity if abs(fantasy_ppr(r) - r["fantasy_points_ppr"]) > 0.001]
    if bad:
        raise ValueError(f"2024 PPR reconstruction mismatch: {len(bad)}/{len(parity)}")
    settings = tune(rows)
    calibration_rows = [r for r in rows if r["season"] == 2023]
    residuals = {}
    for p in POSITIONS:
        params = settings[p]
        model = RawStatModel(rows, prior_seasons=tuple(range(2019, 2023)),
                             lag=params["lag"], recency=params["recency"], shrink=params["shrink"])
        residuals[p] = [
            {stat: row[stat] - forecast[stat] for stat in stat_columns()}
            for row in calibration_rows if row["position"] == p
            for forecast in [model.predict(row["player_id"], p, row["season"], row["week"])]
        ]
    existing_regimes = {name: replay_predictions(artifacts, name) for name in (
        "adaptive_expanding", "frozen_weights_adaptive_features", "frozen_preseason")}
    observed_replay = replay_observed_outcomes(artifacts)
    predictions, comparisons, source_drift = [], {}, {}
    for season in (2024, 2025):
        past = tuple(range(2019, season))
        position_baselines = {
            p: (sum(r["fantasy_points_ppr"] for r in rows if r["position"] == p and r["season"] < season)
                / sum(r["position"] == p and r["season"] < season for r in rows))
            for p in POSITIONS
        }
        models = {p: RawStatModel(rows, prior_seasons=past,
                                 lag=settings[p]["lag"], recency=settings[p]["recency"],
                                 shrink=settings[p]["shrink"]) for p in POSITIONS}
        season_rows = [r for r in rows if r["season"] == season]
        season_pred = [row_scores(models[p], [r for r in season_rows if r["position"] == p])
                       for p in POSITIONS]
        season_pred = [x for group in season_pred for x in group]
        predictions.extend(season_pred)
        for p in POSITIONS:
            cohort = [x for x in season_pred if x["position"] == p]
            if season == 2024:
                matched = []
                for name, existing in existing_regimes.items():
                    matched_regime = [{**x, "actual": observed_replay[(x["player_id"], season, x["week"], p)],
                                       "baseline": existing[(x["player_id"], season, x["week"], p)]}
                                      for x in cohort if (x["player_id"], season, x["week"], p) in existing
                                      and (x["player_id"], season, x["week"], p) in observed_replay]
                    key = f"{season}_{p}_replay_matched" if name == "adaptive_expanding" else f"{season}_{p}_{name}"
                    comparisons[key] = ({**evaluate(matched_regime), **paired_week_bootstrap(matched_regime)}
                                        if matched_regime else {"n": 0})
                    if name == "adaptive_expanding":
                        matched = matched_regime
                new_labels = {(x["player_id"], season, x["week"], p): x["actual"] for x in cohort}
                source_drift[p] = {
                    "legacy_observed": sum(key[3] == p for key in observed_replay),
                    "matched": len(matched),
                    "changed_outcomes": sum(abs(x["actual"] - new_labels[(x["player_id"], season, x["week"], p)]) > 0.001
                                            for x in matched)
                }

            # Simpler as-of points baseline, only preceding recorded games.
            model = models[p]
            rolling = []
            for x in cohort:
                history = model.by_player[x["player_id"]]
                past_games = [h for h in history if (h["season"], h["week"]) < (season, x["week"])]
                prior = past_games[-4:]
                baseline = (sum(h["fantasy_points_ppr"] for h in prior) / len(prior)
                            if prior else position_baselines[p])
                rolling.append({**x, "baseline": baseline})
            comparisons[f"{season}_{p}_rolling_points"] = {
                **evaluate(rolling), **paired_week_bootstrap(rolling)}
    report = {"model": "raw-stat-shrunk-recency-v1", "cohort": "REG player-game rows with observed NFLverse PPR; inactive absent",
              "not_for_wagering": "No archived odds, unavailable/inactive capture, or team-game covariance; ROI untestable",
              "data_sha256": hashes, "baseline_replay_regimes": list(existing_regimes),
              "legacy_source_drift_2024": source_drift,
              "calibration": {"season": 2023, "settings": settings},
              "ppr_parity_2024": {"n": len(parity), "mismatches": len(bad)},
              "comparisons": comparisons}
    output.mkdir(parents=True, exist_ok=True)
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    with (output / "predictions.jsonl").open("w") as f:
        for pred in predictions:
            f.write(json.dumps(pred, sort_keys=True) + "\n")
    (output / "residuals-2023.json").write_text(json.dumps(residuals) + "\n")
    chart(output / "benchmark.svg", comparisons)
    chart_scatter(output / "scatter.svg", predictions)
    return report


def chart(path: Path, comparisons: dict) -> None:
    keys = [f"2024_{p}_frozen_weights_adaptive_features" for p in POSITIONS]
    keys += [f"2025_{p}_rolling_points" for p in POSITIONS]
    bars = []
    for i, key in enumerate(keys):
        metric = comparisons[key]
        y = 78 + 52 * i
        scale = 37
        raw = metric["raw_mae"] * scale
        other = metric["baseline_mae"] * scale
        label = html.escape(key.replace("_frozen_weights_adaptive_features", " / existing replay")
                            .replace("_rolling_points", " / rolling PPR"))
        bars.append(f'<text x="12" y="{y}" font-size="13">{label} (n={metric["n"]})</text>'
                    f'<rect x="270" y="{y-13}" width="{raw:.1f}" height="9" fill="#1f77b4" />'
                    f'<rect x="270" y="{y-1}" width="{other:.1f}" height="9" fill="#ff7f0e" />'
                    f'<text x="{282+max(raw,other):.1f}" y="{y+3}" font-size="11">{metric["raw_mae"]:.2f} / {metric["baseline_mae"]:.2f}</text>')
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="535" viewBox="0 0 850 535">'
                    '<rect width="850" height="535" fill="white"/>'
                    '<text x="12" y="26" font-size="19">Held-out PPR MAE: raw stats vs matched baselines (lower is better)</text>'
                    '<text x="12" y="48" font-size="13" fill="#1f77b4">■ raw-stat model</text>'
                    '<text x="155" y="48" font-size="13" fill="#ff7f0e">■ comparator</text>'
                    + ''.join(bars) + '</svg>')


def chart_scatter(path: Path, predictions: list[dict]) -> None:
    # Deterministic evenly spaced subset of observed 2024 games, not synthetic observations.
    games = [x for x in predictions if x["season"] == 2024]
    sample = games[::max(1, len(games) // 850)]
    circles = ''.join(f'<circle cx="{65+min(60, p["actual"])*9:.2f}" cy="{645-min(60,p["raw"])*9:.2f}" '
                      f'r="2" fill="#1860a1" fill-opacity=".28"/>' for p in sample)
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="680" height="690" viewBox="0 0 680 690">'
                    '<rect width="680" height="690" fill="white"/>'
                    '<text x="65" y="28" font-size="18">2024 observed games: raw-stat PPR vs actual</text>'
                    '<text x="65" y="49" font-size="12">Deterministic subset; 45-degree reference, not a fit line</text>'
                    '<path d="M65 645 L605 105 M65 645 L605 645 M65 645 L65 105" stroke="#777" fill="none"/>'
                    + circles + '<text x="290" y="675" font-size="14">Actual PPR →</text>'
                    '<text x="6" y="310" font-size="13">Predicted PPR ↑</text></svg>')


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--data-dir", type=Path, required=True, help="read-only NFLverse weekly CSV directory")
    cli.add_argument("--artifacts", type=Path, default=Path(__file__).resolve().parents[2] / "artifacts")
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    result = run(args.data_dir, args.artifacts, args.output)
    for key, value in result["comparisons"].items():
        print(key, value)
    print("Report:", args.output / "metrics.json")

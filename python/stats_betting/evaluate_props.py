#!/usr/bin/env python3
"""Evaluate illustrative stat-threshold probabilities, never retrospective ROI.

Thresholds are prespecified examples, NOT historical sportsbook quotes; a good
Brier score at these thresholds does not establish a bettable edge. Cohort is
conditional on observed player-game rows only. Calibration residual vectors
come exclusively from 2022 with inputs available before the 2022 game.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluate_raw import POSITIONS, YEARS, load_games, row_scores
from raw_stats import OpportunityRateModel, sample_raw_outcomes

THRESHOLDS = {"QB": ("passing_yards", 249.5), "RB": ("rushing_yards", 59.5),
              "WR": ("receptions", 4.5), "TE": ("receptions", 3.5)}


def brier_probabilities(rows: list[dict], residuals: list[dict], stat: str,
                        line: float, baseline: float, samples: int = 128) -> dict:
    if not rows or not 0 <= baseline <= 1:
        raise ValueError("observed cohort and valid baseline required")
    probabilities, events = [], []
    for row in rows:
        keys = {stat, *( ["targets"] if stat == "receptions" else [] )}
        forecast = {key: row["stats"][key] for key in keys}
        seed = row["season"] * 1000 + row["week"] * 31 + sum(ord(c) for c in row["player_id"])
        draws = sample_raw_outcomes(forecast, residuals, samples, seed)
        probabilities.append(sum(draw[stat] > line for draw in draws) / samples)
        events.append(float(row["actual_stats"][stat] > line))
    n = len(rows)
    return {"n": n, "stat": stat, "threshold": line, "event_rate": sum(events) / n,
            "model_brier": sum((p - y) ** 2 for p, y in zip(probabilities, events)) / n,
            "baseline_brier": sum((baseline - y) ** 2 for y in events) / n,
            "rolling_event_brier": sum((row.get("rolling_event_probability", baseline) - y) ** 2
                                       for row, y in zip(rows, events)) / n,
            "mean_probability": sum(probabilities) / n, "baseline_probability": baseline,
            "draws_per_player": samples,
            "reliability": [
                {"bucket": i, "n": sum(0.2 * i <= p < 0.2 * (i + 1) if i < 4 else p >= 0.8
                                          for p in probabilities),
                 "predicted": (sum(p for p in probabilities if (0.2 * i <= p < 0.2 * (i + 1) if i < 4 else p >= 0.8))
                               / max(1, sum(0.2 * i <= p < 0.2 * (i + 1) if i < 4 else p >= 0.8 for p in probabilities))),
                 "observed": (sum(y for p, y in zip(probabilities, events) if
                                  (0.2 * i <= p < 0.2 * (i + 1) if i < 4 else p >= 0.8))
                              / max(1, sum(0.2 * i <= p < 0.2 * (i + 1) if i < 4 else p >= 0.8 for p in probabilities)))}
                for i in range(5)]}


def run(data_dir: Path, prior_report: Path, output: Path) -> dict:
    rows, hashes = load_games(data_dir, YEARS)
    chosen = json.loads(prior_report.read_text())["calibration"]["settings"]
    results = {}
    for position in POSITIONS:
        settings = chosen[position]
        cal_model = OpportunityRateModel(rows, prior_seasons=(2019, 2020, 2021),
                                         lag=settings["lag"], recency=settings["recency"],
                                         shrink=settings["shrink"], rate_shrink=20)
        calibration = [r for r in rows if r["position"] == position and r["season"] == 2022]
        shocks = [{k: row[k] - forecast[k] for k in row if k in forecast}
                  for row in calibration
                  for forecast in [cal_model.predict(row["player_id"], position, 2022, row["week"])]]
        stat, threshold = THRESHOLDS[position]
        for season in (2024, 2025):
            model = OpportunityRateModel(rows, prior_seasons=tuple(range(2019, season)),
                                         lag=settings["lag"], recency=settings["recency"],
                                         shrink=settings["shrink"], rate_shrink=20)
            cohort = [r for r in rows if r["position"] == position and r["season"] == season]
            historical = [r for r in rows if r["position"] == position and r["season"] < season]
            baseline = sum(r[stat] > threshold for r in historical) / len(historical)
            scored = row_scores(model, cohort)
            for prediction in scored:
                history = model.by_player[prediction["player_id"]]
                earlier = [r for r in history if (r["season"], r["week"]) <
                           (season, prediction["week"])][-8:]
                prediction["rolling_event_probability"] = (
                    sum(r[stat] > threshold for r in earlier) + 4 * baseline) / (len(earlier) + 4)
            results[f"{season}_{position}_{stat}"] = brier_probabilities(
                scored, shocks, stat, threshold, baseline)
    report = {"model": "opportunity-rate-v1 with 2022 joint residuals", "data_sha256": hashes,
              "restrictions": "Selected fixed example thresholds; observed player-games only; no odds, ROI, or availability model",
              "thresholds": THRESHOLDS, "scores": results}
    output.mkdir(parents=True, exist_ok=True)
    (output / "prop-calibration.json").write_text(json.dumps(report, indent=2) + "\n")
    plot(output / "prop-brier.svg", results)
    return report


def plot(path: Path, results: dict) -> None:
    entries = []
    for i, (key, row) in enumerate(results.items()):
        y = 76 + i * 52
        entries.append(f'<text x="10" y="{y}" font-size="13">{key} &gt; {row["threshold"]} (n={row["n"]})</text>'
                       f'<rect x="295" y="{y-14}" width="{row["model_brier"]*650:.1f}" height="9" fill="#1465a0" />'
                       f'<rect x="295" y="{y-3}" width="{row["baseline_brier"]*650:.1f}" height="9" fill="#e88032" />'
                       f'<rect x="295" y="{y+8}" width="{row["rolling_event_brier"]*650:.1f}" height="9" fill="#888" />'
                       f'<text x="615" y="{y+4}" font-size="12">{row["model_brier"]:.3f} / {row["baseline_brier"]:.3f} / {row["rolling_event_brier"]:.3f}</text>')
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="535" viewBox="0 0 800 535">'
                    '<rect width="800" height="535" fill="white"/>'
                    '<text x="10" y="24" font-size="18">Illustrative conditional event Brier score (lower better)</text>'
                    '<text x="10" y="46" font-size="12">Blue: model; orange: position rate; gray: shrunk prior-8 game event rate. No odds / no ROI.</text>'
                    + ''.join(entries) + '</svg>')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--prior-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.data_dir, args.prior_report, args.output)
    for key, score in report["scores"].items():
        print(key, score["model_brier"], score["baseline_brier"], score["n"])

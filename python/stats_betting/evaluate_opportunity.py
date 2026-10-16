#!/usr/bin/env python3
"""Independent opportunity × efficiency challenger; compares on identical rows.

This candidate fixes rate_shrink=20 and reuses only hyperparameters chosen on 2023.
It is deliberately NOT promoted by checking the 2024/25 metrics below.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from evaluate_raw import POSITIONS, YEARS, chart, load_games, replay_observed_outcomes, replay_predictions, row_scores
from raw_stats import OpportunityRateModel, evaluate, paired_week_bootstrap

STAT_TARGETS = {"QB": ("attempts", "passing_yards", "passing_tds"),
                "RB": ("carries", "rushing_yards", "targets"),
                "WR": ("targets", "receptions", "receiving_yards"),
                "TE": ("targets", "receptions", "receiving_yards")}


def matched_comparison(rows: list[dict], baseline: dict, observed: dict) -> list[dict]:
    matched = []
    for row in rows:
        key = (row["player_id"], row["season"], row["week"], row["position"])
        if key in baseline and key in observed:
            matched.append({**row, "actual": observed[key], "baseline": baseline[key]})
    return matched


def stat_comparison(predictions: list[dict], model: OpportunityRateModel,
                    stat: str, position_mean: float) -> list[dict]:
    aligned = []
    for prediction in predictions:
        games = model.by_player[prediction["player_id"]]
        earlier = [r for r in games if (r["season"], r["week"]) <
                   (prediction["season"], prediction["week"])][-4:]
        benchmark = sum(r[stat] for r in earlier) / len(earlier) if earlier else position_mean
        aligned.append({"week": prediction["week"], "actual": prediction["actual_stats"][stat],
                        "raw": prediction["stats"][stat], "baseline": benchmark})
    return aligned


def run(data_dir: Path, artifacts: Path, prior_report: Path, output: Path) -> dict:
    rows, hashes = load_games(data_dir, YEARS)
    chosen = json.loads(prior_report.read_text())["calibration"]["settings"]
    replay_regimes = {name: replay_predictions(artifacts, name) for name in (
        "adaptive_expanding", "frozen_weights_adaptive_features", "frozen_preseason")}
    outcomes = replay_observed_outcomes(artifacts)
    results, prediction_rows, stat_results = {}, [], {}
    for season in (2024, 2025):
        for position in POSITIONS:
            settings = chosen[position]
            model = OpportunityRateModel(
                rows, prior_seasons=tuple(range(2019, season)),
                lag=settings["lag"], recency=settings["recency"], shrink=settings["shrink"], rate_shrink=20)
            cohort = [r for r in rows if r["position"] == position and r["season"] == season]
            scored = row_scores(model, cohort)
            prediction_rows.extend(scored)
            historical = [r for r in rows if r["position"] == position and r["season"] < season]
            for stat in STAT_TARGETS[position]:
                mean = sum(r[stat] for r in historical) / len(historical)
                data = stat_comparison(scored, model, stat, mean)
                stat_results[f"{season}_{position}_{stat}"] = {
                    **evaluate(data), **paired_week_bootstrap(data)}
            if season == 2024:
                for name, replay in replay_regimes.items():
                    matched = matched_comparison(scored, replay, outcomes)
                    key = f"2024_{position}_replay_matched" if name == "adaptive_expanding" else f"2024_{position}_{name}"
                    results[key] = {**evaluate(matched), **paired_week_bootstrap(matched)}
            previous = [r for r in rows if r["position"] == position and r["season"] < season]
            positional = sum(r["fantasy_points_ppr"] for r in previous) / len(previous)
            rolling = []
            for prediction in scored:
                key = prediction["player_id"]
                earlier = [r for r in model.by_player[key] if (r["season"], r["week"]) <
                           (season, prediction["week"])][-4:]
                benchmark = (sum(r["fantasy_points_ppr"] for r in earlier) / len(earlier)) if earlier else positional
                rolling.append({**prediction, "baseline": benchmark})
            results[f"{season}_{position}_rolling_points"] = {**evaluate(rolling), **paired_week_bootstrap(rolling)}
    report = {"candidate": "raw-stat-opportunity-rate-v1", "calibration": "direct-model hyperparameters chosen in 2023; fixed rate_shrink=20",
              "notes": "Conditional on observed row; legacy replay outcomes only for 2024 comparison; no archived odds or inactive labels",
              "data_sha256": hashes, "comparisons": results, "stat_comparisons": stat_results}
    output.mkdir(parents=True, exist_ok=True)
    (output / "opportunity-metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    with (output / "opportunity-predictions.jsonl").open("w") as f:
        for row in prediction_rows:
            f.write(json.dumps(row, sort_keys=True) + "\n")
    chart(output / "opportunity-benchmark.svg", results)
    chart_stat_targets(output / "raw-stat-targets.svg", stat_results)
    return report


def chart_stat_targets(path: Path, comparisons: dict) -> None:
    keys = [f"2025_{position}_{stat}" for position in POSITIONS for stat in STAT_TARGETS[position]]
    height = 84 + len(keys) * 38
    entries = []
    for i, key in enumerate(keys):
        result = comparisons[key]
        y = 73 + 38 * i
        maximum = max(result["raw_mae"], result["baseline_mae"])
        raw_width = 220 * result["raw_mae"] / maximum if maximum else 0
        base_width = 220 * result["baseline_mae"] / maximum if maximum else 0
        entries.append(f'<text x="10" y="{y}" font-size="12">{html.escape(key)}</text>'
                       f'<rect x="230" y="{y-15}" width="{raw_width:.2f}" height="8" fill="#1565a7" />'
                       f'<rect x="230" y="{y-5}" width="{base_width:.2f}" height="8" fill="#ed8734" />'
                       f'<text x="475" y="{y}" font-size="12">{result["raw_mae"]:.2f} / {result["baseline_mae"]:.2f}</text>')
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="680" height="{height}" viewBox="0 0 680 {height}">'
                    f'<rect width="680" height="{height}" fill="white"/>'
                    '<text x="10" y="25" font-size="18">2025 held-out raw-stat MAE vs rolling stat prior</text>'
                    '<text x="10" y="45" font-size="12" fill="#1565a7">■ opportunity-rate</text>'
                    '<text x="155" y="45" font-size="12" fill="#ed8734">■ rolling stat</text>'
                    + ''.join(entries) + '</svg>')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, default=Path(__file__).resolve().parents[2] / "artifacts")
    parser.add_argument("--prior-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    opts = parser.parse_args()
    report = run(opts.data_dir, opts.artifacts, opts.prior_report, opts.output)
    for key, value in report["comparisons"].items():
        print(key, value)

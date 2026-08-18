#!/usr/bin/env python3
"""Train reproducible QB/WR probabilistic metamodel artifacts.

The default data is a deterministic benchmark fixture, not scraped NFL data.
It exists to validate the training, validation, metrics, plots, and SQLite
artifact contract before real historical/Razzball-aligned rows are supplied.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sqlite3
from pathlib import Path
from statistics import mean, pstdev

SEED = 20260816
SEASONS = [2021, 2022, 2023, 2024]
WEEKS = range(1, 19)


def generate_rows(position: str) -> list[dict]:
    rng = random.Random(SEED + (1 if position == "QB" else 2))
    count = 8 if position == "QB" else 20
    rows = []
    history: dict[str, list[float]] = {f"{position.lower()}-{i:02d}": [] for i in range(count)}
    skill = {player: rng.gauss(0, 2.0) for player in history}
    for season in SEASONS:
        for week in WEEKS:
            for index, player in enumerate(history):
                pace = 0.9 + ((index * 7 + week * 3 + season) % 21) / 100
                availability = 1.0 if rng.random() > (0.035 if position == "QB" else 0.07) else 0.0
                qb_quality = 0.0 if position == "QB" else 0.8 + ((index * 5 + season) % 11) / 10
                prior = mean(history[player][-6:]) if history[player] else (16.0 if position == "QB" else 9.5)
                red_zone = 0.7 + ((index + week + season) % 9) / 10
                base = (16.0 if position == "QB" else 9.5) + skill[player]
                dependency = qb_quality * (1.25 if position == "WR" else 0.0)
                actual = max(0.0, availability * (base + 0.34 * (prior - (16 if position == "QB" else 9.5)) + 5.2 * (pace - 1) + dependency + 0.9 * red_zone + rng.gauss(0, 3.0 if position == "QB" else 3.8)))
                razzball = max(0.0, base + 0.7 * (prior - (16 if position == "QB" else 9.5)) + 4.2 * (pace - 1) + dependency + rng.gauss(0, 2.2 if position == "QB" else 2.8))
                row = {
                    "player_id": player,
                    "position": position,
                    "season": season,
                    "week": week,
                    "scoring_period": f"{season}-W{week}",
                    "prior_points": round(prior, 4),
                    "team_pace": round(pace, 4),
                    "availability": availability,
                    "qb_quality": round(qb_quality, 4),
                    "red_zone_rate": round(red_zone, 4),
                    "razzball_points": round(razzball, 4),
                    "actual_points": round(actual, 4),
                }
                rows.append(row)
                if availability:
                    history[player].append(actual)
    return rows


FEATURES = ["prior_points", "team_pace", "availability", "qb_quality", "red_zone_rate"]


def matrix(rows: list[dict]) -> list[list[float]]:
    return [[1.0] + [float(row[feature]) for feature in FEATURES] for row in rows]


def solve(matrix_values: list[list[float]], target: list[float], ridge: float = 1.0) -> list[float]:
    size = len(matrix_values[0])
    gram = [[0.0] * size for _ in range(size)]
    rhs = [0.0] * size
    for values, result in zip(matrix_values, target):
        for i in range(size):
            rhs[i] += values[i] * result
            for j in range(size):
                gram[i][j] += values[i] * values[j]
    for i in range(1, size):
        gram[i][i] += ridge
    for pivot in range(size):
        largest = max(range(pivot, size), key=lambda row: abs(gram[row][pivot]))
        gram[pivot], gram[largest] = gram[largest], gram[pivot]
        rhs[pivot], rhs[largest] = rhs[largest], rhs[pivot]
        divisor = gram[pivot][pivot] or 1e-12
        for column in range(pivot, size):
            gram[pivot][column] /= divisor
        rhs[pivot] /= divisor
        for row in range(size):
            if row == pivot:
                continue
            factor = gram[row][pivot]
            for column in range(pivot, size):
                gram[row][column] -= factor * gram[pivot][column]
            rhs[row] -= factor * rhs[pivot]
    return rhs


def predict(row: dict, coefficients: list[float]) -> float:
    return max(0.0, sum(value * coefficient for value, coefficient in zip([1.0] + [row[f] for f in FEATURES], coefficients)))


def train_ensemble(rows: list[dict], members: int = 50, sample_size: int | None = None) -> tuple[list[list[float]], float]:
    rng = random.Random(SEED + len(rows))
    models = []
    draw_count = min(len(rows), sample_size) if sample_size else len(rows)
    for _ in range(members):
        sample = [rows[rng.randrange(len(rows))] for _ in range(draw_count)]
        models.append(solve(matrix(sample), [row["actual_points"] for row in sample], ridge=2.0))
    full_model = solve(matrix(rows), [row["actual_points"] for row in rows], ridge=2.0)
    residuals = [row["actual_points"] - predict(row, full_model) for row in rows]
    return models, max(2.0, pstdev(residuals))


def distribution(row: dict, models: list[list[float]], residual_std: float) -> tuple[float, float, float, float]:
    member_values = [predict(row, coefficients) for coefficients in models]
    center = mean(member_values)
    spread = math.sqrt(pstdev(member_values) ** 2 + residual_std ** 2)
    return center, spread, max(0.0, center - 1.282 * spread), center + 1.282 * spread


def metrics(rows: list[dict], predictions: list[dict], prediction_key: str, probabilistic: bool = False) -> dict:
    errors = [prediction[prediction_key] - row["actual_points"] for row, prediction in zip(rows, predictions)]
    return {
        "samples": len(errors),
        "mae": round(mean(abs(error) for error in errors), 6),
        "rmse": round(math.sqrt(mean(error * error for error in errors)), 6),
        "bias": round(mean(errors), 6),
        "p10_p90_coverage": round(mean(1.0 if prediction["p10"] <= row["actual_points"] <= prediction["p90"] else 0.0 for row, prediction in zip(rows, predictions)), 6) if probabilistic else None,
    }


def svg_benchmark(path: Path, position: str, split: str, metric_rows: list[tuple[str, float]]) -> None:
    width, height = 900, 440
    maximum = max(value for _, value in metric_rows) or 1
    bars = []
    for index, (label, value) in enumerate(metric_rows):
        x = 90 + index * 190
        bar_height = 260 * value / maximum
        y = 330 - bar_height
        bars.append(f'<rect x="{x}" y="{y:.1f}" width="110" height="{bar_height:.1f}" rx="8" fill="#216b52"/><text x="{x+55}" y="360" text-anchor="middle">{label}</text><text x="{x+55}" y="{y-10:.1f}" text-anchor="middle">{value:.2f}</text>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#f4f1e9"/><text x="40" y="45" font-family="Georgia" font-size="26" fill="#17221e">{position} {split} RMSE benchmark</text><text x="40" y="72" font-family="Arial" font-size="14" fill="#6c746d">Lower is better · deterministic benchmark fixture</text><line x1="60" y1="330" x2="840" y2="330" stroke="#bdb7aa"/>{''.join(bars)}</svg>'''
    path.write_text(svg, encoding="utf-8")


def svg_fit(path: Path, position: str, split: str, rows: list[dict], predictions: list[dict]) -> None:
    width, height = 900, 500
    maximum = max([row["actual_points"] for row in rows] + [prediction["metamodel_mean"] for prediction in predictions] + [1])
    scale = 760 / maximum
    points = []
    for row, prediction in zip(rows, predictions):
        x = 70 + row["actual_points"] * scale
        y = 420 - prediction["metamodel_mean"] * scale
        points.append(f'<circle cx="{min(840, x):.1f}" cy="{max(70, y):.1f}" r="2.6" fill="#d97843" opacity="0.45"/>')
    diagonal = f'<line x1="70" y1="420" x2="{min(840, 70 + maximum * scale):.1f}" y2="{max(70, 420 - maximum * scale):.1f}" stroke="#216b52" stroke-dasharray="7 6"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#f4f1e9"/><text x="40" y="40" font-family="Georgia" font-size="26" fill="#17221e">{position} {split} actual vs metamodel</text><text x="40" y="66" font-family="Arial" font-size="14" fill="#6c746d">Each point is one player-period; dashed line is perfect calibration</text><line x1="70" y1="420" x2="840" y2="420" stroke="#bdb7aa"/><line x1="70" y1="70" x2="70" y2="420" stroke="#bdb7aa"/>{diagonal}{''.join(points)}<text x="455" y="470" text-anchor="middle" font-family="Arial" font-size="13">Actual fantasy points</text><text x="18" y="250" transform="rotate(-90 18 250)" text-anchor="middle" font-family="Arial" font-size="13">Predicted fantasy points</text></svg>'''
    path.write_text(svg, encoding="utf-8")


def save_database(path: Path, position: str, train_rows: list[dict], validation_rows: list[dict], train_predictions: list[dict], validation_predictions: list[dict], metrics_rows: list[dict], models: list[list[float]], residual_std: float, data_status: str = "deterministic benchmark fixture; replace with historical aligned rows") -> None:
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE predictions (split TEXT, player_id TEXT, scoring_period TEXT, actual_points REAL, razzball_points REAL, mean REAL, standard_deviation REAL, p10 REAL, p90 REAL);
      CREATE TABLE metrics (split TEXT, model TEXT, samples INTEGER, mae REAL, rmse REAL, bias REAL, p10_p90_coverage REAL);
      CREATE TABLE coefficients (member INTEGER, feature TEXT, value REAL);
    """)
    metadata = {"schema_version": "1.0.0", "position": position, "seed": str(SEED), "features": json.dumps(FEATURES), "training_seasons": "2021-2023", "validation_season": "2024", "residual_standard_deviation": str(residual_std), "data_status": data_status}
    db.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    for split, rows, predictions in [("training", train_rows, train_predictions), ("validation", validation_rows, validation_predictions)]:
        db.executemany("INSERT INTO predictions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [(split, row["player_id"], row["scoring_period"], row["actual_points"], row.get("razzball_points"), prediction["metamodel_mean"], prediction["standard_deviation"], prediction["p10"], prediction["p90"]) for row, prediction in zip(rows, predictions)])
    for metric in metrics_rows:
        db.execute("INSERT INTO metrics VALUES (?, ?, ?, ?, ?, ?, ?)", (metric["split"], metric["model"], metric["samples"], metric["mae"], metric["rmse"], metric["bias"], metric.get("p10_p90_coverage")))
    for member, coefficients in enumerate(models):
        db.executemany("INSERT INTO coefficients VALUES (?, ?, ?)", [(member, feature, value) for feature, value in zip(["intercept"] + FEATURES, coefficients)])
    db.commit()
    db.close()


def run_position(position: str, output: Path) -> dict:
    rows = generate_rows(position)
    train = [row for row in rows if row["season"] <= 2023]
    validation = [row for row in rows if row["season"] == 2024]
    models, residual_std = train_ensemble(train)
    all_predictions = []
    for row in rows:
        center, spread, p10, p90 = distribution(row, models, residual_std)
        all_predictions.append({"metamodel_mean": center, "standard_deviation": spread, "p10": p10, "p90": p90})
    train_predictions = all_predictions[:len(train)]
    validation_predictions = all_predictions[len(train):]
    train_metrics = [
        ("metamodel", metrics(train, train_predictions, "metamodel_mean", probabilistic=True)),
        ("razzball", metrics(train, [{"metamodel_mean": r["razzball_points"], "p10": 0, "p90": 0} for r in train], "metamodel_mean")),
    ]
    validation_metrics = [
        ("metamodel", metrics(validation, validation_predictions, "metamodel_mean", probabilistic=True)),
        ("razzball", metrics(validation, [{"metamodel_mean": r["razzball_points"], "p10": 0, "p90": 0} for r in validation], "metamodel_mean")),
    ]
    metric_rows = []
    for split, values in [("training", train_metrics), ("validation", validation_metrics)]:
        for model, result in values:
            metric_rows.append({"split": split, "model": model, **result})
    position_dir = output / position.lower()
    position_dir.mkdir(parents=True, exist_ok=True)
    (position_dir / "training_predictions.json").write_text(json.dumps(train_predictions, indent=2), encoding="utf-8")
    (position_dir / "validation_predictions.json").write_text(json.dumps(validation_predictions, indent=2), encoding="utf-8")
    (position_dir / "metrics.json").write_text(json.dumps(metric_rows, indent=2), encoding="utf-8")
    (position_dir / "model.json").write_text(json.dumps({"position": position, "model_version": "qb-wr-bootstrap-ridge-v1", "seed": SEED, "features": FEATURES, "members": len(models), "residual_standard_deviation": residual_std, "coefficients": models}, indent=2), encoding="utf-8")
    svg_benchmark(position_dir / "training-benchmark.svg", position, "training", [(model, result["rmse"]) for model, result in train_metrics])
    svg_benchmark(position_dir / "validation-benchmark.svg", position, "validation", [(model, result["rmse"]) for model, result in validation_metrics])
    svg_fit(position_dir / "training-fit.svg", position, "training", train, train_predictions)
    svg_fit(position_dir / "validation-fit.svg", position, "validation", validation, validation_predictions)
    save_database(position_dir / f"{position.lower()}-metamodel.sqlite", position, train, validation, train_predictions, validation_predictions, metric_rows, models, residual_std)
    return {"position": position, "train_metrics": train_metrics, "validation_metrics": validation_metrics, "samples": {"training": len(train), "validation": len(validation)}, "database": str(position_dir / f"{position.lower()}-metamodel.sqlite")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="artifacts/qb-wr-models")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    results = [run_position(position, output) for position in ("QB", "WR")]
    (output / "results.json").write_text(json.dumps({"seed": SEED, "data_status": "deterministic benchmark fixture", "results": results}, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

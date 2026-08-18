#!/usr/bin/env python3
"""Generate current 2026 preseason predictions for QB/RB/WR/TE.

The model uses recorded nflverse outcomes through 2025 and current Razzball
rankings/projections as comparison inputs. It never treats current Razzball
rankings as outcome labels and never invents actual 2026 results.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

from replay_wr_2024 import (
    FEATURES,
    NFLVERSE_URL,
    PARSER_VERSION,
    POSITION_CONFIG,
    RidgeModel,
    build_features,
    load_nflverse,
    normalize_name,
    normalize_team,
    parse_points,
    parse_rankings,
    position_config,
    save_cached,
    source_matches,
)


CURRENT_SEASON = 2026
HISTORY_END = 2025
CURRENT_RAZZBALL_RANK_URLS = {
    "QB": "https://football.razzball.com/2025-fantasy-football-quarterback-rankings/",
    "RB": "https://football.razzball.com/2025-fantasy-football-running-back-rankings/",
    "WR": "https://football.razzball.com/2025-fantasy-football-wide-receiver-rankings/",
    "TE": "https://football.razzball.com/2025-fantasy-football-tight-end-rankings/",
}
CURRENT_RAZZBALL_POINTS_URLS = {
    position: config["pre_points"] for position, config in POSITION_CONFIG.items()
}


def load_context(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not path.exists():
        return {}, {"status": "unavailable", "path": str(path), "rows": 0, "reason": "no real draft/college/role context file supplied"}
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw.get("players", raw) if isinstance(raw, dict) else raw
    context: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("player_id") or normalize_name(str(row.get("player_name", ""))))
        if key:
            context[key] = row
    return context, {"status": "loaded", "path": str(path), "rows": len(context), "reason": "real context records"}


def current_identity(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        latest[row["player_id"]] = {
            "player_id": row["player_id"],
            "player_name": row["player_name"],
            "team": row["team"],
            "points": 0.0,
            "actual_rank": 0,
        }
    return latest


def source_meta(name: str, url: str, saved: dict[str, Any], rows: int, kind: str) -> dict[str, Any]:
    return {
        "name": name,
        "url": url,
        "kind": kind,
        "status": "downloaded",
        "retrieved_at": saved["retrieved_at"],
        "sha256": saved["sha256"],
        "bytes": saved["bytes"],
        "parsed_rows": rows,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


def point_metrics(rows: list[dict[str, Any]], model_key: str, source_key: str) -> dict[str, Any]:
    comparable = [row for row in rows if row.get(model_key) is not None and row.get(source_key) is not None]
    if not comparable:
        return {"samples": 0, "mae": None, "rmse": None, "bias": None}
    errors = [float(row[model_key]) - float(row[source_key]) for row in comparable]
    return {"samples": len(errors), "mae": mean(abs(value) for value in errors), "rmse": math.sqrt(mean(value * value for value in errors)), "bias": mean(errors)}


def rank_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    comparable = [row for row in rows if row.get("model_rank") is not None and row.get("razzball_rank") is not None]
    if not comparable:
        return {"samples": 0, "spearman": None, "top12_hit_rate": None, "top24_hit_rate": None, "top36_hit_rate": None}
    predicted = sorted(comparable, key=lambda row: row["model_rank"])
    source = sorted(comparable, key=lambda row: row["razzball_rank"])
    source_rank = {row["player_id"]: index for index, row in enumerate(source, 1)}
    n = len(predicted)
    squared = sum((index - source_rank[row["player_id"]]) ** 2 for index, row in enumerate(predicted, 1))
    result = {"samples": n, "spearman": 1 - 6 * squared / (n * (n * n - 1)) if n > 1 else None}
    for top in (12, 24, 36):
        model_ids = {row["player_id"] for row in predicted[:top]}
        source_ids = {row["player_id"] for row in source[:top]}
        result[f"top{top}_hit_rate"] = len(model_ids & source_ids) / min(top, n)
    return result


def write_sqlite(path: Path, predictions: list[dict[str, Any]], manifest: dict[str, Any], metrics: dict[str, Any]) -> None:
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE predictions (player_id TEXT PRIMARY KEY, player_name TEXT, team TEXT, position TEXT, scoring_period TEXT, model_points REAL, model_rank INTEGER, p10 REAL, p50 REAL, p90 REAL, razzball_points REAL, razzball_rank INTEGER, rank_delta REAL);
      CREATE TABLE metrics (metric TEXT PRIMARY KEY, value REAL, samples INTEGER);
    """)
    db.executemany("INSERT INTO metadata VALUES (?, ?)", [("manifest", json.dumps(manifest, sort_keys=True)), ("model_version", manifest["model"]["model_version"])])
    db.executemany("INSERT INTO predictions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        (row["player_id"], row["player_name"], row["team"], row["position"], row["scoring_period"], row["model_points"], row["model_rank"], row["p10"], row["p50"], row["p90"], row.get("razzball_points"), row.get("razzball_rank"), row.get("rank_delta")) for row in predictions
    ])
    db.executemany("INSERT INTO metrics VALUES (?, ?, ?)", [(key, value, metrics.get("samples", 0)) for key, value in metrics.items() if isinstance(value, (int, float))])
    db.commit()
    db.close()


def run(position: str, data_dir: Path, output: Path, stats_2025_path: Path, context_path: Path, refresh: bool) -> dict[str, Any]:
    position = position.upper()
    position_config(position)
    output.mkdir(parents=True, exist_ok=True)
    source_dir = data_dir / f"chatpft-{position.lower()}-2026" / "source-snapshots"
    source_dir.mkdir(parents=True, exist_ok=True)
    legacy_path = data_dir / "nflverse-player_stats.csv.gz"
    saved_legacy = save_cached(NFLVERSE_URL, legacy_path, refresh)
    rows, team_context = load_nflverse(legacy_path, 2018, HISTORY_END, position, (stats_2025_path,))
    features, preseason_features = build_features(rows, team_context, CURRENT_SEASON, position)
    model = RidgeModel.fit(features, position, f"{position.lower()}-2026-preseason-hard-stats-ridge-v2")
    rookie_rows = [row for row in features if row.get("experience_seasons", 0) == 0]
    rookie_model = RidgeModel.fit(rookie_rows if len(rookie_rows) >= 20 else features, position, f"{position.lower()}-2026-preseason-rookie-ridge-v1")
    context, context_meta = load_context(context_path)
    identities = current_identity(rows)
    rank_path = source_dir / f"razzball-{position.lower()}-current-rankings.html"
    point_path = source_dir / f"razzball-{position.lower()}-current-projections.html"
    saved_rank = save_cached(CURRENT_RAZZBALL_RANK_URLS[position], rank_path, refresh)
    saved_points = save_cached(CURRENT_RAZZBALL_POINTS_URLS[position], point_path, refresh)
    rank_rows = parse_rankings(rank_path)
    point_rows = parse_points(point_path)
    rank_matches, rank_counts = source_matches(rank_rows, identities)
    point_matches, point_counts = source_matches(point_rows, identities)
    predictions = []
    for player_id, identity in identities.items():
        feature = preseason_features.get(player_id, {name: 0.0 for name in FEATURES})
        context_row = context.get(player_id) or context.get(normalize_name(identity["player_name"]), {})
        is_rookie = feature.get("experience_seasons", 0) == 0
        active_model = rookie_model if is_rookie else model
        forecast = active_model.predict(feature, 1.25 if is_rookie and position == "QB" else (1.15 if is_rookie else 1.0))
        expected_games = min(17.0, max(1.0, feature.get("prior_availability_rate", 0.7) * 17.0))
        hard_stats_points = forecast["mean"] * expected_games
        source_points = point_matches.get(player_id, {}).get("projected_points")
        external_weight = 0.25 if is_rookie and source_points is not None else 0.0
        model_points = hard_stats_points * (1 - external_weight) + (source_points or 0.0) * external_weight
        predictions.append({
            "player_id": player_id,
            "player_name": identity["player_name"],
            "team": identity["team"],
            "position": position,
            "scoring_period": "2026-ROS",
            "model_points": model_points,
            "hard_stats_points": hard_stats_points,
            "model_rank": None,
            "p10": forecast["p10"] * expected_games,
            "p50": model_points,
            "p90": forecast["p90"] * expected_games,
            "expected_games": expected_games,
            "razzball_points": source_points,
            "razzball_rank": rank_matches.get(player_id, {}).get("rank"),
            "rookie": is_rookie,
            "external_context_weight": external_weight,
            "draft_capital": context_row.get("draft_capital"),
            "college_production": context_row.get("college_production"),
            "expected_role": context_row.get("expected_role"),
            "context_status": "matched" if context_row else context_meta["status"],
        })
    predictions.sort(key=lambda row: (-row["model_points"], row["player_name"]))
    for index, row in enumerate(predictions, 1):
        row["model_rank"] = index
        if row.get("razzball_rank") is not None:
            row["rank_delta"] = row["model_rank"] - row["razzball_rank"]
    model_vs_razzball = rank_metrics(predictions)
    point_comparison = point_metrics(predictions, "model_points", "razzball_points")
    metrics = {"position": position, "rank_comparison": model_vs_razzball, "point_comparison": point_comparison, "rank_matching": rank_counts, "point_matching": point_counts}
    model_meta = model.metadata()
    manifest = {
        "schema_version": "chatpft.position.preseason.v1",
        "replay_id": f"chatpft-{position.lower()}-2026-preseason",
        "position": position,
        "season": CURRENT_SEASON,
        "preseason_cutoff": datetime.now(timezone.utc).isoformat(),
        "training_window": "2018-2025",
        "prediction_horizon": "2026-ROS",
        "data_status": "real nflverse outcomes through 2025; current Razzball comparison",
        "sources": [
            {"name": "nflverse_player_stats_2018_2024", "url": NFLVERSE_URL, "sha256": saved_legacy["sha256"], "parsed_rows": len(rows)},
            {"name": "nflverse_player_stats_2025", "path": str(stats_2025_path), "sha256": hashlib.sha256(stats_2025_path.read_bytes()).hexdigest(), "parsed_rows": sum(row["season"] == HISTORY_END for row in rows)},
            source_meta("razzball_current_rankings", CURRENT_RAZZBALL_RANK_URLS[position], saved_rank, len(rank_rows), "rank"),
            source_meta("razzball_current_projections", CURRENT_RAZZBALL_POINTS_URLS[position], saved_points, len(point_rows), "points"),
        ],
        "matching": {"rank": rank_counts, "points": point_counts},
        "row_counts": {"training": len(features), "players": len(predictions), "predictions": len(predictions)},
        "model": model_meta,
        "rookie_model": rookie_model.metadata(),
        "context": context_meta,
        "metrics": metrics,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (output / "model.json").write_text(json.dumps(model_meta, indent=2), encoding="utf-8")
    (output / "predictions.json").write_text(json.dumps(predictions, indent=2), encoding="utf-8")
    with (output / "weekly-predictions.jsonl").open("w", encoding="utf-8") as handle:
        for row in predictions:
            handle.write(json.dumps({**row, "target_period": "2026-ROS", "regime": "current_preseason", "actual_points": None, "outcome_status": "future"}, sort_keys=True) + "\n")
    (output / "checkpoints.jsonl").write_text(json.dumps({"schema_version": "chatpft.position.checkpoint.v1", "replay_id": manifest["replay_id"], "position": position, "checkpoint_id": f"{manifest['replay_id']}:preseason", "target_period": "2026-ROS", "prediction_cutoff": manifest["preseason_cutoff"], "regime": "current_preseason", "model_version": model_meta["model_version"]}) + "\n", encoding="utf-8")
    (output / "walkforward-manifest.json").write_text(json.dumps({"schema_version": "chatpft.position.preseason-dashboard.v1", "replay_id": manifest["replay_id"], "position": position, "season": CURRENT_SEASON, "checkpoints": 1, "preseason_cutoff": manifest["preseason_cutoff"], "training_window": manifest["training_window"], "features": FEATURES, "sources": manifest["sources"], "data_status": manifest["data_status"]}, indent=2), encoding="utf-8")
    (output / "weekly-metrics.json").write_text(json.dumps([], indent=2), encoding="utf-8")
    (output / "subgroup-metrics.json").write_text(json.dumps([], indent=2), encoding="utf-8")
    (output / "model-comparisons.json").write_text(json.dumps([], indent=2), encoding="utf-8")
    (output / "promotion-decision.json").write_text(json.dumps({"status": "current_preseason", "approved": False, "reason": "2026 has no future outcome validation yet"}, indent=2), encoding="utf-8")
    report = [
        f"# ChatPFT 2026 {position} Preseason Predictions", "", "This artifact uses real nflverse outcomes through 2025 and compares predictions with current Razzball data.", "", "## Model", f"- Training window: `2018-2025`", f"- Players predicted: `{len(predictions)}`", f"- Model version: `{model_meta['model_version']}`", f"- Rookie training rows: `{len(rookie_rows)}`", f"- Context status: `{context_meta['status']}`", "", "## Razzball Comparison", f"- Rank samples: `{model_vs_razzball['samples']}`", f"- Rank Spearman: `{fmt(model_vs_razzball.get('spearman'))}`", f"- Top-12 overlap: `{fmt(model_vs_razzball.get('top12_hit_rate'))}`", f"- Point comparison samples: `{point_comparison['samples']}`", f"- Point MAE versus Razzball: `{fmt(point_comparison.get('mae'))}`", "", "## Takeaways", f"- The model produces a full `2026-ROS` ranked prediction stream for the draft dashboard.", f"- Razzball rank correlation is `{fmt(model_vs_razzball.get('spearman'))}` on `{model_vs_razzball['samples']}` matched players.", "- Rookie rows use a separate model and widened uncertainty; matched current Razzball point projections contribute a documented 25% external prior weight.", "- Draft capital, college production, and expected role are consumed only when real context records are supplied; missing context is not synthesized.", "- Availability, role, and news sources remain the largest unmodeled uncertainty.", "", "## Dashboard Contract", "- `predictions.json` contains model and Razzball ranks/points.", "- `weekly-predictions.jsonl` is compatible with the modeling API.", "- `walkforward-manifest.json` identifies this as a current preseason artifact with one checkpoint.", "- Promotion is intentionally false until 2026 outcomes exist.",
    ]
    (output / "report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    (output / "phase8-report.md").write_text("# 2026 Preseason Status\n\nNo future outcome validation is available yet; this artifact is not a walk-forward promotion candidate.\n", encoding="utf-8")
    write_sqlite(output / f"{position.lower()}-preseason.sqlite", predictions, manifest, metrics)
    return manifest


def fmt(value: Any) -> str:
    return "-" if value is None else f"{float(value):.3f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=sorted(POSITION_CONFIG), required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output", required=True)
    parser.add_argument("--stats-2025-path", default="data/nflverse-stats_player_week-2025.csv.gz")
    parser.add_argument("--context-path", default="data/chatpft-position-context.json")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    manifest = run(args.position, Path(args.data_dir), Path(args.output), Path(args.stats_2025_path), Path(args.context_path), args.refresh)
    print(json.dumps({"position": manifest["position"], "output": args.output, "players": manifest["row_counts"]["players"], "matching": manifest["matching"]}, indent=2))


if __name__ == "__main__":
    main()

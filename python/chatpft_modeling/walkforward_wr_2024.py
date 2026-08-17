#!/usr/bin/env python3
"""Run the real-data 2024 WR walk-forward replay.

This extends the phase 0-4 preseason artifact into immutable weekly
checkpoints. Missing historical provider snapshots are recorded as unavailable
and never filled with current or synthetic values.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from replay_wr_2024 import (  # noqa: E402
    FEATURES,
    NFLVERSE_URL,
    PARSER_VERSION,
    PRESEASON_CUTOFF,
    SEASON,
    RidgeModel,
    build_features,
    choose_archive_capture,
    fetch_archive_source,
    history_summary,
    load_nflverse,
    normalize_name,
    parse_rankings,
    parse_points,
    save_cached,
    season_totals,
    source_matches,
)


WEEK_STARTS = [
    "2024-09-05", "2024-09-12", "2024-09-19", "2024-09-26",
    "2024-10-03", "2024-10-10", "2024-10-17", "2024-10-24",
    "2024-10-31", "2024-11-07", "2024-11-14", "2024-11-21",
    "2024-11-28", "2024-12-05", "2024-12-12", "2024-12-19",
    "2024-12-25", "2025-01-04",
]
REPLAY_ID = "chatpft-wr-2024"
BOOTSTRAP_SEED = 20260817
BOOTSTRAP_RESAMPLES = 500


def checkpoint_cutoff(target_week: int) -> str:
    if target_week == 1:
        return PRESEASON_CUTOFF
    target = date.fromisoformat(WEEK_STARTS[target_week - 1])
    cutoff = target - timedelta(days=1)
    return f"{cutoff.isoformat()}T08:00:00-04:00"


def period_key(week: int) -> str:
    return f"{SEASON}-W{week}"


def source_plan(name: str, url: str, kind: str) -> dict[str, str]:
    return {"name": name, "url": url, "kind": kind}


WEEKLY_SOURCE_PLANS = [
    source_plan("razzball_weekly_rankings", "https://football.razzball.com/weekly-rankings-wr-ppr/", "rank"),
    source_plan("razzball_weekly_points", "https://football.razzball.com/pigskinonator-wr/", "points"),
]


def unavailable_source(name: str, url: str, cutoff: str, reason: str) -> dict[str, Any]:
    return {
        "name": name,
        "requested_url": url,
        "kind": "external",
        "cutoff": cutoff,
        "status": "unavailable",
        "reason": reason,
        "parser_version": PARSER_VERSION,
        "source_snapshot_id": None,
    }


def collect_week_sources(data_dir: Path, target_week: int, refresh: bool) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    cutoff = checkpoint_cutoff(target_week)
    snapshot_dir = data_dir / "chatpft-wr-replay" / "weekly-source-snapshots"
    metadata: list[dict[str, Any]] = []
    parsed: dict[str, list[dict[str, Any]]] = {"rank": [], "points": []}
    for plan in WEEKLY_SOURCE_PLANS:
        source = local_capture(plan, snapshot_dir, cutoff)
        if source is None:
            source = fetch_archive_source(plan, snapshot_dir, refresh, cutoff)
        if source.get("status") == "downloaded":
            path = Path(source["path"])
            values = parse_rankings(path) if plan["kind"] == "rank" else parse_points(path)
            source["parsed_rows"] = len(values)
            source["source_snapshot_id"] = source.get("sha256")
            parsed[plan["kind"]].extend(values)
        else:
            source["parsed_rows"] = 0
            source["source_snapshot_id"] = None
        metadata.append(source)
    # ESPN and FFToday historical weekly endpoints have no verified 2024
    # captures in the archive. Keeping them explicit makes denominators honest.
    metadata.extend([
        unavailable_source("espn_weekly_projections", "https://site.web.api.espn.com/apis/site/v3/sports/football/nfl/projections", cutoff, "no verified 2024 archive capture"),
        unavailable_source("fftoday_weekly_projections", "https://www.fftoday.com/playerwkproj.php?Season=2024&PosID=30", cutoff, "no verified 2024 archive capture"),
    ])
    return metadata, parsed


def local_capture(plan: dict[str, str], directory: Path, cutoff: str) -> dict[str, Any] | None:
    """Reuse an already captured archive page without re-querying CDX per week."""
    cutoff_key = datetime.fromisoformat(cutoff).astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")
    candidates = []
    for path in directory.glob(f"{plan['name']}-*.html"):
        timestamp = path.stem.rsplit("-", 1)[-1]
        if timestamp.isdigit() and timestamp <= cutoff_key:
            candidates.append((timestamp, path))
    if not candidates:
        return None
    timestamp, path = sorted(candidates)[-1]
    body = path.read_bytes()
    original = plan["url"].rstrip("/")
    return {
        "name": plan["name"],
        "requested_url": plan["url"],
        "kind": plan["kind"],
        "cutoff": cutoff,
        "parser_version": PARSER_VERSION,
        "status": "downloaded",
        "timestamp": timestamp,
        "original": original,
        "capture_url": f"https://web.archive.org/web/{timestamp}id_/{original}",
        "url": f"https://web.archive.org/web/{timestamp}id_/{original}",
        "path": str(path),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "cached": True,
        "source_snapshot_id": hashlib.sha256(body).hexdigest(),
    }


def load_news_events(data_dir: Path, cutoff: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load optional structured, timestamped news events without inventing events."""
    path = Path(__import__("os").environ.get("PMT_WR_NEWS_EVENTS_PATH", str(data_dir / "chatpft-wr-replay" / "news-events.jsonl")))
    if not path.exists():
        return [], {"name": "structured_news_events", "status": "unavailable", "path": str(path), "reason": "no timestamped event file supplied", "rows": 0}
    cutoff_time = datetime.fromisoformat(cutoff)
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        effective = datetime.fromisoformat(row["effective_at"])
        if effective <= cutoff_time:
            events.append(row)
    return events, {"name": "structured_news_events", "status": "loaded", "path": str(path), "rows": len(events), "parser_version": PARSER_VERSION}


def fit_model(training: list[dict[str, Any]]) -> RidgeModel:
    return RidgeModel.fit(training) if training else RidgeModel.fit([{
        "actual_points": 8.0,
        **{feature: 0.0 for feature in FEATURES},
    }])


def prediction(row: dict[str, Any], model: RidgeModel, expected_games: float, model_id: str, target_week: int, regime: str) -> dict[str, Any]:
    weekly = model.predict(row)
    remaining = max(1, 19 - target_week)
    return {
        "replay_id": REPLAY_ID,
        "prediction_id": f"{REPLAY_ID}:{regime}:{period_key(target_week)}:{row['player_id']}",
        "target_period": period_key(target_week),
        "prediction_cutoff": checkpoint_cutoff(target_week),
        "player_id": row["player_id"],
        "player_name": row.get("player_name", ""),
        "team": row.get("team", ""),
        "position": "WR",
        "model_id": model_id,
        "regime": regime,
        "training_cutoff": row.get("feature_cutoff", ""),
        "feature_cutoff": row.get("feature_cutoff", ""),
        "mean": weekly["mean"],
        "standard_deviation": weekly["standard_deviation"],
        "p10": weekly["p10"],
        "p25": max(0.0, weekly["mean"] - 0.674 * weekly["standard_deviation"]),
        "p50": weekly["p50"],
        "p75": weekly["mean"] + 0.674 * weekly["standard_deviation"],
        "p90": weekly["p90"],
        "rest_of_season_mean": weekly["mean"] * remaining * max(0.25, min(1.0, expected_games / 17.0)),
        "as_of_groups": {
            "prior_games": row.get("prior_games", 0),
            "prior_games_bucket": prior_games_bucket(row.get("prior_games", 0)),
            "rookie": row.get("experience_seasons", 0) == 0,
            "injury_status": "unknown",
            "team_change": None,
        },
        "source_snapshot_ids": [],
    }


def prior_games_bucket(value: float) -> str:
    if value <= 0:
        return "0"
    if value <= 5:
        return "1-5"
    if value <= 16:
        return "6-16"
    return "17+"


def assign_ranks(rows: list[dict[str, Any]], value_key: str, rank_key: str) -> None:
    for rank, row in enumerate(sorted(rows, key=lambda item: (-float(item[value_key]), item["player_name"])), 1):
        row[rank_key] = rank


def actual_week_rows(features: list[dict[str, Any]], week: int) -> list[dict[str, Any]]:
    return [row for row in features if row["season"] == SEASON and row["week"] == week]


def attach_actuals(predictions: list[dict[str, Any]], outcomes: list[dict[str, Any]]) -> None:
    actual_ranked = sorted(outcomes, key=lambda row: (-row["actual_points"], row["player_name"]))
    actual_by_player = {row["player_id"]: {**row, "actual_rank": index} for index, row in enumerate(actual_ranked, 1)}
    for row in predictions:
        actual = actual_by_player.get(row["player_id"])
        if actual:
            row.update({"actual_points": actual["actual_points"], "actual_rank": actual["actual_rank"], "outcome_status": "observed" if actual["actual_points"] else "zero_observed"})
        else:
            row.update({"actual_points": None, "actual_rank": None, "outcome_status": "unavailable"})


def pinball(actual: float, forecast: float, level: float) -> float:
    return (level - (1 if actual < forecast else 0)) * (actual - forecast)


def rank_correlation(rows: list[dict[str, Any]]) -> float | None:
    usable = [row for row in rows if row.get("actual_rank") is not None and row.get("predicted_rank") is not None]
    if len(usable) < 2:
        return None
    actual_mean = mean(row["actual_rank"] for row in usable)
    predicted_mean = mean(row["predicted_rank"] for row in usable)
    numerator = sum((row["actual_rank"] - actual_mean) * (row["predicted_rank"] - predicted_mean) for row in usable)
    denominator = math.sqrt(sum((row["actual_rank"] - actual_mean) ** 2 for row in usable) * sum((row["predicted_rank"] - predicted_mean) ** 2 for row in usable))
    return numerator / denominator if denominator else 0.0


def metric_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    usable = [row for row in rows if row.get("actual_points") is not None]
    if not usable:
        return {"samples": 0, "mae": None, "rmse": None, "bias": None, "p10_p90_coverage": None, "pinball_p10": None, "pinball_p50": None, "pinball_p90": None, "spearman": None}
    errors = [row["mean"] - row["actual_points"] for row in usable]
    return {
        "samples": len(usable),
        "mae": mean(abs(error) for error in errors),
        "rmse": math.sqrt(mean(error * error for error in errors)),
        "bias": mean(errors),
        "p10_p90_coverage": mean(row["p10"] <= row["actual_points"] <= row["p90"] for row in usable),
        "pinball_p10": mean(pinball(row["actual_points"], row["p10"], 0.10) for row in usable),
        "pinball_p50": mean(pinball(row["actual_points"], row["p50"], 0.50) for row in usable),
        "pinball_p90": mean(pinball(row["actual_points"], row["p90"], 0.90) for row in usable),
        "spearman": rank_correlation(usable),
        "rank_samples": sum(row.get("actual_rank") is not None for row in usable),
    }


def cluster_bootstrap(rows: list[dict[str, Any]], statistic: Callable[[list[dict[str, Any]]], float | None], seed: int = BOOTSTRAP_SEED, resamples: int = BOOTSTRAP_RESAMPLES) -> dict[str, Any]:
    clusters = sorted({row["target_period"] for row in rows})
    estimate = statistic(rows)
    if len(clusters) < 4 or estimate is None:
        return {"estimate": estimate, "lower": None, "upper": None, "clusters": len(clusters), "status": "insufficient_data", "seed": seed, "resamples": resamples}
    by_cluster = {cluster: [row for row in rows if row["target_period"] == cluster] for cluster in clusters}
    rng = random.Random(seed)
    values = []
    for _ in range(resamples):
        sample = []
        for _ in clusters:
            sample.extend(by_cluster[rng.choice(clusters)])
        value = statistic(sample)
        if value is not None:
            values.append(value)
    values.sort()
    lower = values[max(0, int(len(values) * 0.025) - 1)] if values else None
    upper = values[min(len(values) - 1, int(len(values) * 0.975))] if values else None
    return {"estimate": estimate, "lower": lower, "upper": upper, "clusters": len(clusters), "status": "ok", "seed": seed, "resamples": resamples}


def build_attribution(predictions: list[dict[str, Any]], source_ids: list[str], news_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in predictions:
        events = [event for event in news_events if event.get("player_id") == row["player_id"]]
        result.append({
            "checkpoint_id": f"{row['target_period']}-pre",
            "target_period": row["target_period"],
            "player_id": row["player_id"],
            "regime": row["regime"],
            "stages": {
                "prior_checkpoint_mean": row["mean"],
                "hard_stats_update_mean": row["mean"],
                "source_update_mean": row["mean"],
                "news_update_mean": row["mean"],
                "retrained_model_mean": row["mean"],
            },
            "deltas": {"hard_stats": 0.0, "source": 0.0, "news": 0.0, "retrained_model": 0.0},
            "news_event_ids": [event.get("event_id") for event in events],
            "source_snapshot_ids": source_ids,
            "news_status": "events_available" if events else "no_events_for_player",
        })
    return result


def write_sqlite(path: Path, checkpoints: list[dict[str, Any]], outcomes: list[dict[str, Any]], predictions: list[dict[str, Any]], metrics: list[dict[str, Any]]) -> None:
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE checkpoints (checkpoint_id TEXT PRIMARY KEY, target_period TEXT, prediction_cutoff TEXT, completed_through_period TEXT, regime TEXT, model_version TEXT, source_snapshot_ids_json TEXT);
      CREATE TABLE weekly_outcomes (target_period TEXT, player_id TEXT, actual_points REAL, actual_rank INTEGER, outcome_status TEXT, PRIMARY KEY (target_period, player_id));
      CREATE TABLE weekly_predictions (prediction_id TEXT PRIMARY KEY, target_period TEXT, player_id TEXT, regime TEXT, mean REAL, standard_deviation REAL, p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL, predicted_rank INTEGER, actual_points REAL, actual_rank INTEGER, outcome_status TEXT);
      CREATE TABLE weekly_metrics (target_period TEXT, regime TEXT, metric TEXT, value REAL, samples INTEGER);
    """)
    db.executemany("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)", [(row["checkpoint_id"], row["target_period"], row["prediction_cutoff"], row.get("completed_through_period"), row["regime"], row["model_version"], json.dumps(row.get("source_snapshot_ids", []))) for row in checkpoints])
    db.executemany("INSERT INTO weekly_outcomes VALUES (?, ?, ?, ?, ?)", [(row["target_period"], row["player_id"], row["actual_points"], row["actual_rank"], "observed") for row in outcomes])
    db.executemany("INSERT INTO weekly_predictions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [(row["prediction_id"], row["target_period"], row["player_id"], row["regime"], row["mean"], row["standard_deviation"], row["p10"], row["p25"], row["p50"], row["p75"], row["p90"], row.get("predicted_rank"), row.get("actual_points"), row.get("actual_rank"), row["outcome_status"]) for row in predictions])
    db.executemany("INSERT INTO weekly_metrics VALUES (?, ?, ?, ?, ?)", [(row["target_period"], row["regime"], key, value, row.get("samples", 0)) for row in metrics for key, value in row.items() if key not in ("target_period", "regime", "samples", "rank_samples") and isinstance(value, (int, float))])
    db.commit()
    db.close()


def run(args: argparse.Namespace) -> dict[str, Any]:
    data_dir = Path(args.data_dir)
    output = Path(args.output)
    data_dir.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    nfl_path = data_dir / "nflverse-player_stats.csv.gz"
    nfl_meta = save_cached(NFLVERSE_URL, nfl_path, args.refresh)
    rows, team_pass = load_nflverse(nfl_path, args.history_start, SEASON)
    features, preseason_features = build_features(rows, team_pass, SEASON)
    historical = [row for row in features if row["season"] < SEASON]
    totals = season_totals(rows, SEASON)
    identity_rank_rows = [{"name": value["player_name"], "team": value["team"], "rank": value["actual_rank"]} for value in totals.values()]
    identity_source, _ = source_matches(identity_rank_rows, totals)
    preseason_model = RidgeModel.fit(historical)
    checkpoints: list[dict[str, Any]] = []
    all_predictions: list[dict[str, Any]] = []
    all_outcomes: list[dict[str, Any]] = []
    all_metrics: list[dict[str, Any]] = []
    all_sources: list[dict[str, Any]] = [{"name": "nflverse_player_stats", "status": "downloaded", "url": NFLVERSE_URL, "sha256": nfl_meta["sha256"], "parsed_rows": len(rows)}]
    all_attribution: list[dict[str, Any]] = []
    for target_week in range(1, 19):
        cutoff = checkpoint_cutoff(target_week)
        source_meta, source_rows = collect_week_sources(data_dir, target_week, args.refresh)
        all_sources.extend([{**source, "target_period": period_key(target_week)} for source in source_meta])
        source_rank, source_counts = source_matches(source_rows["rank"], totals)
        news_events, news_meta = load_news_events(data_dir, cutoff)
        all_sources.append({**news_meta, "target_period": period_key(target_week)})
        checkpoint_id = f"{REPLAY_ID}:w{target_week - 1:02d}"
        if target_week == 1:
            completed = None
        else:
            completed = period_key(target_week - 1)
        checkpoints.append({
            "schema_version": "chatpft.wr.checkpoint.v1",
            "replay_id": REPLAY_ID,
            "checkpoint_id": checkpoint_id,
            "target_period": period_key(target_week),
            "prediction_cutoff": cutoff,
            "completed_through_period": completed,
            "regime": "all",
            "model_version": "wr-2024-walkforward-v1",
            "training_start_period": f"{args.history_start}-W1",
            "training_cutoff": completed or "2023-W18",
            "source_snapshot_ids": [source.get("source_snapshot_id") for source in source_meta if source.get("source_snapshot_id")],
            "source_availability": {source["name"]: source["status"] for source in source_meta},
            "news_status": news_meta,
            "source_matching": source_counts,
        })
        target_rows = actual_week_rows(features, target_week)
        outcomes = [{"target_period": period_key(target_week), "player_id": row["player_id"], "player_name": row["player_name"], "team": row["team"], "actual_points": row["actual_points"], "actual_rank": None} for row in target_rows]
        actual_ranked = sorted(outcomes, key=lambda row: (-row["actual_points"], row["player_id"]))
        for index, outcome in enumerate(actual_ranked, 1):
            outcome["actual_rank"] = index
        all_outcomes.extend(outcomes)
        target_by_player = {row["player_id"]: row for row in target_rows}
        eligible = set(preseason_features) | set(source_rank)
        target_feature_by_player = {player_id: next((row for row in features if row["player_id"] == player_id and row["season"] == SEASON and row["week"] == target_week), None) for player_id in eligible}
        adaptive_training = historical + [row for row in features if row["season"] == SEASON and row["week"] < target_week]
        adaptive_model = RidgeModel.fit(adaptive_training)
        for regime, model, use_target_features in [
            ("frozen_preseason", preseason_model, False),
            ("frozen_weights_adaptive_features", preseason_model, True),
            ("adaptive_expanding", adaptive_model, True),
        ]:
            forecast_rows = []
            for player_id in eligible:
                target_feature = target_feature_by_player.get(player_id)
                feature = target_feature if use_target_features and target_feature else preseason_features.get(player_id, history_summary([], [], None, SEASON))
                feature = {**feature, "player_id": player_id, "player_name": (target_feature or {}).get("player_name", ""), "team": (target_feature or {}).get("team", "")}
                expected_games = min(17.0, max(1.0, feature.get("prior_availability_rate", 0.5) * 17.0))
                forecast_rows.append(prediction(feature, model, expected_games, f"wr-2024-{regime}", target_week, regime))
            assign_ranks(forecast_rows, "mean", "predicted_rank")
            source_forecast_rows = [row for row in forecast_rows if row["player_id"] in source_rank]
            assign_ranks(source_forecast_rows, "mean", "source_common_predicted_rank")
            for row in forecast_rows:
                if row["player_id"] in source_rank:
                    row["source_rank"] = source_rank[row["player_id"]]["rank"]
                row["source_snapshot_ids"] = [source.get("source_snapshot_id") for source in source_meta if source.get("source_snapshot_id")]
            attach_actuals(forecast_rows, outcomes)
            all_predictions.extend(forecast_rows)
            evaluated = [row for row in forecast_rows if row["actual_points"] is not None]
            metrics = {"target_period": period_key(target_week), "regime": regime, **metric_rows(evaluated)}
            metrics["bootstrap_mae"] = cluster_bootstrap(evaluated, lambda values: mean(abs(row["mean"] - row["actual_points"]) for row in values) if values else None)
            all_metrics.append(metrics)
            all_attribution.extend(build_attribution(
                forecast_rows,
                [source.get("source_snapshot_id") for source in source_meta if source.get("source_snapshot_id")],
                news_events
            ))
        # A source rank is benchmarked separately, not converted to points.
        for row in outcomes:
            if row["player_id"] in source_rank:
                all_metrics.append({"target_period": period_key(target_week), "regime": "razzball_rank", "rank_samples": len(source_rank), "spearman": None, "source_rows": source_counts})
                break
    checkpoints.append({
        "schema_version": "chatpft.wr.checkpoint.v1",
        "replay_id": REPLAY_ID,
        "checkpoint_id": f"{REPLAY_ID}:w18",
        "target_period": "terminal",
        "prediction_cutoff": "2025-01-05T08:00:00-05:00",
        "completed_through_period": period_key(18),
        "regime": "all",
        "model_version": "wr-2024-walkforward-v1",
        "training_start_period": f"{args.history_start}-W1",
        "training_cutoff": period_key(18),
        "source_snapshot_ids": [],
        "source_availability": {},
        "news_status": {"status": "terminal"},
    })
    # Populate source-rank blend ranks and source comparison metrics after all
    # regime forecasts have been assigned.
    for period in sorted({row["target_period"] for row in all_predictions}):
        period_rows = [row for row in all_predictions if row["target_period"] == period and row["regime"] == "adaptive_expanding" and row.get("source_rank") is not None]
        if period_rows:
            blend = sorted(period_rows, key=lambda row: (-(1 / max(1, row["predicted_rank"]) + 1 / max(1, row["source_rank"])), row["player_name"]))
            for rank, row in enumerate(blend, 1):
                row["source_rank_blend_rank"] = rank
    root_manifest = {
        "schema_version": "chatpft.wr.walkforward.v1",
        "replay_id": REPLAY_ID,
        "season": SEASON,
        "preseason_cutoff": PRESEASON_CUTOFF,
        "training_window": f"{args.history_start}-{SEASON - 1}",
        "data_status": "real nflverse outcomes; archive-first provider snapshots; missing sources explicit",
        "parser_version": PARSER_VERSION,
        "bootstrap": {"seed": BOOTSTRAP_SEED, "resamples": BOOTSTRAP_RESAMPLES, "unit": "target_period"},
        "features": FEATURES,
        "checkpoints": len(checkpoints),
        "sources": all_sources,
        "known_limitations": ["2024 weekly ESPN and FFToday captures were unavailable", "news events require a timestamped structured input file", "nflverse player_stats has no complete as-of availability panel"],
    }
    # Keep the phase 0-4 preseason manifest immutable; weekly replay metadata
    # has its own manifest so both artifacts can be compared side by side.
    (output / "walkforward-manifest.json").write_text(json.dumps(root_manifest, indent=2), encoding="utf-8")
    with (output / "checkpoints.jsonl").open("w", encoding="utf-8") as handle:
        for row in checkpoints:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    with (output / "weekly-outcomes.jsonl").open("w", encoding="utf-8") as handle:
        for row in all_outcomes:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    with (output / "weekly-predictions.jsonl").open("w", encoding="utf-8") as handle:
        for row in all_predictions:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    with (output / "attribution.jsonl").open("w", encoding="utf-8") as handle:
        for row in all_attribution:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    (output / "weekly-metrics.json").write_text(json.dumps(all_metrics, indent=2), encoding="utf-8")
    subgroup = subgroup_metrics(all_predictions)
    (output / "subgroup-metrics.json").write_text(json.dumps(subgroup, indent=2), encoding="utf-8")
    comparisons = compare_regimes(all_metrics)
    (output / "model-comparisons.json").write_text(json.dumps(comparisons, indent=2), encoding="utf-8")
    promotion = promotion_decision(comparisons)
    (output / "promotion-decision.json").write_text(json.dumps(promotion, indent=2), encoding="utf-8")
    write_phase8_report(output / "phase8-report.md", root_manifest, all_metrics, promotion)
    write_sqlite(output / "checkpoints.sqlite", checkpoints, all_outcomes, all_predictions, all_metrics)
    return {"manifest": root_manifest, "promotion": promotion, "metrics": all_metrics}


def subgroup_metrics(predictions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for regime in ("frozen_preseason", "frozen_weights_adaptive_features", "adaptive_expanding"):
        rows = [row for row in predictions if row["regime"] == regime and row.get("actual_points") is not None]
        groups = {"all": rows, "rookie": [row for row in rows if row["as_of_groups"]["rookie"]], "veteran": [row for row in rows if not row["as_of_groups"]["rookie"]], "prior_games_0": [row for row in rows if row["as_of_groups"]["prior_games_bucket"] == "0"], "prior_games_1_5": [row for row in rows if row["as_of_groups"]["prior_games_bucket"] == "1-5"], "prior_games_6_16": [row for row in rows if row["as_of_groups"]["prior_games_bucket"] == "6-16"], "prior_games_17_plus": [row for row in rows if row["as_of_groups"]["prior_games_bucket"] == "17+"]}
        for subgroup, values in groups.items():
            metrics = metric_rows(values)
            result.append({"regime": regime, "subgroup": subgroup, "minimum_samples": 30, "minimum_weeks": 8, "status": "ok" if len(values) >= 30 and len({row["target_period"] for row in values}) >= 8 else "insufficient_data", **metrics})
    return result


def compare_regimes(metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    periods = sorted({row["target_period"] for row in metrics if row.get("regime") == "adaptive_expanding"})
    for period in periods:
        frozen = next((row for row in metrics if row["target_period"] == period and row["regime"] == "frozen_preseason"), None)
        adaptive = next((row for row in metrics if row["target_period"] == period and row["regime"] == "adaptive_expanding"), None)
        if not frozen or not adaptive or frozen.get("rmse") is None or adaptive.get("rmse") is None:
            continue
        delta = adaptive["rmse"] - frozen["rmse"]
        result.append({"target_period": period, "baseline": "frozen_preseason", "candidate": "adaptive_expanding", "metric": "rmse", "baseline_value": frozen["rmse"], "candidate_value": adaptive["rmse"], "delta": delta, "status": "pass" if delta <= 0.25 else "fail"})
    return result


def promotion_decision(comparisons: list[dict[str, Any]]) -> dict[str, Any]:
    if not comparisons:
        return {"status": "insufficient_data", "approved": False, "reason": "no comparable checkpoint metrics"}
    failures = [row for row in comparisons if row["status"] == "fail"]
    delta_ci = cluster_bootstrap(comparisons, lambda values: mean(row["delta"] for row in values) if values else None)
    ci_failure = delta_ci["upper"] is not None and delta_ci["upper"] > 0.25
    return {
        "status": "fail" if failures or ci_failure else "pass",
        "approved": not failures and not ci_failure,
        "comparison_count": len(comparisons),
        "failures": failures,
        "delta_ci": delta_ci,
        "gates": {"max_rmse_regression": 0.25, "baseline": "frozen_preseason", "candidate": "adaptive_expanding", "bootstrap_unit": "target_period"}
    }


def write_phase8_report(path: Path, manifest: dict[str, Any], metrics: list[dict[str, Any]], promotion: dict[str, Any]) -> None:
    lines = ["# ChatPFT 2024 WR Walk-Forward Replay", "", "This report is generated from real nflverse outcomes and archive-first source attempts.", "", f"- Checkpoints: `{manifest['checkpoints']}`", f"- Bootstrap seed: `{manifest['bootstrap']['seed']}`", f"- Source records: `{len(manifest['sources'])}`", f"- Promotion decision: **{promotion['status']}**", "", "## Weekly Metrics", "", "| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in metrics:
        if "mae" not in row:
            continue
        lines.append(f"| {row['target_period']} | {row['regime']} | {row.get('samples', 0)} | {fmt(row.get('mae'))} | {fmt(row.get('rmse'))} | {fmt(row.get('p10_p90_coverage'))} | {fmt(row.get('pinball_p50'))} |")
    lines.extend(["", "## Limitations", "", "- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.", "- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.", "- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.", "- Promotion is a benchmark decision, not an automatic runtime model activation."])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def fmt(value: Any) -> str:
    return "-" if value is None else f"{float(value):.3f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output", default="artifacts/wr-2024-replay")
    parser.add_argument("--history-start", type=int, default=2018)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    result = run(args)
    print(json.dumps({"checkpoints": result["manifest"]["checkpoints"], "promotion": result["promotion"]}, indent=2))


if __name__ == "__main__":
    main()

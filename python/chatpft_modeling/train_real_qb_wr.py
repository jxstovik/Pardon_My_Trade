#!/usr/bin/env python3
"""Download real NFL outcomes/Razzball inputs and train QB/WR artifacts.

NFL outcomes come from nflverse. Razzball projections/rankings are fetched from
public pages; premium weekly projection tables are intentionally not bypassed.
Raw downloads are cache files under data/ and are ignored by the repository.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import sqlite3
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chatpft_modeling.train_qb_wr import (
    FEATURES, SEED, distribution, save_database, solve, svg_benchmark, svg_fit, train_ensemble
)

NFLVERSE_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz"
RAZZBALL_PROJECTIONS_URL = "https://football.razzball.com/projections/"
RAZZBALL_RANKING_URLS = {
    "QB": "https://football.razzball.com/2025-fantasy-football-quarterback-rankings/",
    "WR": "https://football.razzball.com/2025-fantasy-football-wide-receiver-rankings/",
}


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.cell = False
        self.row: list[str] = []
        self.tables: list[list[list[str]]] = []
        self.current: list[list[str]] | None = None

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self.depth += 1
            self.current = []
        elif self.depth and tag == "tr":
            self.row = []
        elif self.depth and tag in ("td", "th"):
            self.cell = True

    def handle_endtag(self, tag: str) -> None:
        if self.depth and tag in ("td", "th"):
            self.cell = False
        elif self.depth and tag == "tr" and self.row and self.current is not None:
            self.current.append(self.row)
        elif tag == "table" and self.depth:
            if self.current:
                self.tables.append(self.current)
            self.current = None
            self.depth -= 1

    def handle_data(self, data: str) -> None:
        if self.depth and self.cell and data.strip():
            self.row.append(" ".join(data.split()))


def download(url: str, path: Path) -> dict[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "PardonMyTrade/ChatPFT research"})
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    path.write_bytes(body)
    return {"url": url, "path": str(path), "sha256": hashlib.sha256(body).hexdigest(), "bytes": str(len(body))}


def fetch_cached(url: str, path: Path, refresh: bool) -> dict[str, str]:
    if refresh or not path.exists():
        return download(url, path)
    body = path.read_bytes()
    return {"url": url, "path": str(path), "sha256": hashlib.sha256(body).hexdigest(), "bytes": str(len(body)), "cached": "true"}


def normalize_name(value: str) -> str:
    value = value.replace("’", "'").lower()
    value = re.sub(r"[^a-z0-9 ]", "", value)
    return re.sub(r"\s+", " ", value).strip()


def load_nflverse(path: Path, position: str) -> list[dict]:
    rows = []
    with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            if raw.get("position") != position or raw.get("season_type") != "REG":
                continue
            season, week = int(raw["season"]), int(raw["week"])
            if season < 2018 or season > 2024:
                continue
            points = raw.get("fantasy_points_ppr") or raw.get("fantasy_points") or "0"
            try:
                actual = float(points)
            except ValueError:
                actual = 0.0
            rows.append({"player_id": raw["player_id"], "player_name": raw.get("player_display_name") or raw.get("player_name", ""), "position": position, "season": season, "week": week, "scoring_period": f"{season}-W{week}", "team": raw.get("recent_team", ""), "actual_points": actual})
    return sorted(rows, key=lambda row: (row["season"], row["week"], row["player_id"]))


def make_features(rows: list[dict], position: str) -> list[dict]:
    player_history: dict[str, list[float]] = {}
    team_history: dict[str, list[float]] = {}
    qb_history: dict[str, list[float]] = {}
    output = []
    for row in rows:
        player = player_history.get(row["player_id"], [])
        team = team_history.get(row["team"], [])
        qb = qb_history.get(row["team"], [])
        position_mean = 16.0 if position == "QB" else 9.5
        prior = mean(player[-6:]) if player else position_mean
        team_pace = mean(team[-8:]) if team else position_mean
        qb_quality = mean(qb[-6:]) if qb else 0.0
        row = {**row, "prior_points": prior, "team_pace": team_pace, "availability": 1.0, "qb_quality": qb_quality if position == "WR" else 0.0, "red_zone_rate": prior / max(position_mean, 1)}
        output.append(row)
        player_history.setdefault(row["player_id"], []).append(row["actual_points"])
        team_history.setdefault(row["team"], []).append(row["actual_points"])
        if position == "QB":
            qb_history.setdefault(row["team"], []).append(row["actual_points"])
    return output


def parse_projection_table(path: Path, position: str) -> list[dict]:
    parser = TableParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    for table in parser.tables:
        header_index = next((index for index, row in enumerate(table) if "Name" in row and "Pos" in row and "STD PTS" in row), None)
        if header_index is None:
            continue
        header = table[header_index]
        for row in table[header_index + 1:]:
            if len(row) <= 4 or row[1].upper() != position:
                continue
            try:
                points = float(row[4].replace(",", ""))
            except ValueError:
                continue
            yield {"name": row[0], "position": position, "team": row[3], "razzball_points": points, "source_rank": len([item for item in table[header_index + 1:] if len(item) > 1 and item[1].upper() == position])}


def parse_rankings(path: Path) -> list[dict]:
    parser = TableParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    for table in parser.tables:
        header = next((row for row in table if row[:2] == ["#", "Name"] or row[:3] == ["#", "Name", "Team"]), None)
        if header:
            result = []
            for rank, row in enumerate(table[table.index(header) + 1:], 1):
                if len(row) >= 2:
                    result.append({"name": row[0], "team": row[1], "rank": rank})
            return result
    return []


def add_external_tables(db_path: Path, sources: list[dict], current: dict[str, list[dict]], rankings: dict[str, list[dict]]) -> None:
    db = sqlite3.connect(db_path)
    db.executescript("CREATE TABLE IF NOT EXISTS source_files (url TEXT, path TEXT, sha256 TEXT, bytes TEXT, cached TEXT); CREATE TABLE IF NOT EXISTS current_razzball (name TEXT, position TEXT, team TEXT, projected_points REAL, source_rank INTEGER); CREATE TABLE IF NOT EXISTS razzball_rankings (position TEXT, name TEXT, team TEXT, rank INTEGER, source_url TEXT);")
    db.executemany("INSERT INTO source_files VALUES (?, ?, ?, ?, ?)", [(item["url"], item["path"], item["sha256"], item["bytes"], item.get("cached", "false")) for item in sources])
    for position, rows in current.items():
        db.executemany("INSERT INTO current_razzball VALUES (?, ?, ?, ?, ?)", [(row["name"], position, row["team"], row["razzball_points"], row.get("source_rank")) for row in rows])
    for position, rows in rankings.items():
        db.executemany("INSERT INTO razzball_rankings VALUES (?, ?, ?, ?, ?)", [(position, row["name"], row["team"], row["rank"], RAzzball_URLS[position]) for row in rows])
    db.commit()
    db.close()


RAzzball_URLS = RAZZBALL_RANKING_URLS


def position_run(position: str, raw: dict[str, Path], output: Path, current_rows: list[dict]) -> dict:
    actual = make_features(load_nflverse(raw["nfl"], position), position)
    train = [row for row in actual if row["season"] <= 2023]
    validation = [row for row in actual if row["season"] == 2024]
    models, residual_std = train_ensemble(train, members=30, sample_size=5000)
    predictions = [{"metamodel_mean": distribution(row, models, residual_std)[0], "standard_deviation": distribution(row, models, residual_std)[1], "p10": distribution(row, models, residual_std)[2], "p90": distribution(row, models, residual_std)[3]} for row in actual]
    train_predictions, validation_predictions = predictions[:len(train)], predictions[len(train):]
    def point_metrics(rows: list[dict], preds: list[dict], key: str, coverage: bool = False) -> dict:
        errors = [preds[i][key] - rows[i]["actual_points"] for i in range(len(rows))]
        return {"samples": len(errors), "mae": round(mean(abs(x) for x in errors), 6), "rmse": round(math.sqrt(mean(x * x for x in errors)), 6), "bias": round(mean(errors), 6), "p10_p90_coverage": round(mean(preds[i]["p10"] <= rows[i]["actual_points"] <= preds[i]["p90"] for i in range(len(rows))), 6) if coverage else None}
    # The rank page is stored as a source benchmark; its point accuracy is not
    # computed because it supplies ordinal ranks, not expected fantasy points.
    metrics_rows = []
    for split, rows, preds in [("training", train, train_predictions), ("validation", validation, validation_predictions)]:
        metrics_rows.append({"split": split, "model": "nflverse-history-bootstrap-ridge", **point_metrics(rows, preds, "metamodel_mean", True)})
        baseline_predictions = [{"metamodel_mean": row["prior_points"], "p10": 0.0, "p90": 0.0} for row in rows]
        metrics_rows.append({"split": split, "model": "prior-player-history-baseline", **point_metrics(rows, baseline_predictions, "metamodel_mean")})
    position_dir = output / position.lower()
    position_dir.mkdir(parents=True, exist_ok=True)
    (position_dir / "training_predictions.json").write_text(json.dumps(train_predictions, indent=2), encoding="utf-8")
    (position_dir / "validation_predictions.json").write_text(json.dumps(validation_predictions, indent=2), encoding="utf-8")
    (position_dir / "metrics.json").write_text(json.dumps(metrics_rows, indent=2), encoding="utf-8")
    (position_dir / "model.json").write_text(json.dumps({"position": position, "model_version": "nflverse-bootstrap-ridge-v1", "features": FEATURES, "members": len(models), "residual_standard_deviation": residual_std, "training_seasons": "2018-2023", "validation_season": "2024"}, indent=2), encoding="utf-8")
    latest_by_name: dict[str, dict] = {}
    for row in actual:
        latest_by_name[normalize_name(row["player_name"])] = row
    current_predictions = []
    for source_row in current_rows:
        history_row = latest_by_name.get(normalize_name(source_row["name"]))
        if not history_row:
            continue
        feature_row = {**history_row, "scoring_period": "2026-ROS", "actual_points": 0.0}
        center, spread, p10, p90 = distribution(feature_row, models, residual_std)
        current_predictions.append({"player_id": history_row["player_id"], "player_name": source_row["name"], "team": source_row["team"], "razzball_points": source_row["razzball_points"], "metamodel_mean": center, "standard_deviation": spread, "p10": p10, "p90": p90})
    (position_dir / "current-predictions.json").write_text(json.dumps(current_predictions, indent=2), encoding="utf-8")
    svg_benchmark(position_dir / "training-benchmark.svg", position, "training", [(metrics_rows[0]["model"], metrics_rows[0]["rmse"]), (metrics_rows[1]["model"], metrics_rows[1]["rmse"])])
    svg_benchmark(position_dir / "validation-benchmark.svg", position, "validation", [(metrics_rows[2]["model"], metrics_rows[2]["rmse"]), (metrics_rows[3]["model"], metrics_rows[3]["rmse"])])
    svg_fit(position_dir / "training-fit.svg", position, "training", train, train_predictions)
    svg_fit(position_dir / "validation-fit.svg", position, "validation", validation, validation_predictions)
    save_database(position_dir / f"{position.lower()}-metamodel.sqlite", position, train, validation, train_predictions, validation_predictions, metrics_rows, models, residual_std, "real nflverse player_stats outcomes; Razzball external tables recorded separately")
    db_path = position_dir / f"{position.lower()}-metamodel.sqlite"
    db = sqlite3.connect(db_path)
    db.execute("UPDATE metadata SET value = '2018-2023' WHERE key = 'training_seasons'")
    db.execute("CREATE TABLE IF NOT EXISTS current_metamodel_predictions (player_id TEXT, player_name TEXT, team TEXT, razzball_points REAL, mean REAL, standard_deviation REAL, p10 REAL, p90 REAL)")
    db.executemany("INSERT INTO current_metamodel_predictions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [(row["player_id"], row["player_name"], row["team"], row["razzball_points"], row["metamodel_mean"], row["standard_deviation"], row["p10"], row["p90"]) for row in current_predictions])
    db.commit(); db.close()
    return {"position": position, "training_samples": len(train), "validation_samples": len(validation), "current_predictions": len(current_predictions), "metrics": metrics_rows, "database": str(db_path)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output", default="artifacts/qb-wr-models-real")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    data_dir, output = Path(args.data_dir), Path(args.output)
    sources = [fetch_cached(NFLVERSE_URL, data_dir / "nflverse-player_stats.csv.gz", args.refresh)]
    projections_meta = fetch_cached(RAZZBALL_PROJECTIONS_URL, data_dir / "razzball-projections.html", args.refresh)
    sources.append(projections_meta)
    ranking_paths: dict[str, Path] = {}
    for position, url in RAZZBALL_RANKING_URLS.items():
        path = data_dir / f"razzball-2025-{position.lower()}-rankings.html"
        sources.append(fetch_cached(url, path, args.refresh))
        ranking_paths[position] = path
    current = {position: list(parse_projection_table(data_dir / "razzball-projections.html", position)) for position in ("QB", "WR")}
    rankings = {position: parse_rankings(path) for position, path in ranking_paths.items()}
    results = [position_run(position, {"nfl": data_dir / "nflverse-player_stats.csv.gz"}, output, current[position]) for position in ("QB", "WR")]
    for result in results:
        db = sqlite3.connect(result["database"])
        db.executescript("CREATE TABLE IF NOT EXISTS source_files (url TEXT, path TEXT, sha256 TEXT, bytes TEXT, cached TEXT); CREATE TABLE IF NOT EXISTS current_razzball (name TEXT, position TEXT, team TEXT, projected_points REAL, source_rank INTEGER); CREATE TABLE IF NOT EXISTS razzball_rankings (position TEXT, name TEXT, team TEXT, rank INTEGER, source_url TEXT);")
        db.executemany("INSERT INTO source_files VALUES (?, ?, ?, ?, ?)", [(item["url"], item["path"], item["sha256"], item["bytes"], item.get("cached", "false")) for item in sources])
        position = result["position"]
        db.executemany("INSERT INTO current_razzball VALUES (?, ?, ?, ?, ?)", [(row["name"], position, row["team"], row["razzball_points"], row.get("source_rank")) for row in current[position]])
        db.executemany("INSERT INTO razzball_rankings VALUES (?, ?, ?, ?, ?)", [(position, row["name"], row["team"], row["rank"], RAZZBALL_RANKING_URLS[position]) for row in rankings[position]])
        db.commit(); db.close()
    (output / "results.json").write_text(json.dumps({"data_status": "real nflverse outcomes and public Razzball source tables", "sources": sources, "results": results}, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

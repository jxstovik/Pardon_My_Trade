#!/usr/bin/env python3
"""Build the real-data 2024 WR preseason replay.

The script intentionally has no pandas/sklearn dependency. It downloads the
real nflverse player-stat release, resolves historical Razzball captures from
the Internet Archive, builds prior-only features, fits a regularized model on
pre-2024 rows, and evaluates the resulting 2024 preseason rankings.

Raw inputs live under data/ and are ignored by git. Re-run with --refresh to
replace a cached download and to record a new source hash.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import json
import math
import re
import sqlite3
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from statistics import mean, pstdev
from typing import Any


SEASON = 2024
PRESEASON_CUTOFF = "2024-09-04T08:00:00-04:00"
NFLVERSE_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz"
ARCHIVE_CDX_URL = "https://web.archive.org/cdx/search/cdx"
ARCHIVE_BASE = "https://web.archive.org/web"
PARSER_VERSION = "wr-replay-v1"
FEATURES = [
    "prior_points_per_game",
    "prior_targets_per_game",
    "prior_receiving_yards_per_game",
    "prior_target_share",
    "prior_team_pass_attempts",
    "prior_games",
    "prior_availability_rate",
    "experience_seasons",
]

SOURCE_PLANS = [
    {
        "name": "razzball_preseason_rankings",
        "url": "https://football.razzball.com/2024-fantasy-football-wide-receiver-rankings/",
        "kind": "rank",
    },
    {
        "name": "razzball_preseason_projections",
        "url": "https://football.razzball.com/projections-wr-restofseason/",
        "kind": "points",
    },
]


def request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "PardonMyTrade/ChatPFT research"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def save_cached(url: str, path: Path, refresh: bool) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists():
        body = request_bytes(url)
        path.write_bytes(body)
        cached = False
    else:
        body = path.read_bytes()
        cached = True
    return {
        "url": url,
        "path": str(path),
        "sha256": sha256(body),
        "bytes": len(body),
        "cached": cached,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def parse_cutoff(value: str) -> datetime:
    return datetime.fromisoformat(value)


def choose_archive_capture(url: str, cutoff: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({
        "url": url,
        "output": "json",
        "filter": ["statuscode:200"],
        "fl": "timestamp,original,statuscode,digest",
    }, doseq=True)
    try:
        raw = request_bytes(f"{ARCHIVE_CDX_URL}?{query}")
        rows = json.loads(raw.decode("utf-8"))
    except Exception as error:  # pragma: no cover - network failure is reported in the manifest
        return {"status": "unavailable", "reason": f"archive index failed: {error}"}
    if not rows or len(rows) < 2:
        return {"status": "unavailable", "reason": "no pre-cutoff capture"}
    header, values = rows[0], rows[1:]
    cutoff_key = parse_cutoff(cutoff).astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")
    candidates = [dict(zip(header, row)) for row in values if row and row[0] <= cutoff_key]
    if not candidates:
        return {"status": "unavailable", "reason": "no capture at or before cutoff"}
    selected = candidates[-1]
    original = selected["original"]
    capture_url = f"{ARCHIVE_BASE}/{selected['timestamp']}id_/{original}"
    return {
        "status": "selected",
        "timestamp": selected["timestamp"],
        "original": original,
        "capture_url": capture_url,
        "digest": selected.get("digest"),
    }


def fetch_archive_source(plan: dict[str, str], directory: Path, refresh: bool, cutoff: str = PRESEASON_CUTOFF) -> dict[str, Any]:
    metadata = choose_archive_capture(plan["url"], cutoff)
    result: dict[str, Any] = {
        "name": plan["name"],
        "requested_url": plan["url"],
        "kind": plan["kind"],
        "cutoff": cutoff,
        "parser_version": PARSER_VERSION,
    }
    if not metadata or metadata.get("status") != "selected":
        result.update(metadata or {"status": "unavailable", "reason": "no archive metadata"})
        return result
    filename = f"{plan['name']}-{metadata['timestamp']}.html"
    path = directory / filename
    try:
        saved = save_cached(metadata["capture_url"], path, refresh)
        result.update(metadata)
        result.update(saved)
        result["status"] = "downloaded"
    except Exception as error:
        result.update(metadata)
        result.update({"status": "unavailable", "reason": f"capture download failed: {error}"})
    return result


class TableParser(HTMLParser):
    """Collect text cells from HTML tables while ignoring nested markup."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self.table_depth = 0
        self.current: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self.table_depth += 1
            if self.table_depth == 1:
                self.current = []
        elif self.table_depth == 1 and tag == "tr":
            self.row = []
        elif self.table_depth == 1 and tag in ("td", "th"):
            self.cell = []

    def handle_endtag(self, tag: str) -> None:
        if self.table_depth == 1 and tag in ("td", "th") and self.cell is not None:
            if self.row is not None:
                self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif self.table_depth == 1 and tag == "tr":
            if self.current is not None and self.row:
                self.current.append(self.row)
            self.row = None
        elif tag == "table" and self.table_depth:
            if self.table_depth == 1 and self.current:
                self.tables.append(self.current)
                self.current = None
            self.table_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value).replace("\xa0", " ")).strip()


def normalize_name(value: str) -> str:
    value = clean_text(value).lower().replace("’", "'")
    value = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?$", "", value)
    return re.sub(r"[^a-z0-9]", "", value)


def normalize_team(value: str) -> str:
    return re.sub(r"[^A-Z]", "", clean_text(value).upper())[:3]


def numeric(value: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
    return float(match.group(0)) if match else None


def parse_rankings(path: Path) -> list[dict[str, Any]]:
    parser = TableParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    for table in parser.tables:
        header_index = next((i for i, row in enumerate(table) if any(clean_text(cell).lower() == "name" for cell in row) and any(cell.strip() == "#" for cell in row)), None)
        if header_index is None:
            continue
        header = [clean_text(cell).lower() for cell in table[header_index]]
        name_index = next((i for i, cell in enumerate(header) if cell == "name"), 1)
        team_index = next((i for i, cell in enumerate(header) if "team" in cell), None)
        result = []
        for sequence, row in enumerate(table[header_index + 1:], 1):
            if len(row) <= name_index:
                continue
            rank = numeric(row[0]) or float(sequence)
            name = clean_text(row[name_index])
            team = clean_text(row[team_index]) if team_index is not None and team_index < len(row) else (clean_text(row[name_index + 1]) if name_index + 1 < len(row) else "")
            if rank is None or not name or not normalize_name(name):
                continue
            result.append({"name": name, "team": normalize_team(team), "rank": int(rank)})
        if result:
            return result
    return []


def parse_points(path: Path) -> list[dict[str, Any]]:
    parser = TableParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    for table in parser.tables:
        header_index = next((i for i, row in enumerate(table) if any("name" == clean_text(cell).lower() for cell in row) and any("ppr pts" in clean_text(cell).lower() for cell in row)), None)
        if header_index is None:
            continue
        header = [clean_text(cell).lower() for cell in table[header_index]]
        name_index = next((i for i, cell in enumerate(header) if cell == "name"), 0)
        team_index = next((i for i, cell in enumerate(header) if cell == "team"), None)
        ppr_index = next((i for i, cell in enumerate(header) if "ppr pts" in cell and "ppg" not in cell), None)
        if ppr_index is None:
            continue
        result = []
        for row in table[header_index + 1:]:
            if len(row) <= max(name_index, ppr_index):
                continue
            points = numeric(row[ppr_index])
            name = clean_text(row[name_index])
            if points is None or not name:
                continue
            team = clean_text(row[team_index]) if team_index is not None and team_index < len(row) else ""
            result.append({"name": name, "team": normalize_team(team), "projected_points": points})
        if result:
            return result
    return []


def projection_page_year(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"(20\d{2})\s+Projections", text, re.IGNORECASE)
    return int(match.group(1)) if match else None


def parse_float(raw: str | None) -> float:
    if raw is None or raw == "":
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def load_nflverse(path: Path, history_start: int, season: int) -> tuple[list[dict[str, Any]], dict[tuple[int, int, str], float]]:
    rows: list[dict[str, Any]] = []
    team_pass_attempts: dict[tuple[int, int, str], float] = defaultdict(float)
    with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            raw_season = int(raw.get("season") or 0)
            week = int(raw.get("week") or 0)
            if raw_season < history_start or raw_season > season or raw.get("season_type") != "REG":
                continue
            if raw.get("position") == "QB":
                team_pass_attempts[(raw_season, week, raw.get("recent_team", ""))] += parse_float(raw.get("attempts"))
            if raw.get("position") != "WR":
                continue
            rows.append({
                "player_id": raw.get("player_id", ""),
                "player_name": raw.get("player_display_name") or raw.get("player_name", ""),
                "team": raw.get("recent_team", ""),
                "position": "WR",
                "season": raw_season,
                "week": week,
                "scoring_period": f"{raw_season}-W{week}",
                "targets": parse_float(raw.get("targets")),
                "receptions": parse_float(raw.get("receptions")),
                "receiving_yards": parse_float(raw.get("receiving_yards")),
                "receiving_tds": parse_float(raw.get("receiving_tds")),
                "carries": parse_float(raw.get("carries")),
                "rushing_yards": parse_float(raw.get("rushing_yards")),
                "rushing_tds": parse_float(raw.get("rushing_tds")),
                "target_share": parse_float(raw.get("target_share")),
                "actual_points": parse_float(raw.get("fantasy_points_ppr") or raw.get("fantasy_points")),
            })
    return sorted(rows, key=lambda row: (row["season"], row["week"], row["player_id"])), team_pass_attempts


def history_summary(history: list[dict[str, Any]], team_history: list[float], first_season: int | None, current_season: int) -> dict[str, float]:
    recent = history[-6:]
    prior_points = [row["actual_points"] for row in recent]
    prior_targets = [row["targets"] for row in recent]
    prior_yards = [row["receiving_yards"] for row in recent]
    prior_shares = [row["target_share"] for row in recent if row["target_share"] > 0]
    pass_volume = team_history[-8:]
    seasons = sorted({int(row["season"]) for row in history})
    available_rate = min(1.0, len(history[-18:]) / 18.0)
    return {
        "prior_points_per_game": mean(prior_points) if prior_points else 8.0,
        "prior_targets_per_game": mean(prior_targets) if prior_targets else 3.0,
        "prior_receiving_yards_per_game": mean(prior_yards) if prior_yards else 35.0,
        "prior_target_share": mean(prior_shares) if prior_shares else 0.08,
        "prior_team_pass_attempts": mean(pass_volume) if pass_volume else 34.0,
        "prior_games": float(len(history)),
        "prior_availability_rate": available_rate,
        "experience_seasons": float(max(0, current_season - (first_season or current_season))),
    }


def build_features(rows: list[dict[str, Any]], team_pass: dict[tuple[int, int, str], float], season: int) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]]]:
    def process(source_rows: list[dict[str, Any]], emit_rows: bool) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]]]:
        player_history: dict[str, list[dict[str, Any]]] = defaultdict(list)
        player_first_season: dict[str, int] = {}
        team_history: dict[str, list[float]] = defaultdict(list)
        output: list[dict[str, Any]] = []
        latest: dict[str, dict[str, float]] = {}
        groups: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        for source_row in source_rows:
            groups[(source_row["season"], source_row["week"])].append(source_row)
        for (row_season, row_week), group in sorted(groups.items()):
            for row in group:
                player_id = row["player_id"]
                team = row["team"]
                summary = history_summary(player_history[player_id], team_history[team], player_first_season.get(player_id), row_season)
                if emit_rows:
                    output.append({**row, **summary, "feature_cutoff": f"{row_season}-W{max(0, row_week - 1)}"})
                player_history[player_id].append(row)
                player_first_season.setdefault(player_id, row_season)
            for team in {row["team"] for row in group}:
                team_history[team].append(team_pass.get((row_season, row_week, team), 0.0))
            for row in group:
                latest[row["player_id"]] = history_summary(player_history[row["player_id"]], team_history[row["team"]], player_first_season.get(row["player_id"]), season)
        return output, latest

    output, _ = process(rows, True)
    prior_rows = [row for row in rows if row["season"] < season]
    _, preseason = process(prior_rows, False)
    # Players with no prior recorded row receive the same explicit cold-start
    # defaults used by the feature builder; no 2024 outcome is read here.
    for row in output:
        if row["season"] == season:
            preseason.setdefault(row["player_id"], {feature: row[feature] for feature in FEATURES})
    return output, preseason


def solve(matrix_values: list[list[float]], target: list[float], ridge: float = 3.0) -> list[float]:
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


class RidgeModel:
    def __init__(self, features: list[str], means: dict[str, float], scales: dict[str, float], coefficients: list[float], residual_std: float) -> None:
        self.features = features
        self.means = means
        self.scales = scales
        self.coefficients = coefficients
        self.residual_std = residual_std

    @classmethod
    def fit(cls, rows: list[dict[str, Any]]) -> "RidgeModel":
        means = {feature: mean(float(row[feature]) for row in rows) for feature in FEATURES}
        scales = {feature: max(1e-6, math.sqrt(mean((float(row[feature]) - means[feature]) ** 2 for row in rows))) for feature in FEATURES}
        values = [[1.0] + [(float(row[feature]) - means[feature]) / scales[feature] for feature in FEATURES] for row in rows]
        coefficients = solve(values, [float(row["actual_points"]) for row in rows])
        residuals = [float(row["actual_points"]) - cls._predict_values(row, coefficients, means, scales) for row in rows]
        return cls(FEATURES, means, scales, coefficients, max(2.0, pstdev(residuals)))

    @staticmethod
    def _predict_values(row: dict[str, Any], coefficients: list[float], means: dict[str, float], scales: dict[str, float]) -> float:
        vector = [1.0] + [(float(row[feature]) - means[feature]) / scales[feature] for feature in FEATURES]
        return max(0.0, sum(value * coefficient for value, coefficient in zip(vector, coefficients)))

    def predict(self, row: dict[str, Any]) -> dict[str, float]:
        mean_value = self._predict_values(row, self.coefficients, self.means, self.scales)
        spread = self.residual_std
        return {"mean": mean_value, "standard_deviation": spread, "p10": max(0.0, mean_value - 1.282 * spread), "p50": mean_value, "p90": mean_value + 1.282 * spread}

    def metadata(self) -> dict[str, Any]:
        return {"model_version": "wr-2024-preseason-hard-stats-ridge-v1", "features": self.features, "means": self.means, "scales": self.scales, "coefficients": self.coefficients, "residual_standard_deviation": self.residual_std}


def season_totals(rows: list[dict[str, Any]], season: int) -> dict[str, dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["season"] != season:
            continue
        value = totals.setdefault(row["player_id"], {"player_id": row["player_id"], "player_name": row["player_name"], "team": row["team"], "points": 0.0, "games": 0})
        value["points"] += row["actual_points"]
        value["games"] += 1
    ranked = sorted(totals.values(), key=lambda item: (-item["points"], item["player_name"]))
    for index, row in enumerate(ranked, 1):
        row["actual_rank"] = index
    return {row["player_id"]: row for row in ranked}


def source_matches(source_rows: list[dict[str, Any]], totals: dict[str, dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    by_name_team: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in totals.values():
        by_name_team[(normalize_name(row["player_name"]), normalize_team(row["team"]))].append(row)
        by_name[normalize_name(row["player_name"])].append(row)
    matched: dict[str, dict[str, Any]] = {}
    counts = {"source_rows": len(source_rows), "matched": 0, "unmatched": 0, "ambiguous": 0}
    for source in source_rows:
        candidates = by_name_team.get((normalize_name(source["name"]), normalize_team(source.get("team", ""))), [])
        if not candidates:
            candidates = by_name.get(normalize_name(source["name"]), [])
        if len(candidates) != 1:
            counts["ambiguous" if len(candidates) > 1 else "unmatched"] += 1
            continue
        matched[candidates[0]["player_id"]] = {**source, "player_id": candidates[0]["player_id"], "match_status": "matched"}
        counts["matched"] += 1
    return matched, counts


def rank_metrics(predictions: list[dict[str, Any]], rank_key: str, actual_key: str = "actual_rank", player_ids: set[str] | None = None) -> dict[str, Any]:
    rows = [row for row in predictions if row.get(rank_key) is not None and row.get(actual_key) is not None and (player_ids is None or row["player_id"] in player_ids)]
    if not rows:
        return {"samples": 0, "spearman": None, "top12_hit_rate": None, "top24_hit_rate": None, "top36_hit_rate": None, "ndcg12": None, "ndcg24": None, "ndcg36": None}
    ordered = sorted(rows, key=lambda row: row[rank_key])
    actual = sorted(rows, key=lambda row: row[actual_key])
    rank_actual = {row["player_id"]: index for index, row in enumerate(actual, 1)}
    n = len(rows)
    squared = sum((index - rank_actual[row["player_id"]]) ** 2 for index, row in enumerate(ordered, 1))
    spearman = 1 - (6 * squared / (n * (n * n - 1))) if n > 1 else None
    result: dict[str, Any] = {"samples": n, "spearman": spearman}
    for top in (12, 24, 36):
        predicted_ids = {row["player_id"] for row in ordered[:top]}
        actual_ids = {row["player_id"] for row in actual[:top]}
        result[f"top{top}_hit_rate"] = len(predicted_ids & actual_ids) / min(top, n)
        gains = [max(0.0, float(row["actual_season_points"])) for row in ordered[:top]]
        ideal = sorted((max(0.0, float(row["actual_season_points"])) for row in rows), reverse=True)[:top]
        dcg = sum(gain / math.log2(index + 2) for index, gain in enumerate(gains))
        idcg = sum(gain / math.log2(index + 2) for index, gain in enumerate(ideal)) or 1.0
        result[f"ndcg{top}"] = dcg / idcg
    return result


def point_metrics(predictions: list[dict[str, Any]], key: str) -> dict[str, Any]:
    rows = [row for row in predictions if row.get(key) is not None and row.get("actual_season_points") is not None]
    if not rows:
        return {"samples": 0, "mae": None, "rmse": None, "bias": None}
    errors = [float(row[key]) - float(row["actual_season_points"]) for row in rows]
    return {"samples": len(errors), "mae": mean(abs(error) for error in errors), "rmse": math.sqrt(mean(error * error for error in errors)), "bias": mean(errors)}


def write_svg(path: Path, metrics: list[dict[str, Any]]) -> None:
    usable = [(row["model"], float(row["rmse"])) for row in metrics if row.get("rmse") is not None]
    maximum = max((value for _, value in usable), default=1.0)
    bars = []
    for index, (label, value) in enumerate(usable):
        x = 70 + index * 180
        height = 250 * value / maximum
        bars.append(f'<rect x="{x}" y="330" width="105" height="{-height:.1f}" transform="scale(1,-1) translate(0,-660)" fill="#216b52"/><text x="{x + 52}" y="360" text-anchor="middle" font-size="12">{html.escape(label)}</text><text x="{x + 52}" y="{330 - height - 8:.1f}" text-anchor="middle" font-size="12">{value:.2f}</text>')
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="430" viewBox="0 0 1000 430"><rect width="100%" height="100%" fill="#f4f1e9"/><text x="40" y="42" font-family="Georgia" font-size="25" fill="#17221e">2024 WR preseason point benchmark</text><text x="40" y="68" font-family="Arial" font-size="13" fill="#6c746d">Lower RMSE is better; real nflverse outcomes</text><line x1="50" y1="330" x2="950" y2="330" stroke="#bdb7aa"/>{''.join(bars)}</svg>', encoding="utf-8")


def write_database(path: Path, manifest: dict[str, Any], features: list[dict[str, Any]], predictions: list[dict[str, Any]], metrics: list[dict[str, Any]], model: RidgeModel) -> None:
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE source_snapshots (name TEXT, status TEXT, requested_url TEXT, capture_url TEXT, capture_timestamp TEXT, sha256 TEXT, rows INTEGER, reason TEXT);
      CREATE TABLE features (player_id TEXT, player_name TEXT, season INTEGER, week INTEGER, feature_cutoff TEXT, actual_points REAL, prior_points_per_game REAL, prior_targets_per_game REAL, prior_receiving_yards_per_game REAL, prior_target_share REAL, prior_team_pass_attempts REAL, prior_games REAL, prior_availability_rate REAL, experience_seasons REAL, source_rank INTEGER);
      CREATE TABLE predictions (player_id TEXT, player_name TEXT, team TEXT, actual_season_points REAL, actual_rank INTEGER, hard_stats_points REAL, baseline_points REAL, source_points REAL, source_rank INTEGER, hard_stats_rank INTEGER, source_rank_blend_rank INTEGER);
      CREATE TABLE metrics (model TEXT, metric TEXT, value REAL, samples INTEGER);
      CREATE TABLE coefficients (feature TEXT PRIMARY KEY, value REAL);
    """)
    metadata = {
        "schema_version": "1.0.0",
        "parser_version": PARSER_VERSION,
        "season": str(SEASON),
        "preseason_cutoff": PRESEASON_CUTOFF,
        "training_window": "2018-2023",
        "data_status": "real nflverse player_stats outcomes; archive-first Razzball sources",
        "model": json.dumps(model.metadata(), sort_keys=True),
    }
    db.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    db.executemany("INSERT INTO source_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        (row.get("name"), row.get("status"), row.get("requested_url"), row.get("capture_url"), row.get("timestamp"), row.get("sha256"), row.get("parsed_rows", 0), row.get("reason")) for row in manifest["sources"]
    ])
    db.executemany("INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        (row["player_id"], row["player_name"], row["season"], row["week"], row["feature_cutoff"], row["actual_points"], *(row[feature] for feature in FEATURES), row.get("source_rank")) for row in features
    ])
    db.executemany("INSERT INTO predictions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        (row.get("player_id"), row.get("player_name"), row.get("team"), row.get("actual_season_points"), row.get("actual_rank"), row.get("hard_stats_points"), row.get("baseline_points"), row.get("source_points"), row.get("source_rank"), row.get("hard_stats_rank"), row.get("source_rank_blend_rank")) for row in predictions
    ])
    db.executemany("INSERT INTO metrics VALUES (?, ?, ?, ?)", [(row["model"], key, value, row.get("samples", 0)) for row in metrics for key, value in row.items() if key not in ("model", "samples") and isinstance(value, (int, float))])
    db.executemany("INSERT INTO coefficients VALUES (?, ?)", [(feature, value) for feature, value in zip(["intercept"] + FEATURES, model.coefficients)])
    db.commit()
    db.close()


def build_report(path: Path, manifest: dict[str, Any], metrics: list[dict[str, Any]], model: RidgeModel, counts: dict[str, Any]) -> None:
    lines = [
        "# ChatPFT 2024 WR Preseason Replay",
        "",
        "This report uses real nflverse regular-season player statistics and archive-first Razzball snapshots.",
        "",
        "## Run",
        "",
        f"- Preseason cutoff: `{PRESEASON_CUTOFF}`",
        f"- Training rows: `{counts['training_rows']}` real player-weeks from 2018-2023",
        f"- 2024 outcome rows: `{counts['validation_rows']}` real player-weeks",
        f"- 2024 players with recorded outcomes: `{counts['players_2024']}`",
        f"- Feature rows with prior-only construction: `{counts['feature_rows']}`",
        "",
        "## Sources",
        "",
    ]
    for source in manifest["sources"]:
        lines.append(f"- `{source['name']}`: **{source['status']}**, parsed rows `{source.get('parsed_rows', 0)}`; {source.get('reason', source.get('capture_url', ''))}".rstrip())
    lines.extend(["", "## Model", "", f"- Version: `{model.metadata()['model_version']}`", f"- Features: `{', '.join(FEATURES)}`", f"- Residual standard deviation: `{model.residual_std:.3f}`", "", "## Metrics", "", "Point metrics use season projections; rank metrics use the common matched Razzball ranking universe.", "", "| Model | Point samples | Rank samples | MAE | RMSE | Bias | Spearman | Top 12 hit | NDCG 12 |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
    for row in metrics:
        lines.append(f"| {row['model']} | {row.get('samples', 0)} | {row.get('rank_samples', 0)} | {format_metric(row.get('mae'))} | {format_metric(row.get('rmse'))} | {format_metric(row.get('bias'))} | {format_metric(row.get('spearman'))} | {format_metric(row.get('top12_hit_rate'))} | {format_metric(row.get('ndcg12'))} |")
    lines.extend(["", "## Interpretation", "", "The hard-stat model is trained only on information available before 2024. Razzball ordinal rankings are evaluated as rankings, not converted into fabricated point predictions. A missing archived projection is a source-availability result, not a zero projection.", "", "## Limitations", "", "- Weekly Razzball, ESPN, FFToday, and timestamped news are reserved for the walk-forward replay in phases 5-6.", "- The first real feature table uses player_stats opportunity fields and team quarterback attempts; snap-count and route-level sources are future additions.", "- This is a preseason benchmark against final 2024 outcomes, not yet the week-by-week model evolution."])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def format_metric(value: Any) -> str:
    return "-" if value is None else f"{float(value):.3f}"


def run(args: argparse.Namespace) -> dict[str, Any]:
    data_dir = Path(args.data_dir)
    output = Path(args.output)
    snapshots = data_dir / "chatpft-wr-replay" / "source-snapshots"
    data_dir.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    nfl_path = data_dir / "nflverse-player_stats.csv.gz"
    nfl_meta = save_cached(NFLVERSE_URL, nfl_path, args.refresh)
    nfl_meta["name"] = "nflverse_player_stats"
    nfl_meta["status"] = "downloaded"
    nfl_meta["parsed_rows"] = 0
    source_manifest = [nfl_meta]
    source_rows: dict[str, list[dict[str, Any]]] = {}
    for plan in SOURCE_PLANS:
        source = fetch_archive_source(plan, snapshots, args.refresh)
        if source.get("status") == "downloaded":
            path = Path(source["path"])
            horizon = projection_page_year(path) if plan["kind"] == "points" else None
            parsed = parse_rankings(path) if plan["kind"] == "rank" else parse_points(path)
            if plan["kind"] == "points" and horizon != SEASON:
                source["status"] = "unavailable"
                source["reason"] = f"capture reports {horizon or 'unknown'} projection horizon, expected {SEASON}"
                parsed = []
            source["parsed_rows"] = len(parsed)
            source_rows[plan["kind"]] = parsed
        else:
            source["parsed_rows"] = 0
            source_rows[plan["kind"]] = []
        source_manifest.append(source)
    rows, team_pass = load_nflverse(nfl_path, args.history_start, SEASON)
    nfl_meta["parsed_rows"] = len(rows)
    features, preseason_features = build_features(rows, team_pass, SEASON)
    train = [row for row in features if row["season"] < SEASON]
    validation = [row for row in features if row["season"] == SEASON]
    model = RidgeModel.fit(train)
    totals = season_totals(rows, SEASON)
    rank_source, rank_counts = source_matches(source_rows.get("rank", []), totals)
    point_source, point_counts = source_matches(source_rows.get("points", []), totals)
    for feature_row in features:
        if feature_row["season"] == SEASON:
            feature_row["source_rank"] = rank_source.get(feature_row["player_id"], {}).get("rank")
    predictions: list[dict[str, Any]] = []
    for player_id, actual in totals.items():
        feature = preseason_features.get(player_id, history_summary([], [], None, SEASON))
        hard_week = model.predict(feature)
        expected_games = min(17.0, max(1.0, feature["prior_availability_rate"] * 17.0))
        hard_points = hard_week["mean"] * expected_games
        baseline_points = feature["prior_points_per_game"] * expected_games
        source_rank = rank_source.get(player_id, {}).get("rank")
        source_points = point_source.get(player_id, {}).get("projected_points")
        predictions.append({
            "player_id": player_id,
            "player_name": actual["player_name"],
            "team": actual["team"],
            "actual_season_points": actual["points"],
            "actual_rank": actual["actual_rank"],
            "hard_stats_points": hard_points,
            "hard_stats_p10": hard_week["p10"] * expected_games,
            "hard_stats_p90": hard_week["p90"] * expected_games,
            "baseline_points": baseline_points,
            "source_points": source_points,
            "source_rank": source_rank,
            "expected_games": expected_games,
        })
    for key in ("hard_stats_points", "baseline_points", "source_points"):
        ranked = sorted((row for row in predictions if row.get(key) is not None), key=lambda row: (-float(row[key]), row["player_name"]))
        for rank, row in enumerate(ranked, 1):
            row[f"{key}_rank"] = rank
    hard_ranked = sorted(predictions, key=lambda row: (-float(row["hard_stats_points"]), row["player_name"]))
    source_ranked = sorted((row for row in predictions if row.get("source_rank") is not None), key=lambda row: row["source_rank"])
    hard_score = {row["player_id"]: 1 - index / max(1, len(hard_ranked) - 1) for index, row in enumerate(hard_ranked)}
    source_score = {row["player_id"]: 1 - index / max(1, len(source_ranked) - 1) for index, row in enumerate(source_ranked)}
    blend = sorted((row for row in predictions if row["player_id"] in source_score), key=lambda row: -(hard_score[row["player_id"]] + source_score[row["player_id"]]))
    for rank, row in enumerate(blend, 1):
        row["source_rank_blend_rank"] = rank
    metrics = []
    common_rank_players = set(rank_source)
    for model_name, point_key, rank_key in [("hard_stats", "hard_stats_points", "hard_stats_points_rank"), ("prior_baseline", "baseline_points", "baseline_points_rank"), ("razzball_rank", "source_points", "source_points_rank")]:
        point = point_metrics(predictions, point_key)
        rank = rank_metrics(predictions, "source_rank" if model_name == "razzball_rank" else rank_key, player_ids=common_rank_players or None)
        metrics.append({"model": model_name, **point, "rank_samples": rank.pop("samples", 0), **rank})
    blend_metrics = rank_metrics(predictions, "source_rank_blend_rank")
    metrics.append({"model": "source_rank_blend", "samples": 0, "rank_samples": blend_metrics.pop("samples", 0), **blend_metrics})
    manifest = {
        "schema_version": "1.0.0",
        "parser_version": PARSER_VERSION,
        "season": SEASON,
        "preseason_cutoff": PRESEASON_CUTOFF,
        "training_window": f"{args.history_start}-{SEASON - 1}",
        "data_status": "real nflverse outcomes and archive-first Razzball source snapshots",
        "sources": source_manifest,
        "matching": {"rank": rank_counts, "points": point_counts},
        "row_counts": {"features": len(features), "training": len(train), "validation": len(validation), "players_2024": len(totals)},
        "model": model.metadata(),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with (output / "features.jsonl").open("w", encoding="utf-8") as handle:
        for row in features:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    (output / "preseason_predictions.json").write_text(json.dumps(predictions, indent=2), encoding="utf-8")
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (output / "model.json").write_text(json.dumps(model.metadata(), indent=2), encoding="utf-8")
    write_svg(output / "rank-benchmark.svg", [row for row in metrics if row.get("rmse") is not None])
    build_report(output / "report.md", manifest, metrics, model, {"training_rows": len(train), "validation_rows": len(validation), "players_2024": len(totals), "feature_rows": len(features)})
    write_database(output / "wr-metamodel.sqlite", manifest, features, predictions, metrics, model)
    result = {"output": str(output), "manifest": manifest, "metrics": metrics}
    (output / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output", default="artifacts/wr-2024-replay")
    parser.add_argument("--history-start", type=int, default=2018)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    result = run(args)
    print(json.dumps({"output": result["output"], "metrics": result["metrics"], "matching": result["manifest"]["matching"]}, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""GET-refreshed NFLverse schedule/stats identities for the automatic training gate."""
import csv
import hashlib
import json
import math
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
week = int(sys.argv[1])
if not 2 <= week <= 18:
    raise ValueError('No completed regular-season training horizon')
games_path = root/'data/nflverse/games.csv'
stats_path = root/'data/nflverse/stats_player_week_2026.csv'
games = [g for g in csv.DictReader(games_path.open()) if g['season'] == '2026' and g['game_type'] == 'REG' and int(g['week']) < week]
def completed(game):
    try:
        return all(math.isfinite(float(game[key])) and float(game[key]) >= 0 for key in ['home_score', 'away_score'])
    except (ValueError, TypeError):
        return False
if not games or max(int(g['week']) for g in games) != week - 1 or not all(completed(g) for g in games):
    raise ValueError('Last published games are not all completed')
stats = [s for s in csv.DictReader(stats_path.open()) if s['season'] == '2026' and int(s['week']) < week]
observed = {s['game_id'] for s in stats}
ids = sorted(g['game_id'] for g in games)
if len(set(ids)) != len(ids) or not set(ids).issubset(observed):
    raise ValueError('Latest outcomes not yet available in training feed')
print(json.dumps({'gameIds': ids, 'sourceSha256': {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in [('stats', stats_path), ('games', games_path)]}}))

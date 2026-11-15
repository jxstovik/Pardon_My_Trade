"""League-scored canonical D/ST targets; raw ESPN counts are rescored independently."""
import math

def score_espn_stats(stats, scoring_items, position_id=16):
    total = 0.0
    for item in scoring_items:
        count = float(stats.get(str(item['statId']), 0))
        points = float(item.get('pointsOverrides', {}).get(str(position_id), item.get('points', 0)))
        if not math.isfinite(count) or not math.isfinite(points):
            raise ValueError('Non-finite scoring component')
        total += count * points
    return total

def canonical_targets(live):
    targets = {}
    for row in live['leagueActuals']:
        if not row['name'].endswith(' D/ST') or not row.get('rawStats'):
            continue
        score = score_espn_stats(row['rawStats'], live['scoring']['scoringItems'])
        if abs(score-float(row['actual'])) > 1e-6:
            raise ValueError(f"ESPN component scoring mismatch: {row['name']} W{row['week']}")
        key = (int(live['season']), int(row['week']), row['name'])
        if key in targets and targets[key]['points'] != score:
            raise ValueError('Ambiguous D/ST canonical target')
        targets[key] = {'points':score, 'stats':row['rawStats']}
    return targets

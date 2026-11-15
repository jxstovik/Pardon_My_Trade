"""Frozen-outcome, schedule-aware scenario estimates; no future outcomes or retraining.

These are season planning estimates, not validated long-horizon confidence intervals.
Current Q/D/O/IR players cannot be automatic acquisitions or drops. Their unchanged
health designation is carried conservatively through this scenario horizon.
"""
import pandas as pd
import numpy as np

QUANTILES = [5, 10, 25, 50, 75, 90, 95]
QUANTILE_WEIGHTS = np.array([.075, .10, .20, .25, .20, .10, .075])


def forecast_horizon(forecasts, games, off_latest, dst_latest, off_history, dst_history,
                     off_models, dst_models, offense_features, defense_features, target_week, cutoff_week):
    schedule = games[(games.season == 2026) & (games.game_type == 'REG') & (games.week >= target_week) & (games.week <= 18)]
    opponents = {}
    for row in schedule.itertuples():
        for team, other in [(row.home_team, row.away_team), (row.away_team, row.home_team)]:
            key = (int(row.week), team)
            if key in opponents:
                raise ValueError('Duplicate future team game')
            opponents[key] = other
    if any((off_history.season == 2026) & (off_history.week > cutoff_week)) or any((dst_history.season == 2026) & (dst_history.week > cutoff_week)):
        raise ValueError('Future outcomes in season horizon context')
    # Same completed as-of form for every future week; only published schedule,
    # week number and opponent context vary. No imagined opportunity updates.
    outputs, batches = [], {}
    for f in forecasts:
        out = {'playerId': str(f['espnId']), 'position': f['position'], 'team': f.get('team'), 'weeks': []}
        outputs.append(out)
        for week in range(target_week, 19):
            point = {'week': week, 'mean': 0.0, 'playing': False, 'quantiles': {str(q): 0.0 for q in QUANTILES}}
            out['weeks'].append(point)
            opponent = opponents.get((week, f.get('team')))
            if opponent is None or f.get('statisticalForecast') is False or f.get('status') not in ['—', 'Q']:
                continue
            point['playing'] = True
            pos = f['position']
            if pos == 'DST':
                rows = dst_history[(dst_history.season == 2026) & (dst_history.team == f['team'])].sort_values('week')
                if rows.empty: raise ValueError('Missing D/ST horizon identity')
                row = rows.iloc[-1].copy()
                row['games_prev'] = len(rows)
                for target, column in [('points', 'points'), ('sacks', 'def_sacks'), ('yards_allowed', 'yards_allowed')]:
                    row['prev_'+target] = float(rows[column].iloc[-1])
                    row['roll4_'+target] = float(rows[column].tail(4).mean())
                row['season_points_avg'] = float(rows.points.mean())
                row['prev_takeaways'] = float((rows.def_interceptions+rows.def_fumbles).iloc[-1])
                row['roll4_takeaways'] = float((rows.def_interceptions+rows.def_fumbles).tail(4).mean())
                row['roll4_pa'] = float(rows.points_allowed.tail(4).mean())
                row['season_pa'] = float(rows.points_allowed.mean())
                row['season_yards_allowed'] = float(rows.yards_allowed.mean())
                history = dst_history[(dst_history.season == 2026) & (dst_history.team == opponent)].sort_values('week')
                if history.empty: raise ValueError('Missing D/ST opponent horizon context')
                row['opp_roll4_points'] = float(history.opponent_points.tail(4).mean())
                row['opp_season_points'] = float(history.opponent_points.mean())
                features = defense_features
            else:
                rows = off_latest[off_latest.player_id == f['player']]
                if rows.empty: raise ValueError('Missing offensive horizon identity')
                row = rows.iloc[-1].copy()
                allowed = off_history[(off_history.season == 2026) & (off_history.opponent_team == opponent) & (off_history.position == pos)]
                by_week = allowed.groupby('week').points.sum().sort_index()
                if by_week.empty: raise ValueError('Missing offensive opponent horizon context')
                row['opp_allow_roll4'] = float(by_week.tail(4).mean())
                row['opp_allow_season'] = float(by_week.mean())
                features = offense_features
            row['week'] = week
            row['season'] = 2026
            vector = {c: float(pd.to_numeric(pd.Series([row[c]]), errors='coerce').fillna(0).iloc[0]) for c in features}
            batches.setdefault(pos, []).append((vector, point, .5 if f.get('status') == 'Q' else 1.0))
    for pos, items in batches.items():
        pack = dst_models if pos == 'DST' else off_models[pos]
        frame = pd.DataFrame([i[0] for i in items]).replace([np.inf, -np.inf], np.nan).fillna(0)
        predictions = pack['final_mean'].predict(frame)
        quantiles = np.maximum.accumulate(np.column_stack([pack[f'final_q{q:02d}'].predict(frame) for q in QUANTILES]), axis=1)
        quantiles += (predictions - quantiles.dot(QUANTILE_WEIGHTS))[:, None]
        for (_, point, health_factor), mean, qs in zip(items, predictions, quantiles):
            if not np.isfinite(mean) or not np.isfinite(qs).all(): raise ValueError('Nonfinite horizon estimate')
            point['mean'] = float(mean) * health_factor
            point['quantiles'] = {str(q): float(v)*health_factor for q, v in zip(QUANTILES, qs)}
    handcuffs, correlations = roster_relationships(forecasts, games, off_latest, off_history, opponents, target_week, cutoff_week)
    return {'schemaVersion': 2, 'season': 2026, 'targetWeek': target_week, 'cutoffWeek': cutoff_week,
            'method': 'frozen_completed_outcome_models_with_published_schedule_and_opponent_context',
            'limitations': ['Unvalidated season scenario estimates; no future outcome inputs',
                           'Current health carried forward conservatively; Q values halved as a planning haircut, not a calibrated active probability',
                           'Empirical backfield-absence frequencies and conditional scores are scenarios, not calibrated future injury probabilities',
                           'QB-WR residual correlations require paired completed games; no same-team points bonus',
                           'No unobserved role changes or future injury recovery'], 'players': outputs, 'handcuffs': handcuffs, 'correlations': correlations}


def roster_relationships(forecasts, games, latest, history, opponents, target_week, cutoff_week):
    """Use only completed observed roles; same NFL team alone supplies no numerical bonus."""
    required = {'season', 'week', 'game_id', 'player_id', 'team', 'position', 'points', 'touches', 'season_points_avg'}
    if not required.issubset(history.columns):
        return [], []
    current = history[(history.season == 2026) & (history.week <= cutoff_week)].copy()
    current['residual'] = current.points - pd.to_numeric(current.season_points_avg, errors='coerce')
    schedules = games[(games.season == 2026) & (games.game_type == 'REG') & (games.week <= cutoff_week)]
    handcuffs, correlations = [], []
    owned = [f for f in forecasts if str(f.get('teamId')) == '7']
    for leader in [f for f in owned if f['position'] == 'RB' and f.get('player')]:
        leader_rows = current[(current.player_id == leader['player']) & (current.team == leader['team'])].sort_values('week')
        if leader_rows.empty: continue
        for backup in [f for f in forecasts if f.get('available') and f['position'] == 'RB' and f.get('team') == leader['team'] and f.get('player')]:
            backup_rows = current[(current.player_id == backup['player']) & (current.team == leader['team'])].sort_values('week')
            if backup_rows.empty or leader_rows.touches.tail(4).mean() <= backup_rows.touches.tail(4).mean(): continue
            # Do not treat weeks before either player was first observed on this team as absences.
            first_week = max(int(leader_rows.week.min()), int(backup_rows.week.min()))
            eligible_games = schedules[(schedules.week >= first_week) & ((schedules.home_team == leader['team']) | (schedules.away_team == leader['team']))]
            played = set(leader_rows[leader_rows.touches > 0].game_id)
            absent_ids = set(eligible_games.game_id) - played
            conditional = backup_rows[backup_rows.game_id.isin(absent_ids) & (backup_rows.touches > 0)]
            n, denominator = int(conditional.game_id.nunique()), len(eligible_games)
            if n < 2 or n >= denominator: continue
            points = conditional.points.to_numpy(dtype=float)
            if not np.isfinite(points).all(): continue
            qs = np.quantile(points, np.array(QUANTILES)/100)
            mean = float(np.dot(qs, QUANTILE_WEIGHTS))
            handcuffs.append({'leaderPlayerId': str(leader['espnId']), 'backupPlayerId': str(backup['espnId']),
                             'probability': n/denominator, 'sampleGames': denominator, 'absentGames': n,
                             'gameIds': sorted(conditional.game_id.astype(str).unique()),
                             'evidence': 'Completed same-team games with no lead-back touches and observed backup touches; not a predicted injury rate',
                             'conditionalWeeks': [{'week': w, 'playing': (w, backup['team']) in opponents, 'mean': mean if (w, backup['team']) in opponents else 0.,
                                 'quantiles': {str(q): float(v) if (w, backup['team']) in opponents else 0. for q, v in zip(QUANTILES, qs)}} for w in range(target_week, 19)]})
    for qb in [f for f in forecasts if f['position'] == 'QB' and f.get('player')]:
        a = current[(current.player_id == qb['player']) & (current.team == qb['team'])][['game_id', 'residual']].dropna()
        for wr in [f for f in forecasts if f['position'] == 'WR' and f.get('player') and f.get('team') == qb.get('team')]:
            b = current[(current.player_id == wr['player']) & (current.team == wr['team'])][['game_id', 'residual']].dropna()
            paired = a.merge(b, on='game_id', validate='one_to_one')
            if len(paired) < 4 or paired.residual_x.std() == 0 or paired.residual_y.std() == 0: continue
            rho = float(paired.residual_x.corr(paired.residual_y))
            if np.isfinite(rho): correlations.append({'qbPlayerId': str(qb['espnId']), 'receiverPlayerId': str(wr['espnId']),
                'rho': float(np.clip(rho, -.95, .95)), 'sampleGames': len(paired), 'gameIds': sorted(paired.game_id.astype(str)),
                'method': 'same-team completed-game residuals versus pregame season-average baseline; exploratory covariance, not calibrated'})
    return handcuffs, correlations

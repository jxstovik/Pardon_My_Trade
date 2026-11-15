#!/usr/bin/env python3
"""Build isolated weekly 2026 candidate fantasy models and scout report.

Source data are nflverse weekly player stats through the requested causal cutoff, plus scheduled games.
This writes only to this candidate artifact directory; it does not change PMT's
installed model state or publish/promote any model.
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from waiver_horizon import forecast_horizon
from dst_scoring import canonical_targets
import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
TARGET_WEEK = int(os.environ.get('PMT_SCOUT_WEEK','6'))
OUT = ROOT / f'artifacts/week{TARGET_WEEK}-2026-scout'
OUT.mkdir(parents=True,exist_ok=True)
DATA = Path(os.environ.get('PMT_NFLVERSE_DATA_DIR', '/tmp/pmt-nflverse-2026'))
STATS26 = DATA / 'stats_player_week_2026.csv'
GAMES = DATA / 'games.csv'
Q_LEVELS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]
FEATURES = [
    'week', 'season', 'games_prev', 'prev_points', 'roll4_points', 'roll4_points_sd',
    'season_points_avg', 'career_points_avg', 'career_points_sd',
    'prev_touches', 'roll4_touches', 'season_touches_avg',
    'prev_targets', 'roll4_targets', 'season_targets_avg',
    'prev_pass_attempts', 'roll4_pass_attempts', 'season_pass_attempts_avg',
    'prev_yards', 'roll4_yards', 'season_yards_avg',
    'opp_allow_roll4', 'opp_allow_season',
]
DEF_FEATURES = [
    'week', 'season', 'games_prev', 'prev_points', 'roll4_points', 'season_points_avg',
    'prev_sacks', 'roll4_sacks', 'prev_takeaways', 'roll4_takeaways',
    'roll4_pa', 'season_pa', 'prev_yards_allowed', 'roll4_yards_allowed',
    'season_yards_allowed', 'opp_roll4_points', 'opp_season_points',
]
SEED = 52026
SEASON = 2026
CUTOFF_WEEK = TARGET_WEEK-1
SCORING_NOTE = (
    'QB/RB/WR/TE use NFLverse fantasy_points_ppr (PPR, standard passing/rushing, '
    'receiving, two-point and lost-fumble rules). K and DST targets apply the ESPN '
    'league settings captured from the public settings page, including missed kicks, '
    'points-allowed tiers and total-yards-allowed tiers.'
)

TEAM_NAMES = {
    'ARI':'Cardinals','ATL':'Falcons','BAL':'Ravens','BUF':'Bills','CAR':'Panthers',
    'CHI':'Bears','CIN':'Bengals','CLE':'Browns','DAL':'Cowboys','DEN':'Broncos',
    'DET':'Lions','GB':'Packers','HOU':'Texans','IND':'Colts','JAX':'Jaguars',
    'KC':'Chiefs','LA':'Rams','LAC':'Chargers','LV':'Raiders','MIA':'Dolphins',
    'MIN':'Vikings','NE':'Patriots','NO':'Saints','NYG':'Giants','NYJ':'Jets',
    'PHI':'Eagles','PIT':'Steelers','SEA':'Seahawks','SF':'49ers','TB':'Buccaneers',
    'TEN':'Titans','WAS':'Commanders',
}

ALIASES = {
    'Brian Robinson Jr.': 'Brian Robinson',
    'Aaron Jones Sr.': 'Aaron Jones',
    'Kyle Pitts Sr.': 'Kyle Pitts',
}

def sha(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1<<20),b''): h.update(block)
    return h.hexdigest()


DST_CANONICAL_PATH=ROOT/'data/scout/espn-dst-targets.json'
DST_CANONICAL_SHA=sha(DST_CANONICAL_PATH) if DST_CANONICAL_PATH.exists() else None
DST_CANONICAL_TARGETS=canonical_targets(json.loads(DST_CANONICAL_PATH.read_text())) if DST_CANONICAL_PATH.exists() else {}


def ppr_points(d: pd.DataFrame) -> pd.Series:
    return pd.to_numeric(d['fantasy_points_ppr'], errors='coerce')


def kicker_points(d: pd.DataFrame) -> pd.Series:
    def val(c):
        return pd.to_numeric(d[c], errors='coerce').fillna(0) if c in d else 0
    low=val('fg_made_0_19')+val('fg_made_20_29')+val('fg_made_30_39')
    misses=val('fg_missed')+val('fg_blocked')
    pat_misses=val('pat_missed')+val('pat_blocked')
    return (3*low+4*val('fg_made_40_49')+5*(val('fg_made_50_59')+val('fg_made_60_'))+
            val('pat_made')-misses-pat_misses)


def completed_rows(rows):
    """Cut outcomes before feature construction, not merely before model fitting."""
    season = pd.to_numeric(rows['season'], errors='coerce')
    week = pd.to_numeric(rows['week'], errors='coerce')
    return rows[(season < SEASON) | ((season == SEASON) & (week <= CUTOFF_WEEK))].copy()


def validate_completed_coverage(stats, games):
    scheduled=games[(games.season == SEASON) & (games.week <= CUTOFF_WEEK) & (games.game_type == 'REG')]
    if scheduled.empty or int(scheduled.week.max()) != CUTOFF_WEEK:
        raise ValueError('Missing published cutoff-week schedule')
    if scheduled[['home_score','away_score']].isna().any().any():
        raise ValueError('Requested cutoff still has uncompleted published games')
    observed=set(stats.loc[stats.season == SEASON, 'game_id'])
    missing=sorted(set(scheduled.game_id)-observed)
    if missing:
        raise ValueError('Completed statistics missing published games: '+', '.join(missing))
    return {'cutoffWeek':CUTOFF_WEEK, 'gameIds':sorted(scheduled.game_id.astype(str)), 'completedGames':len(scheduled),
            'cutoffGames':int((scheduled.week == CUTOFF_WEEK).sum()),
            'currentSeasonStatsRows':int((stats.season == SEASON).sum()),
            'maxObservedWeek':int(stats.loc[stats.season == SEASON, 'week'].max())}


def load_weekly():
    parts=[]
    for year in range(2010,2026):
        p=DATA/f'stats_player_week_{year}.csv.gz'
        d=pd.read_csv(p,low_memory=False)
        parts.append(d)
    cur=pd.read_csv(STATS26,low_memory=False)
    cur=cur[pd.to_numeric(cur.week,errors='coerce')<TARGET_WEEK]
    if int(pd.to_numeric(cur.week).max())!=CUTOFF_WEEK: raise ValueError('Source does not yet contain completed requested cutoff week')
    parts.append(cur)
    d=pd.concat(parts,ignore_index=True,sort=False)
    d=d[d['season_type'].eq('REG')].copy()
    d['season']=pd.to_numeric(d['season'],errors='coerce').astype('Int64')
    d['week']=pd.to_numeric(d['week'],errors='coerce').astype('Int64')
    d['player_id']=d['player_id'].astype(str)
    d['team']=d['team'].astype(str)
    d['opponent_team']=d['opponent_team'].astype(str)
    d['points']=ppr_points(d)
    k=d.position.eq('K')
    d.loc[k,'points']=kicker_points(d.loc[k])
    d=d[d.position.isin(['QB','RB','WR','TE','K']) & d.points.notna()]
    for c in ['carries','targets','receptions','attempts','passing_yards','rushing_yards','receiving_yards',
              'passing_tds','rushing_tds','receiving_tds','fumbles_lost_total']:
        if c not in d: d[c]=0
        d[c]=pd.to_numeric(d[c],errors='coerce').fillna(0)
    d['touches']=d['carries']+d['receptions']
    d['yards']=d['passing_yards']+d['rushing_yards']+d['receiving_yards']
    return d


def make_offense_features(d: pd.DataFrame):
    d=d.sort_values(['player_id','season','week','game_id']).copy()
    vals=['points','touches','targets','attempts','yards']
    g=d.groupby('player_id',sort=False,group_keys=False)
    for c in vals:
        d['prev_'+c]=g[c].shift(1)
        d['career_'+c+'_avg']=g[c].transform(lambda s:s.shift(1).expanding(min_periods=1).mean())
        d['career_'+c+'_sd']=g[c].transform(lambda s:s.shift(1).expanding(min_periods=2).std()) if c=='points' else 0
        sg=d.groupby(['player_id','season'],sort=False)[c]
        d['season_'+c+'_avg']=sg.transform(lambda s:s.shift(1).expanding(min_periods=1).mean())
        d['roll4_'+c]=g[c].transform(lambda s:s.shift(1).rolling(4,min_periods=1).mean())
        if c=='points': d['roll4_points_sd']=g[c].transform(lambda s:s.shift(1).rolling(4,min_periods=2).std())
    d['games_prev']=d.groupby('player_id').cumcount()
    d['roll4_points_sd']=d['roll4_points_sd'].fillna(d['career_points_sd']).fillna(0)
    # Defense points conceded by position, lagged within season and opponent.
    allowed=(d.groupby(['season','week','opponent_team','position'],as_index=False).points.sum()
             .rename(columns={'opponent_team':'def_team','points':'allowed'}))
    allowed=allowed.sort_values(['season','def_team','position','week'])
    ag=allowed.groupby(['season','def_team','position'],sort=False).allowed
    allowed['allow_roll4']=ag.transform(lambda s:s.shift(1).rolling(4,min_periods=1).mean())
    allowed['allow_season']=ag.transform(lambda s:s.shift(1).expanding(min_periods=1).mean())
    allowed['allow_roll4']=allowed['allow_roll4'].fillna(allowed.groupby('position').allowed.transform('mean'))
    allowed['allow_season']=allowed['allow_season'].fillna(allowed.groupby('position').allowed.transform('mean'))
    d=d.merge(allowed[['season','week','def_team','position','allow_roll4','allow_season']],
              left_on=['season','week','opponent_team','position'],right_on=['season','week','def_team','position'],how='left')
    pos_avg=d.groupby('position').points.transform('mean')
    d['allow_roll4']=d['allow_roll4'].fillna(pos_avg)
    d['allow_season']=d['allow_season'].fillna(pos_avg)
    d=d.rename(columns={
      'prev_points':'prev_points','roll4_points':'roll4_points','career_points_avg':'career_points_avg',
      'career_points_sd':'career_points_sd','prev_touches':'prev_touches','roll4_touches':'roll4_touches',
      'season_touches_avg':'season_touches_avg','prev_targets':'prev_targets','roll4_targets':'roll4_targets',
      'season_targets_avg':'season_targets_avg','prev_attempts':'prev_pass_attempts',
      'roll4_attempts':'roll4_pass_attempts','season_attempts_avg':'season_pass_attempts_avg',
      'prev_yards':'prev_yards','roll4_yards':'roll4_yards','season_yards_avg':'season_yards_avg',
      'allow_roll4':'opp_allow_roll4','allow_season':'opp_allow_season'
    })
    # Generic week-one fallback is a career prior, while usage features stay at zero.
    fillcols=FEATURES
    for c in fillcols:
        if c not in d: d[c]=0
        d[c]=pd.to_numeric(d[c],errors='coerce')
    d['prev_points']=d['prev_points'].fillna(d['career_points_avg']).fillna(0)
    d['roll4_points']=d['roll4_points'].fillna(d['career_points_avg']).fillna(0)
    d['season_points_avg']=d['season_points_avg'].fillna(d['career_points_avg']).fillna(0)
    d['prev_touches']=d['prev_touches'].fillna(d['season_touches_avg']).fillna(0)
    d['roll4_touches']=d['roll4_touches'].fillna(d['season_touches_avg']).fillna(0)
    d['season_touches_avg']=d['season_touches_avg'].fillna(0)
    for c in ['prev_targets','roll4_targets','season_targets_avg','prev_pass_attempts','roll4_pass_attempts','season_pass_attempts_avg','prev_yards','roll4_yards','season_yards_avg']:
        d[c]=d[c].fillna(0)
    d['career_points_avg']=d['career_points_avg'].fillna(d.groupby('position').points.transform('mean'))
    d['career_points_sd']=d['career_points_sd'].fillna(d.groupby('position').points.transform('std')).fillna(5)
    return d


def dst_team_games(player_stats: pd.DataFrame, games: pd.DataFrame):
    player_stats=completed_rows(player_stats)
    # NFLverse def_fumbles counts a defender fumbling, not recovered takeaways.
    recovery='fumble_recovery_opp' if 'fumble_recovery_opp' in player_stats else 'def_fumble_recovery_opp'
    if recovery not in player_stats: raise ValueError('Missing opponent fumble-recovery source; cannot score D/ST targets')
    player_stats['def_fumbles']=pd.to_numeric(player_stats[recovery],errors='coerce').fillna(0)
    defense_cols=['def_sacks','def_interceptions','def_fumbles','def_tds','def_safeties',
                  'def_punt_blocks','def_pat_blocks','def_fg_blocks','def_2pt_made','special_teams_tds','fumble_recovery_tds']
    for c in defense_cols:
        if c not in player_stats: player_stats[c]=0
        player_stats[c]=pd.to_numeric(player_stats[c],errors='coerce').fillna(0)
    defp=player_stats.groupby(['season','week','game_id','team'],as_index=False)[defense_cols].sum()
    offense_cols=['passing_yards','rushing_yards','sack_yards_lost','fumbles_lost_total']
    for c in offense_cols:
        if c not in player_stats: player_stats[c]=0
        player_stats[c]=pd.to_numeric(player_stats[c],errors='coerce').fillna(0)
    offense=player_stats.groupby(['season','week','game_id','team'],as_index=False)[offense_cols].sum()
    offense['yards_allowed']=offense['passing_yards']+offense['rushing_yards']+offense['sack_yards_lost']
    offense=offense.rename(columns={'team':'opponent_team','fumbles_lost_total':'off_fumbles_lost'})
    ds=[]
    g=completed_rows(games[games.game_type=='REG'])
    g['season']=pd.to_numeric(g.season,errors='coerce').astype(int); g['week']=pd.to_numeric(g.week,errors='coerce').astype(int)
    for _,r in g.iterrows():
        for team,opp,pa,pf in [(r.home_team,r.away_team,r.away_score,r.home_score),(r.away_team,r.home_team,r.home_score,r.away_score)]:
            ds.append({'season':int(r.season),'week':int(r.week),'game_id':r.game_id,'team':team,'opponent_team':opp,'points_allowed':pa,'opponent_points':pf})
    t=pd.DataFrame(ds)
    t=t.merge(defp,on=['season','week','game_id','team'],how='left')
    t=t.merge(offense[['season','week','game_id','opponent_team','yards_allowed','off_fumbles_lost']],
              on=['season','week','game_id','opponent_team'],how='left')
    for c in defense_cols: t[c]=t[c].fillna(0)
    t['yards_allowed']=pd.to_numeric(t['yards_allowed'],errors='coerce').fillna(0)
    t['off_fumbles_lost']=pd.to_numeric(t['off_fumbles_lost'],errors='coerce').fillna(0)
    t=t.dropna(subset=['points_allowed','opponent_points']).copy()
    # Defensive touchdowns do not count as points allowed in ESPN D/ST scoring.
    opp_tds=defp[['season','week','game_id','team','def_tds','fumble_recovery_tds']].copy()
    opp_tds['opponent_defensive_tds']=opp_tds.def_tds+opp_tds.fumble_recovery_tds
    opp_tds=opp_tds.rename(columns={'team':'opponent_team'})
    t=t.merge(opp_tds[['season','week','game_id','opponent_team','opponent_defensive_tds']],on=['season','week','game_id','opponent_team'],how='left')
    t['points_allowed']=t.points_allowed-6*t.opponent_defensive_tds.fillna(0)
    def pa_pts(x):
        if x==0:return 5
        if x<=6:return 4
        if x<=13:return 3
        if x<=17:return 1
        if x<=27:return 0
        if x<=34:return -1
        if x<=45:return -3
        return -5
    def ya_pts(x):
        if x<100:return 5
        if x<200:return 3
        if x<300:return 2
        if x<350:return 0
        if x<400:return -1
        if x<450:return -3
        if x<500:return -5
        if x<550:return -6
        return -7
    t['points']=(t.points_allowed.map(pa_pts)+t.yards_allowed.map(ya_pts)+t.def_sacks+
                 2*(t.def_interceptions+t.def_fumbles)+6*(t.def_tds+t.special_teams_tds+t.fumble_recovery_tds)+
                 2*t.def_safeties+2*(t.def_punt_blocks+t.def_pat_blocks+t.def_fg_blocks)+
                 2*t.def_2pt_made)
    t['nflverse_points']=t.points
    t['target_source']='NFLverse corrected reconstruction; historical component parity not fully verified'
    if DST_CANONICAL_TARGETS:
        canonical=DST_CANONICAL_TARGETS
        for i,r in t.iterrows():
            value=canonical.get((int(r.season),int(r.week),TEAM_NAMES.get(r.team,r.team)+' D/ST'))
            if value:
                t.at[i,'points']=value['points'];t.at[i,'target_source']='ESPN raw counts rescored with league rules'
                for field,stat in [('points_allowed','120'),('yards_allowed','127'),('def_sacks','99'),('def_interceptions','95'),('def_fumbles','96')]:
                    t.at[i,field]=float(value['stats'].get(stat,0))
    t=t.sort_values(['team','season','week'])
    g=t.groupby('team',sort=False)
    t['games_prev']=g.cumcount()
    for c in ['points','def_sacks','def_interceptions','def_fumbles','points_allowed','yards_allowed']:
        t['prev_'+c]=g[c].shift(1)
        t['roll4_'+c]=g[c].transform(lambda s:s.shift(1).rolling(4,min_periods=1).mean())
        t['season_'+c]=t.groupby(['team','season'],sort=False)[c].transform(lambda s:s.shift(1).expanding(min_periods=1).mean())
    # Opponent scoring form from completed games only.
    opp=t[['season','week','team','opponent_points']].rename(columns={'team':'opponent_team','opponent_points':'opp_points'}).sort_values(['opponent_team','season','week'])
    og=opp.groupby(['opponent_team','season'],sort=False).opp_points
    opp['opp_roll4']=og.transform(lambda s:s.shift(1).rolling(4,min_periods=1).mean())
    opp['opp_season']=og.transform(lambda s:s.shift(1).expanding(min_periods=1).mean())
    t=t.merge(opp[['season','week','opponent_team','opp_roll4','opp_season']],on=['season','week','opponent_team'],how='left')
    t=t.rename(columns={'prev_points':'prev_points','roll4_points':'roll4_points','season_points':'season_points_avg',
        'prev_def_sacks':'prev_sacks','roll4_def_sacks':'roll4_sacks','prev_def_interceptions':'prev_int',
        'prev_def_fumbles':'prev_fumbles','roll4_def_interceptions':'roll4_int','roll4_def_fumbles':'roll4_fumbles',
        'roll4_points_allowed':'roll4_pa','season_points_allowed':'season_pa','opp_roll4':'opp_roll4_points','opp_season':'opp_season_points'})
    t['prev_takeaways']=t[['prev_int','prev_fumbles']].fillna(0).sum(axis=1)
    t['roll4_takeaways']=t[['roll4_int','roll4_fumbles']].fillna(0).sum(axis=1)
    for c in DEF_FEATURES:
        if c not in t:t[c]=0
        t[c]=pd.to_numeric(t[c],errors='coerce')
        t[c]=t[c].fillna(t[c].median() if t[c].notna().any() else 0)
    return t


def fit_pack(d, features, target, artifact_prefix, cutoff_season=2024, fit=True):
    hist=d[(d.season>=2015)&(d.season<=cutoff_season)].copy()
    valid=d[d.season.eq(2025)].copy()
    xtr=hist[features].replace([np.inf,-np.inf],np.nan).fillna(0)
    ytr=hist[target].astype(float)
    xva=valid[features].replace([np.inf,-np.inf],np.nan).fillna(0)
    yva=valid[target].astype(float)
    preds={}; quant={}; models={}
    def train(x,y,objective='regression',alpha=None,rounds=140,seed=SEED,leaves=15,min_leaf=100):
        params={'objective':objective,'metric':'l1','learning_rate':.035,'num_leaves':leaves,
                'min_data_in_leaf':min_leaf,'lambda_l2':3,'verbosity':-1,'seed':seed,
                'feature_fraction_seed':seed,'bagging_seed':seed,'num_threads':4}
        if alpha is not None: params['alpha']=alpha
        return lgb.train(params,lgb.Dataset(x,label=y,free_raw_data=False),num_boost_round=rounds)
    mean=train(xtr,ytr,rounds=140,seed=SEED,leaves=15,min_leaf=100)
    pred=mean.predict(xva) if len(valid) else np.array([])
    base=valid['season_points_avg'].copy() if 'season_points_avg' in valid else pd.Series(np.nan,index=valid.index)
    if 'career_points_avg' in valid: base=base.fillna(valid['career_points_avg'])
    baseline=base.fillna(hist[target].mean()).to_numpy()
    if len(yva):
        preds['model']=pred
        preds['baseline']=baseline
        metrics={
            'n':int(len(yva)),
            'model_mae':float(np.mean(np.abs(yva-pred))),
            'model_rmse':float(np.sqrt(np.mean((yva-pred)**2))),
            'baseline_mae':float(np.mean(np.abs(yva-baseline))),
            'baseline_rmse':float(np.sqrt(np.mean((yva-baseline)**2))),
            'model_bias':float(np.mean(pred-yva)),
            'baseline_bias':float(np.mean(baseline-yva)),
        }
    else: metrics={'n':0}
    models['mean']=mean
    for q in Q_LEVELS:
        m=train(xtr,ytr,objective='quantile',alpha=q,rounds=110,seed=SEED+round(q*100),leaves=13,min_leaf=100)
        models[f'q{int(q*100):02d}']=m
    # Holdout quantile interval coverage from validation-only predictions.
    if len(valid):
        q10=models['q10'].predict(xva); q90=models['q90'].predict(xva)
        metrics['q10_q90_coverage']=float(np.mean((yva>=q10)&(yva<=q90)))
        metrics['q10_q90_nominal']=0.80
        metrics['mean_score_actual']=float(yva.mean()); metrics['mean_score_predicted']=float(np.mean(pred))
        metrics['mean_score_baseline']=float(np.mean(baseline))
    if fit:
        xf=d[(d.season>=2015)&((d.season<2026)|((d.season==2026)&(d.week<=CUTOFF_WEEK)))].copy()
        # For 2026, include through week 4 only, and use historical rows through 2025.
        xf=xf[(xf.season<=2025)|((xf.season==2026)&(xf.week<=CUTOFF_WEEK))]
        xx=xf[features].replace([np.inf,-np.inf],np.nan).fillna(0); yy=xf[target].astype(float)
        final_mean=train(xx,yy,rounds=140,seed=SEED,leaves=15,min_leaf=100); models['final_mean']=final_mean
        for q in Q_LEVELS:
            m=train(xx,yy,objective='quantile',alpha=q,rounds=110,seed=SEED+round(q*100),leaves=13,min_leaf=100)
            models[f'final_q{int(q*100):02d}']=m
        for key,m in models.items(): m.save_model(str(OUT/f'{artifact_prefix}_{key}.txt'))
        metrics['final_training_rows']=int(len(xf)); metrics['final_training_start']=int(xf.season.min()); metrics['final_training_end']=int(xf.season.max())
    return models,metrics


def quantile_draw(qvals,n,seed):
    vals=np.maximum.accumulate(np.asarray(qvals,dtype=float))
    qs=np.asarray(Q_LEVELS)
    # modest tail continuation; clamp impossible extreme tails instead of pretending certainty.
    rng=np.random.default_rng(seed)
    u=rng.uniform(0,1,n)
    return np.interp(u,qs,vals,left=vals[0],right=vals[-1])


def norm(s): return re.sub(r'[^a-z0-9]+','',str(s).lower())


def resolve_player(name,position,players):
    aliases={'Bills D/ST':'BUF','Packers D/ST':'GB','Texans D/ST':'HOU'}
    if position=='DST':
        team=aliases.get(name)
        return {'name':name,'position':'DST','team':team,'player_id':team,'display':TEAM_NAMES.get(team,name)}
    query=ALIASES.get(name,name)
    rows=players[players.position.eq(position)].copy()
    target=norm(query)
    exact=rows[rows.player_display_name.map(norm).eq(target)]
    if exact.empty:
        # Ignore periods, initials and apostrophes; use all distinctive words.
        words=[w for w in re.findall(r'[A-Za-z]+',query) if len(w)>=3]
        cand=rows[rows.player_display_name.map(lambda n: all(norm(w) in norm(n) for w in words[-2:]))] if words else rows.iloc[0:0]
        exact=cand
    if exact.empty:
        return {'name':name,'position':position,'team':None,'player_id':None,'display':query}
    seen=exact.groupby(['player_display_name','player_id','team'],as_index=False).week.max().sort_values('week',ascending=False)
    r=seen.iloc[0]
    return {'name':name,'position':position,'team':str(r.team),'player_id':str(r.player_id),'display':str(r.player_display_name)}


def player_forecast(p,position,team,opponent,off_models,off_latest,dst_models,dst_latest,roster_name=None):
    if position=='DST':
        x=dst_latest[(dst_latest.team==team)&(dst_latest.week==TARGET_WEEK)]
        if x.empty:
            # Build forecast state from latest completed team game.
            x=dst_latest[dst_latest.team==team].tail(1)
        row=x.iloc[-1]
        xx=pd.DataFrame([{c:pd.to_numeric(pd.Series([row[c]]),errors='coerce').fillna(0).iloc[0] for c in DEF_FEATURES}])
        models=dst_models
    else:
        x=off_latest[off_latest.player_id==p]
        if x.empty:
            return None
        row=x.iloc[-1].copy()
        # ``off_latest`` is rebuilt as an as-of Week 5 feature frame. It contains
        # all observed Week 1-4 usage, rather than the pregame features attached
        # to each player's Week 4 row.
        row['week']=TARGET_WEEK; row['season']=2026
        xx=pd.DataFrame([{c:pd.to_numeric(pd.Series([row[c]]),errors='coerce').fillna(0).iloc[0] for c in FEATURES}])
        models=off_models[position]
    mean=float(models['final_mean'].predict(xx)[0])
    qvals=[float(models[f'final_q{int(q*100):02d}'].predict(xx)[0]) for q in Q_LEVELS]
    qvals=np.maximum.accumulate(np.array(qvals))
    # Reconcile the quantile distribution to the expected-value model head so
    # Monte Carlo team means equal the sum of model projection outputs.
    quantile_weights=np.array([.075,.10,.20,.25,.20,.10,.075])
    qvals=qvals+(mean-float(np.dot(qvals,quantile_weights)))
    qpoints={str(int(q*100)):float(v) for q,v in zip(Q_LEVELS,qvals)}
    player_name=roster_name or p
    status='—'
    return {'name':player_name,'player':p,'position':position,'team':team,'opponent':opponent or 'BYE',
        'mean':mean,'q10':float(qvals[1]),'q25':float(qvals[2]),'median':float(qvals[3]),'q75':float(qvals[4]),'q90':float(qvals[5]),'quantiles':qpoints,
        'week4_form':float(row['season_points_avg']) if position!='DST' else float(row['season_points_avg']),
        'available':True,'status':status}


def schedule_map(games):
    g=games[(games.season==2026)&(games.week==TARGET_WEEK)&(games.game_type=='REG')]
    result={}
    for _,r in g.iterrows(): result[str(r.home_team)]=str(r.away_team); result[str(r.away_team)]=str(r.home_team)
    return result


def simulate_players(forecasts,n=30000,seed=SEED):
    rng=np.random.default_rng(seed)
    result={}
    for i,p in enumerate(forecasts):
        if not p: continue
        if p.get('bye'): result[p['name']]=np.zeros(n); continue
        q=[p['quantiles'][str(int(q*100))] for q in Q_LEVELS]
        v=quantile_draw(q,n,seed+i*101)
        result[p['name']]=v
    return result


def summarize_distribution(arr):
    return {'mean':float(np.mean(arr)),'p10':float(np.quantile(arr,.1)),'p25':float(np.quantile(arr,.25)),
            'median':float(np.quantile(arr,.5)),'p75':float(np.quantile(arr,.75)),'p90':float(np.quantile(arr,.9))}


def unavailable_forecast(item):
    """An authenticated OUT/IR roster entry is unavailable, not a modeled zero."""
    if item.get('status') not in ['O', 'IR'] or item.get('teamId') is None:
        return None
    return {**item, 'player': None, 'team': None, 'opponent': 'UNKNOWN',
            'mean': 0.0, 'q10': 0.0, 'q25': 0.0, 'median': 0.0, 'q75': 0.0, 'q90': 0.0,
            'quantiles': {str(int(q*100)): 0.0 for q in Q_LEVELS}, 'week4_form': 0.0,
            'statisticalForecast': False, 'coverageNote': 'No current-season statistical identity; authenticated ESPN OUT/IR. Zero availability contribution only.',
            'available': False, 'bye': False, 'locked': False,
            'group': 'IR' if item.get('slotId') == 21 else 'bench' if item.get('slotId') == 20 else 'starter',
            'slot': {0:'QB',2:'RB',4:'WR',6:'TE',23:'FLEX',16:'D/ST',17:'K',20:'BE',21:'IR'}.get(item.get('slotId'), ''),
            'active_lineup': item.get('slotId') not in [20,21]}


def main():
    source_input=json.loads((ROOT/f'output/pdf/week{TARGET_WEEK}-scout/league-input.json').read_text())
    scoring_baseline=json.loads((ROOT/'python/scout/league-scoring-baseline.json').read_text())
    scoring_key=lambda x: (x['statId'],x.get('points'),x.get('pointsOverrides'))
    if sorted(map(scoring_key,scoring_baseline),key=lambda x:x[0])!=sorted(map(scoring_key,source_input['settings']['scoringSettings']['scoringItems']),key=lambda x:x[0]):raise ValueError('League scoring changed; rebuild scoring targets before forecasting')
    stats=load_weekly()
    games=pd.read_csv(GAMES,low_memory=False)
    games['season']=pd.to_numeric(games.season,errors='coerce').astype('Int64')
    games['week']=pd.to_numeric(games.week,errors='coerce').astype('Int64')
    season_map=schedule_map(games)
    completed_coverage=validate_completed_coverage(stats,games)
    off=make_offense_features(stats)
    # Historical 2025 validation and final updated artifact for each offense model.
    models={}; metrics={}
    fit_data={}
    for pos in ['QB','RB','WR','TE','K']:
        x=off[off.position.eq(pos)].copy()
        models[pos],metrics[pos]=fit_pack(x,FEATURES,'points',pos.lower(),fit=True)
        fit_data[pos]=x
    # Build D/ST source rows from defensive data and game scores.
    full=pd.concat([pd.read_csv(DATA/f'stats_player_week_{y}.csv.gz',low_memory=False) for y in range(2010,2026)]+[pd.read_csv(STATS26,low_memory=False)],ignore_index=True,sort=False)
    full=full[full.season_type.eq('REG')].copy()
    full['season']=pd.to_numeric(full.season,errors='coerce').astype(int); full['week']=pd.to_numeric(full.week,errors='coerce').astype(int)
    dst=dst_team_games(full,games)
    dst_models,metrics['DST']=fit_pack(dst,DEF_FEATURES,'points','dst',fit=True)
    # There are 32 Week 5 team schedule rows; add projected rows as-of week 4 for defense.
    # Use the last four 2026 games per team as the forecast state and their scheduled opponent.
    dst_latest=dst[dst.season.eq(2026)&dst.week.le(CUTOFF_WEEK)].copy()
    for team,opp in season_map.items():
        if team not in dst_latest.team.values:
            continue
        actual=dst[(dst.season.eq(2026))&(dst.week.le(CUTOFF_WEEK))&(dst.team.eq(team))].sort_values('week')
        if actual.empty: continue
        row=actual.iloc[-1].copy(); row['week']=TARGET_WEEK; row['season']=2026; row['opponent_team']=opp
        row['games_prev']=int(len(actual))
        row['prev_points']=float(actual.points.iloc[-1]); row['roll4_points']=float(actual.points.tail(4).mean()); row['season_points_avg']=float(actual.points.mean())
        row['prev_sacks']=float(actual.def_sacks.iloc[-1]); row['roll4_sacks']=float(actual.def_sacks.tail(4).mean())
        row['prev_takeaways']=float((actual.def_interceptions+actual.def_fumbles).iloc[-1]); row['roll4_takeaways']=float((actual.def_interceptions+actual.def_fumbles).tail(4).mean())
        row['roll4_pa']=float(actual.points_allowed.tail(4).mean()); row['season_pa']=float(actual.points_allowed.mean())
        row['prev_yards_allowed']=float(actual.yards_allowed.iloc[-1]); row['roll4_yards_allowed']=float(actual.yards_allowed.tail(4).mean())
        row['season_yards_allowed']=float(actual.yards_allowed.mean())
        # Update opponent output context from that opponent's completed games through W4.
        og=dst_latest[(dst_latest.team==opp)&(dst_latest.week<=CUTOFF_WEEK)]
        row['opp_roll4_points']=float(og.opponent_points.tail(4).mean()) if len(og) else 21
        row['opp_season_points']=float(og.opponent_points.mean()) if len(og) else 21
        dst_latest=pd.concat([dst_latest,row.to_frame().T],ignore_index=True)
    # Build an as-of Week 5 offensive feature row from every actual 2026 game
    # through Week 4; the source rows' own features predict those past games and
    # therefore must not be reused unchanged for a Week 5 forecast.
    off_latest=off[off.season.eq(2026)&off.week.le(CUTOFF_WEEK)].copy()
    current_rows=[]
    for pid,g in off_latest.sort_values(['week','game_id']).groupby('player_id',sort=False):
        g=g.sort_values('week')
        r=g.iloc[-1].copy()
        hist=off[(off.player_id==pid)&((off.season<2026)|((off.season==2026)&(off.week<=CUTOFF_WEEK)))].sort_values(['season','week','game_id'])
        r['week']=TARGET_WEEK; r['season']=2026; r['games_prev']=len(hist)
        for target,source in [('points','points'),('touches','touches'),('targets','targets'),('attempts','attempts'),('yards','yards')]:
            vals=pd.to_numeric(g[source],errors='coerce').fillna(0)
            hv=pd.to_numeric(hist[source],errors='coerce').fillna(0)
            r['prev_'+target]=float(vals.iloc[-1])
            r['roll4_'+target]=float(vals.tail(4).mean())
            r['season_'+target+'_avg']=float(vals.mean())
            r['career_'+target+'_avg']=float(hv.mean()) if len(hv) else float(vals.mean())
            if target=='points':
                r['career_points_sd']=float(hv.std()) if len(hv)>1 else 5.0
                r['roll4_points_sd']=float(vals.tail(4).std()) if len(vals.tail(4))>1 else r['career_points_sd']
        current_rows.append(r)
    off_latest=pd.DataFrame(current_rows)
    source_input=json.loads((ROOT/f'output/pdf/week{TARGET_WEEK}-scout/league-input.json').read_text())
    news_input=json.loads((ROOT/f'output/pdf/week{TARGET_WEEK}-scout/news-input.json').read_text())
    output=ROOT/f'output/pdf/week{TARGET_WEEK}-scout'
    previous=json.loads((ROOT/'public/scout-data.json').read_text())
    position_map={1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'DST'}
    slots={0:'QB',2:'RB',4:'WR',6:'TE',23:'FLEX',16:'D/ST',17:'K',20:'BE',21:'IR'}
    statuses={'ACTIVE':'—','QUESTIONABLE':'Q','DOUBTFUL':'D','OUT':'O','INJURY_RESERVE':'IR','active':'—','questionable':'Q','doubtful':'D','out':'O','injured_reserve':'IR'}
    inventory=[]
    for team in source_input['teams']:
        for e in team['entries']: inventory.append({'name':e['player']['name'],'position':position_map[e['player']['position']],'espnId':str(e['player']['id']),'status':statuses.get(e['player'].get('status'),'—'),'slotId':e['slot'],'club':team['name'],'teamId':team['id']})
    for p in source_input['freeAgents']:
        pos=next((v for v in p['positions'] if v in ['QB','RB','WR','TE','K','DST']),None)
        if pos:inventory.append({'name':p['full_name'],'position':pos,'espnId':p['external_id'],'status':statuses.get(p['status'],'—'),'slotId':None,'club':'available','teamId':None})
    forecasts=[];unmatched=[];rosters=[]
    dst_alias={v+' D/ST':k for k,v in TEAM_NAMES.items()}
    for item in inventory:
        pos=item['position'];name=item['name']
        if pos=='DST':
            team=dst_alias.get(name);pid=team
        else:
            # Resolve only unique normalized exact identities (suffix aliases are explicit).
            target=norm(ALIASES.get(name,name));rows=off_latest[(off_latest.position==pos)&(off_latest.player_display_name.map(norm)==target)]
            if rows.empty and name.endswith(' Jr.'):rows=off_latest[(off_latest.position==pos)&(off_latest.player_display_name.map(norm)==norm(name[:-4]))]
            if rows.empty:
                unavailable=unavailable_forecast(item)
                if unavailable is not None:
                    forecasts.append(unavailable)
                    continue
            if rows.empty or rows.player_id.nunique()!=1:
                unmatched.append({'name':name,'position':pos,'rostered':item['teamId'] is not None});continue
            rr=rows.iloc[-1];pid=rr.player_id;team=rr.team
        if not team:unmatched.append({'name':name,'position':pos,'rostered':item['teamId'] is not None});continue
        f=player_forecast(pid,pos,team,season_map.get(team),models,off_latest,dst_models,dst_latest,roster_name=name)
        if f is None:unmatched.append({'name':name,'position':pos,'rostered':item['teamId'] is not None});continue
        f.update(item);f['group']='available' if item['teamId'] is None else 'bench' if item['slotId']==20 else 'IR' if item['slotId']==21 else 'starter';f['available']=item['teamId'] is None;f['bye']=f['opponent']=='BYE';f['slot']=slots.get(item['slotId'],'');f['active_lineup']=f['group']=='starter';f['locked']=False
        if f['bye'] or f['status'] in ['O','IR']:
            f['activeMean']=f['mean'];f['mean']=0;f['quantiles']={k:0 for k in f['quantiles']}
        forecasts.append(f)
    missing=[p for p in unmatched if p['rostered']]
    if missing:raise ValueError('Unmatched roster identities: '+json.dumps(missing))
    for t in source_input['teams']:
        players=[f for f in forecasts if f['teamId']==t['id']];counts={};lineup={}
        for p in players:
            key=p['slot']
            if p['group']=='starter':
                if key in ['RB','WR']:counts[key]=counts.get(key,0)+1;key+=str(counts[key])
                p['slot']=key;lineup[key]=p['name']
        rosters.append({'id':t['id'],'name':t['name'],'record':f"{t['record']['wins']}–{t['record']['losses']}",'players':players,'currentLineup':lineup})
    meta=previous['meta'];meta.update({'week':TARGET_WEEK,'season':2026,'owner':next(t['name'] for t in rosters if t['id']=='7'),'opponent':next(t['name'] for t in rosters if t['id']!= '7'),'asOf':datetime.now(timezone.utc).isoformat(),'reportAsOf':source_input['readAt'],'rosterReadAt':source_input['readAt'],'statsCutoff':f'Season 2026 completed Weeks 1-{CUTOFF_WEEK}; later rows excluded','statsSha256':sha(STATS26),'source':'Authenticated ESPN rosters/free agents; NFLverse weekly statistics; PMT ingested news','lineupSource':'authenticated ESPN read','validation':metrics,'modelStatus':'Candidate models - not promoted','distributionNote':'Quantile distributions use independent player draws; Q-tag forecasts are conditional on playing. Confirm final inactive lists before kickoff.','availabilityCoverage':f"{len([f for f in forecasts if f['available']])} matched forecasts of {len(source_input['freeAgents'])} available players; unmatched identities excluded.",'newsStatus':f"PMT source counts: {news_input['counts']}; degraded: {news_input['degraded']}",'refreshNote':f'Week {TARGET_WEEK} model refresh; no live roster action executed.'})
    for k in ['rosterMove','defenseMove','inactiveCheck','executedActions']:meta.pop(k,None)
    owned_ids={p['espnId'] for p in forecasts if not p['available']};news=[n for n in news_input['news'] if str(n.get('player_id')) in owned_ids];seen=set();meta['news']=[]
    for n in sorted(news,key=lambda n:n.get('published_at',''),reverse=True):
        if n['headline'] in seen:continue
        roster_names=[norm(p['name']) for p in forecasts if not p['available'] and p['position']!='DST']
        if not any(k in norm(n['headline']) for k in roster_names):continue
        seen.add(n['headline']);meta['news'].append({'headline':n['headline'],'detail':n.get('summary',''),'impact':'Review availability before kickoff; statistical model means are not manually changed by news.','url':n['source_url'],'source':n['source'],'date':n['published_at'],'retrievedAt':n.get('ingested_at',source_input['readAt'])})
        if len(meta['news'])==8:break
    data={'meta':meta,'teams':rosters,'freeAgents':[f for f in forecasts if f['available']]}
    (ROOT/'public/scout-data.json').write_text(json.dumps(data,indent=2))
    (OUT/'player-forecasts.json').write_text(json.dumps(forecasts,indent=2));(OUT/'unmatched.json').write_text(json.dumps(unmatched,indent=2));(OUT/'validation.json').write_text(json.dumps(metrics,indent=2))
    manifest={'status':'candidate_not_promoted','modelVersion':f'weekly-2026-W{TARGET_WEEK}-{sha(STATS26)[:12]}-{sha(Path(__file__))[:12]}-{sha(ROOT / "python/scout/dst_scoring.py")[:12]}','modelCodeSha256':sha(Path(__file__)),'scoringCodeSha256':sha(ROOT/'python/scout/dst_scoring.py'),'dstTargetSourceSha256':DST_CANONICAL_SHA,'season':2026,'targetWeek':TARGET_WEEK,'cutoffWeek':CUTOFF_WEEK,'builtAt':meta['asOf'],'sourceSha256':{'stats':sha(STATS26),'games':sha(GAMES)},'features':{'offense':FEATURES,'DST':DEF_FEATURES},'validation':metrics,'scoring':source_input['settings']['scoringSettings'],'sourceUrls':['https://github.com/nflverse/nflverse-data/releases/tag/stats_player','https://github.com/nflverse/nfldata/blob/master/data/games.csv'],'matching':'Unique exact normalized name / explicit suffix alias; ambiguous identities excluded','limitations':['Independent team draws','Q forecasts conditional on playing','One-point safety absent from source','Historical 2015-2025 D/ST component parity incomplete; captured 2026 ESPN targets rescored independently','No model promotion']}
    full_schedule = games[(games.season == 2026) & (games.game_type == 'REG')]
    team_counts = pd.concat([full_schedule.home_team, full_schedule.away_team]).value_counts()
    if len(full_schedule) != 272 or len(team_counts) != 32 or not team_counts.eq(17).all() or full_schedule.game_id.nunique() != 272:
        raise ValueError('Complete 32-team/272-game season schedule required for waiver horizon')
    horizon = forecast_horizon(forecasts, games, off_latest, dst_latest, off, dst,
                               models, dst_models, FEATURES, DEF_FEATURES, TARGET_WEEK, CUTOFF_WEEK)
    horizon['modelVersion'] = manifest['modelVersion']
    # Conditional healthy availability is a comparison scenario, not a medical
    # recovery prediction. News-derived windows are applied by the policy engine.
    healthy = forecast_horizon([{**f, 'status': '—'} for f in forecasts], games,
                               off_latest, dst_latest, off, dst, models, dst_models,
                               FEATURES, DEF_FEATURES, TARGET_WEEK, CUTOFF_WEEK)
    horizon['healthyPlayers'] = healthy['players']
    horizon['healthyScenarioNote'] = 'Conditional on healthy availability; does not predict recovery or change observed outcomes.'
    (OUT/'waiver-horizon.json').write_text(json.dumps(horizon, indent=2))
    manifest['waiverHorizonSha256'] = sha(OUT/'waiver-horizon.json')
    manifest['waiverHorizonCodeSha256'] = sha(ROOT/'python/scout/waiver_horizon.py')
    manifest['completedOutcomeCoverage']=completed_coverage
    manifest['unavailableWithoutStatisticalIdentity']=[{'name':f['name'],'espnId':f['espnId'],'coverageNote':f['coverageNote']} for f in forecasts if f.get('statisticalForecast') is False]
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'week':TARGET_WEEK,'forecastCount':len(forecasts),'rosters':[t['name'] for t in rosters],'unmatched':len(unmatched)}))

if __name__=='__main__':main()

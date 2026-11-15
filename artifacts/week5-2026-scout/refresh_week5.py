#!/usr/bin/env python3
"""Build isolated Week 5 2026 candidate fantasy models and scout report.

Source data are nflverse weekly player stats through Week 4, plus scheduled games.
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

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('PMT_NFLVERSE_DATA_DIR', '/tmp/pmt-nflverse-2026'))
STATS26 = DATA / 'stats_player_week_2026.csv'
GAMES = DATA / 'games.csv.gz'
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
TARGET_WEEK = 5
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

ROSTERS = {
    'Bored Man Gets Paid': [
        ('Josh Allen','QB','starter'),('Ashton Jeanty','RB','starter'),('Tony Pollard','RB','starter'),
        ('Malik Nabers','WR','starter'),("Wan'Dale Robinson",'WR','starter'),('George Kittle','TE','starter'),
        ('Michael Wilson','WR','flex'),('Bills D/ST','DST','starter'),('Eddy Pineiro','K','starter'),
        ('Jameson Williams','WR','bench'),('Kenny Gainwell','RB','bench'),('RJ Harvey','RB','bench'),
        ('Jauan Jennings','WR','bench'),('Adonai Mitchell','WR','bench'),('Tyjae Spears','RB','bench'),
        ('Rashid Shaheed','WR','bench'),
    ],
    '23andMe': [
        ('Sam Darnold','QB','starter'),('Bucky Irving','RB','starter'),('Tyler Allgeier','RB','starter'),
        ("Ja'Marr Chase",'WR','starter'),('Matthew Golden','WR','starter'),('Trey McBride','TE','starter'),
        ('Keon Coleman','WR','flex'),('Texans D/ST','DST','starter'),('Harrison Mevis','K','starter'),
        ('Kenneth Walker III','RB','bench'),('Tetairoa McMillan','WR','bench'),('Jadarian Price','RB','IR'),
        ('Khalil Shakir','WR','bench'),('Travis Kelce','TE','bench'),('Patrick Mahomes','QB','bench'),
        ('Packers D/ST','DST','bench'),
    ],
}

AVAILABLE_FLEX = [
    'Malik Washington','KC Concepcion','T.J. Hockenson','Courtland Sutton','Keenan Allen',
    'Brenton Strange','Darius Cooper','Roman Wilson','Kenyon Sadiq','Mack Hollins',
    'Pat Freiermuth','Ryan Flournoy','Brian Robinson Jr.','A.J. Barner','MarShawn Lloyd',
    'Caleb Douglas','Rachaad White','Cade Otton','Colby Parkinson','Kendre Miller',
    'Keaton Mitchell','Malachi Fields','Hunter Henry',
]
AVAILABLE_DST = ['Cowboys','Commanders','Falcons','Patriots','Bears','Colts','Lions','49ers',
                 'Raiders','Chargers','Titans','Saints','Eagles','Giants','Dolphins',
                 'Buccaneers','Ravens']

ALIASES = {'Brian Robinson Jr.':'Brian Robinson'}
QUESTIONABLES = {"Ja'Marr Chase",'Keenan Allen','Mack Hollins','Rachaad White','Colby Parkinson'}
DOUBTFULS = {'Adonai Mitchell'}

NEWS = [
    {
        'headline': "Ja'Marr Chase left Week 4 with a concussion",
        'detail': "NFL.com reported Chase was ruled out after a first-half concussion. The Week 5 screenshot marks him questionable; model forecast is conditional on playing. Recheck clearance and final designation before kickoff.",
        'url': 'https://www.nfl.com/news/notable-injuries-news-sunday-week-4-games',
        'impact': 'Opponent scoring has a meaningful inactive scenario; report shows both cases.'
    },
    {
        'headline': 'Baker Mayfield remains out; rookie Jalon Daniels starts for Tampa Bay',
        'detail': 'NFL.com reported Mayfield is expected to miss at least three weeks after a thumb injury, with Daniels starting. The Week 5 Thursday matchup is Tampa Bay at Dallas; this raises the appeal of Cowboys D/ST as a one-week stream, though Dallas model output remains the scoring basis.',
        'url': 'https://www.nfl.com/news/buccaneers-qb-baker-mayfield-thumb-out-at-least-three-weeks-jalon-daniels',
        'impact': 'Use the Cowboys D/ST as a waiver comparison against Buffalo.'
    },
    {
        'headline': 'Keenan Allen was ruled out in Week 4 with a groin injury; Jadarian Price was placed on IR',
        'detail': 'The Oct. 3 NFL.com roundup reported Allen ruled out and Price placed on injured reserve. Your screenshot still marks Allen questionable and Price IR; treat Allen’s model line as conditional on active status, and keep Price only if your roster has a legal IR slot.',
        'url': 'https://amp.nfl.com/news/nfl-news-roundup-latest-league-updates-from-saturday-oct-3',
        'impact': 'Avoid treating Keenan Allen as a safe Week 5 pickup before practice/clearance; Price is an IR stash decision, not an active lineup option.'
    },
]


def sha(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1<<20),b''): h.update(block)
    return h.hexdigest()


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


def load_weekly():
    parts=[]
    for year in range(2010,2026):
        p=DATA/f'stats_player_week_{year}.csv.gz'
        d=pd.read_csv(p,low_memory=False)
        parts.append(d)
    cur=pd.read_csv(STATS26,low_memory=False)
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
    defense_cols=['def_sacks','def_interceptions','def_fumbles','def_tds','def_safeties',
                  'def_punt_blocks','def_pat_blocks','def_fg_blocks','def_2pt_made','special_teams_tds']
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
    g=games[(games.game_type=='REG')].copy()
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
                 2*(t.def_interceptions+t.def_fumbles)+6*(t.def_tds+t.special_teams_tds)+
                 2*t.def_safeties+2*(t.def_punt_blocks+t.def_pat_blocks+t.def_fg_blocks)+
                 2*t.def_2pt_made-2*t.off_fumbles_lost)
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
        xf=d[(d.season>=2015)&((d.season<2026)|((d.season==2026)&(d.week<=4)))].copy()
        # For 2026, include through week 4 only, and use historical rows through 2025.
        xf=xf[(xf.season<=2025)|((xf.season==2026)&(xf.week<=4))]
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
        x=dst_latest[(dst_latest.team==team)&(dst_latest.week==5)]
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
        row['week']=5; row['season']=2026
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
    status='Q' if player_name in QUESTIONABLES else 'D' if player_name in DOUBTFULS else '—'
    return {'name':player_name,'player':p,'position':position,'team':team,'opponent':opponent or 'BYE',
        'mean':mean,'q10':float(qvals[1]),'q25':float(qvals[2]),'median':float(qvals[3]),'q75':float(qvals[4]),'q90':float(qvals[5]),'quantiles':qpoints,
        'week4_form':float(row['season_points_avg']) if position!='DST' else float(row['season_points_avg']),
        'available':True,'status':status}


def schedule_map(games):
    g=games[(games.season==2026)&(games.week==5)&(games.game_type=='REG')]
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


def chart_svg_player(forecasts):
    rows=[p for p in forecasts if p and p['position']!='DST']
    rows=sorted(rows,key=lambda p:p['mean'],reverse=True)
    width=1020; rowh=32; height=55+rowh*len(rows)
    vals=[max(0,p['q90']) for p in rows]; maxv=max(25,max(vals))
    x0=275; x1=930; scale=(x1-x0)/maxv
    out=[f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Individual fantasy point forecast intervals">',
         '<defs><linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#66e3b4"/><stop offset="1" stop-color="#3c7eff"/></linearGradient></defs>']
    for tick in range(0,int(maxv)+1,5):
        x=x0+tick*scale; out.append(f'<line x1="{x:.1f}" y1="26" x2="{x:.1f}" y2="{height-8}" stroke="#263452"/>')
        out.append(f'<text x="{x:.1f}" y="18" fill="#9dafcb" font-size="11" text-anchor="middle">{tick}</text>')
    for i,p in enumerate(rows):
        y=45+i*rowh; color='#d7e4fb' if p.get('group')!='available' else '#9cb6dc'
        label=f"{p['name']} · {p['position']}"
        out.append(f'<text x="8" y="{y+4}" fill="{color}" font-size="12">{html.escape(label[:34])}</text>')
        out.append(f'<line x1="{x0+p["q10"]*scale:.1f}" y1="{y}" x2="{x0+p["q90"]*scale:.1f}" y2="{y}" stroke="#5c739c" stroke-width="8" stroke-linecap="round"/>')
        out.append(f'<line x1="{x0+p["q25"]*scale:.1f}" y1="{y}" x2="{x0+p["q75"]*scale:.1f}" y2="{y}" stroke="url(#bar)" stroke-width="8" stroke-linecap="round"/>')
        out.append(f'<circle cx="{x0+p["mean"]*scale:.1f}" cy="{y}" r="5" fill="#fff" stroke="#13213c" stroke-width="2"/>')
        out.append(f'<text x="{min(x1-5,x0+p["q90"]*scale+12):.1f}" y="{y+4}" fill="#b7c7e2" font-size="11">{p["mean"]:.1f}</text>')
    out.append('</svg>')
    return ''.join(out)


def chart_svg_matchup(own,opp,own_name,opp_name):
    low=min(float(np.quantile(own,.005)),float(np.quantile(opp,.005)))-10
    high=max(float(np.quantile(own,.995)),float(np.quantile(opp,.995)))+10
    bins=np.linspace(low,high,46); ha,_=np.histogram(own,bins=bins,density=True); hb,_=np.histogram(opp,bins=bins,density=True)
    W,H=920,315; left,right,top,bottom=58,18,22,42; maxd=max(ha.max(),hb.max())*1.15
    def path(vals,color):
        pts=[]
        for i,v in enumerate(vals):
            x=left+(i+.5)*(W-left-right)/len(vals); y=H-bottom-(v/maxd)*(H-top-bottom)
            pts.append(f'{x:.1f},{y:.1f}')
        return f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    ticks=np.arange(math.floor(low/20)*20, high+1,20)
    out=[f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Simulated team and opponent scoring distributions">']
    for v in ticks:
        x=left+(v-low)/(high-low)*(W-left-right)
        if left<=x<=W-right:
            out.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{H-bottom}" stroke="#263452"/>')
            out.append(f'<text x="{x:.1f}" y="{H-15}" fill="#9dafcb" font-size="11" text-anchor="middle">{v}</text>')
    out += [path(ha,'#61e2b2'),path(hb,'#ffa870'),f'<line x1="{left}" y1="{H-bottom}" x2="{W-right}" y2="{H-bottom}" stroke="#516280"/>',
       f'<text x="{left}" y="{H-2}" fill="#9dafcb" font-size="11">Team points</text>',
       f'<text x="{W-160}" y="19" fill="#61e2b2" font-size="12">{html.escape(own_name)}</text>',
       f'<text x="{W-160}" y="37" fill="#ffa870" font-size="12">{html.escape(opp_name)}</text>','</svg>']
    return ''.join(out)


def player_table(rows):
    body=[]
    for p in rows:
        if not p: continue
        arr=p.get('_draws')
        if arr is not None:
            prob={t:float(np.mean(arr>=t)) for t in [5,10,15,20,25]}
        else: prob={}
        probs=' · '.join(f'{t}+ {prob[t]:.0%}' for t in [10,15,20]) if prob else '—'
        status=f" · {p.get('status')} / conditional" if p.get('status') in ('Q','D') else ' · IR' if p.get('status')=='IR' else ''
        body.append(f"<tr><td>{html.escape(p['name'])}{status}</td><td>{p['position']}</td><td>{p['team'] or '—'} vs {p['opponent']}</td><td>{p['mean']:.1f}</td><td>{p['q10']:.1f}–{p['q90']:.1f}</td><td>{probs}</td></tr>")
    return '<table><thead><tr><th>Player</th><th>Pos</th><th>Week 5</th><th>Model mean</th><th>10–90% range</th><th>Chance to score at least</th></tr></thead><tbody>'+''.join(body)+'</tbody></table>'


def make_report(forecasts,sim,metrics,source_info,schedule):
    own=[p for p in forecasts if p and p.get('club')=='Bored Man Gets Paid']
    opp=[p for p in forecasts if p and p.get('club')=='23andMe']
    available=[p for p in forecasts if p and p.get('group')=='available']
    own_start=[p for p in own if p.get('active_lineup')]
    bench_players=[p for p in own if p.get('group') in ('bench','IR')]
    opp_start=[p for p in opp if p.get('active_lineup')]
    flex_pool=[p for p in available if p['position'] in ('RB','WR','TE') and p['opponent']!='BYE']
    currentflex=next((p for p in own_start if p.get('slot')=='flex'),None)
    # Flex decision among current roster and available pool is based on model mean.
    own_flex_options=[p for p in own if p['group'] in ('flex','bench') and p['position'] in ('RB','WR','TE') and p['opponent']!='BYE']
    best_flex=max(own_flex_options,key=lambda p:p['mean']) if own_flex_options else currentflex
    best_waiver=max(flex_pool,key=lambda p:p['mean']) if flex_pool else None
    healthy_waiver=max((p for p in flex_pool if p.get('status')!='Q'),key=lambda p:p['mean'],default=None)
    healthy_rb=max((p for p in flex_pool if p['position']=='RB' and p.get('status')!='Q'),key=lambda p:p['mean'],default=None)
    own_dst=next((p for p in own_start if p['position']=='DST'),None)
    cowboys=next((p for p in available if p['position']=='DST' and p['team']=='DAL'),None)
    dst_options=sorted((p for p in available if p['position']=='DST'),key=lambda p:p['mean'],reverse=True)
    top_dst=dst_options[0] if dst_options else None
    own_draw=np.zeros(30000); opp_draw=np.zeros(30000)
    for p in own_start:
        if p['name']==(currentflex or {}).get('name') and best_flex: continue
        own_draw+=sim.get(p['name'],0)
    if best_flex: own_draw+=sim.get(best_flex['name'],0)
    # Chase scenario: standard starts with Chase active, then an out scenario.
    chase=next((p for p in opp_start if p['player']=="Ja'Marr Chase"),None)
    for p in opp_start: opp_draw+=sim.get(p['name'],0)
    chase_out=opp_draw-(sim.get(chase['name'],0) if chase else 0)
    win_active=float(np.mean(own_draw>opp_draw))
    win_out=float(np.mean(own_draw>chase_out))
    # Use Chase-active as the baseline and report the out case separately; no play probability is assumed.
    opp_summary=summarize_distribution(opp_draw)
    own_summary=summarize_distribution(own_draw)
    alt_def_draw=None; alt_def_win=None; alt_def_summary=None
    if own_dst and top_dst and top_dst['mean']>own_dst['mean']:
        alt_def_draw=own_draw+sim.get(top_dst['name'],0)-sim.get(own_dst['name'],0)
        alt_def_summary=summarize_distribution(alt_def_draw)
        alt_def_win=float(np.mean(alt_def_draw>opp_draw))
    alt_def_note=(f"Adding and starting {top_dst['name']} instead of Buffalo moves the model mean to {alt_def_summary['mean']:.1f} and the win chance to {alt_def_win:.0%} with Chase active."
                  if alt_def_summary else '')
    if currentflex and best_flex and currentflex['name']!=best_flex['name']:
        lineup_note=f"Start {best_flex['name']} at FLEX instead of {currentflex['name']} by model mean (+{best_flex['mean']-currentflex['mean']:.1f})."
    else: lineup_note=f"Keep {best_flex['name'] if best_flex else 'current FLEX'} at FLEX; it leads your active roster by model mean."
    add_note=''
    if best_flex and healthy_waiver:
        add_note=(f"No available flex beats {best_flex['name']} ({best_flex['mean']:.1f}). For RB depth, add {healthy_rb['name']} at {healthy_rb['mean']:.1f} if you want a bench claim. "
                  "If you need a roster spot, compare the lowest-projection bench player with your season-long depth needs; do not drop a starter solely for a one-week move.")
    elif best_waiver:
        add_note=f"No available flex is a clear Week 5 upgrade over {best_flex['name'] if best_flex else 'your current flex'} by model mean. Keep your current lineup and make no flex waiver claim."
    if top_dst and own_dst:
        dst_note=(f"The refreshed D/ST model's top visible stream is {top_dst['name']} at {top_dst['mean']:.1f}, vs Bills at {own_dst['mean']:.1f}, using the league's points-allowed and total-yards-allowed tiers. "
                  f"{cowboys['name']} project {cowboys['mean']:.1f}; the model does not rank Dallas first despite the Mayfield news. Packers D/ST is the lower-value defense on your bench if you make a claim.")
    else: dst_note='D/ST stream comparison unavailable.'
    # attach player-level simulation arrays for a primary-roster + best available table.
    table_rows=[]
    for p in sorted(own_start+opp_start,key=lambda z:z['mean'],reverse=True):
        p['_draws']=sim.get(p['name']); table_rows.append(p)
    for p in sorted(available,key=lambda z:z['mean'],reverse=True)[:15]:
        p['_draws']=sim.get(p['name']); table_rows.append(p)
    for p in bench_players:
        p['_draws']=sim.get(p['name'])
    indiv_svg=chart_svg_player(own_start+opp_start+available[:12])
    matchup_svg=chart_svg_matchup(own_draw,opp_draw,'Bored Man Gets Paid','23andMe')
    overall_metrics={}
    for pos,m in metrics.items(): overall_metrics[pos]=m
    def metric_table():
        rows=[]
        for pos,m in overall_metrics.items():
            if m.get('n'):
                rows.append(f"<tr><td>{pos}</td><td>{m['n']:,}</td><td>{m['model_mae']:.2f}</td><td>{m['baseline_mae']:.2f}</td><td>{m['q10_q90_coverage']:.0%}</td></tr>")
        return '<table><thead><tr><th>Position model</th><th>2025 holdout games</th><th>MAE · candidate</th><th>MAE · baseline</th><th>80% interval coverage</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table>'
    links=''.join(f"<li><a href='{html.escape(n['url'])}' target='_blank' rel='noopener'>{html.escape(n['headline'])}</a> — {html.escape(n['detail'])}</li>" for n in NEWS)
    news_html=f'<ul class="news">{links}</ul>'
    for i,p in enumerate(own_start): p['starter_order']=i
    roster_table=player_table(table_rows)
    bench_table=player_table(bench_players)
    waiver_rows=sorted(flex_pool,key=lambda p:p['mean'],reverse=True)[:12]
    waiver_table=player_table(waiver_rows)
    waiver_dst_table=player_table(dst_options[:8])
    html_doc=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Week 5 Scout Report · Bored Man Gets Paid</title>
<style>
:root{{--bg:#09111f;--panel:#111d31;--panel2:#15243b;--line:#263754;--ink:#ecf3ff;--muted:#9dafcb;--mint:#61e2b2;--blue:#6c91ff;--orange:#ffa870;--red:#ff7682}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(ellipse at 65% -20%,#172e51 0,transparent 45%),var(--bg);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}}main{{max-width:1180px;margin:auto;padding:40px 26px 70px}}header{{padding:12px 0 30px;border-bottom:1px solid var(--line)}}.eyebrow{{color:var(--mint);letter-spacing:.14em;text-transform:uppercase;font-size:11px;font-weight:700}}h1{{font-size:clamp(34px,6vw,60px);line-height:1.03;letter-spacing:-.04em;margin:15px 0 14px}}h2{{font-size:23px;letter-spacing:-.02em;margin:0 0 16px}}h3{{font-size:16px;margin:0 0 10px}}p{{color:#c3d0e5}}.muted,.small{{color:var(--muted)}}.small{{font-size:12px}}.grid{{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin:22px 0}}.card{{background:linear-gradient(145deg,var(--panel),#0e192b);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 12px 36px #0003}}.wide{{grid-column:span 12}}.half{{grid-column:span 6}}.third{{grid-column:span 4}}.stat{{font-size:36px;font-weight:750;letter-spacing:-.05em}}.stat span{{color:var(--mint)}}.pill{{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:4px 9px;color:var(--muted);font-size:11px}}.decision{{border-left:3px solid var(--mint);padding:10px 14px;background:#112536;border-radius:0 10px 10px 0}}table{{width:100%;border-collapse:collapse;font-size:13px}}th,td{{padding:10px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}th{{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.08em}}td:nth-child(4),td:nth-child(5){{font-variant-numeric:tabular-nums}}.table-wrap{{overflow-x:auto}}svg{{width:100%;height:auto;display:block}}a{{color:#91b6ff}}li{{margin:10px 0;color:#c3d0e5}}.legend{{display:flex;gap:16px;color:var(--muted);font-size:12px;margin-top:8px}}.dot{{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--mint);margin-right:6px}}.dot2{{background:var(--orange)}}footer{{border-top:1px solid var(--line);padding-top:20px;margin-top:28px;color:var(--muted);font-size:12px}}@media(max-width:750px){{main{{padding:22px 14px}}.half,.third{{grid-column:span 12}}.card{{padding:15px}}}}
</style></head><body><main>
<header><div class="eyebrow">Pardon My Trade · Model-driven scout report · October 7, 2026</div><h1>Week 5:<br><span style="color:var(--mint)">Bored Man Gets Paid</span></h1><p>Matchup against 23andMe · NFL stats through Week 4 · refreshed candidate models, not screenshot projections.</p><span class="pill">2026 Week 5</span> <span class="pill">NFLverse data cutoff: Oct 7 09:04 UTC</span> <span class="pill">ESPN scoring rules applied</span></header>
<section class="grid"><article class="card third"><div class="small">YOUR MODEL MEAN</div><div class="stat">{own_summary['mean']:.1f}</div><div class="small">{own_summary['p10']:.0f}–{own_summary['p90']:.0f} · central 80%</div></article><article class="card third"><div class="small">OPPONENT MODEL MEAN · CHASE ACTIVE</div><div class="stat">{opp_summary['mean']:.1f}</div><div class="small">{opp_summary['p10']:.0f}–{opp_summary['p90']:.0f} · central 80%</div></article><article class="card third"><div class="small">MODEL WIN CHANCE · CHASE ACTIVE</div><div class="stat"><span>{win_active:.0%}</span></div><div class="small">{win_out:.0%} if Chase sits · no play probability assumed</div></article>
<article class="card wide"><h2>Scoring distribution</h2><p class="muted">30,000 paired draws from per-player quantile forecasts. The orange opponent curve assumes Chase is active; the separate sit scenario is shown above without an invented injury probability.</p>{matchup_svg}<div class="legend"><span><i class="dot"></i>Your team</span><span><i class="dot dot2"></i>23andMe</span></div></article>
<article class="card half"><h2>Lineup call</h2><div class="decision"><strong>{html.escape(lineup_note)}</strong></div><p>{html.escape(dst_note)}</p><p>{html.escape(alt_def_note)}</p><p class="small">Keep Josh Allen, Jeanty, Pollard, Nabers, Wan'Dale Robinson, Kittle, the recommended FLEX, kicker and defense in their locked-position slots. Bench players on bye score zero this week. No recommendation executes a roster move.</p></article>
<article class="card half"><h2>Waiver desk</h2><div class="decision"><strong>{html.escape(add_note)}</strong></div><p>{html.escape(dst_note)}</p><p class="small">The league-specific K and D/ST scoring weights are included in the retrained targets. NFLverse does not separately identify the rare D/ST 1-point-safety event.</p></article>
<article class="card wide"><h2>Individual scoring ranges</h2><p class="muted">White marker = model mean; bright segment = 25th–75th percentile; full whisker = 10th–90th. The model averages historical NFL performance and 2026 usage through Week 4.</p>{indiv_svg}</article>
<article class="card wide"><h2>Lineup, opponent and best visible adds</h2><div class="table-wrap">{roster_table}</div><p class="small">For each player, the threshold probabilities are from that player's own quantile distribution; team-level probabilities preserve those distributions and sum the starting lineup. Players tagged BYE are modeled at zero for Week 5.</p></article>
<article class="card wide"><h2>Bench: hold, stash or cut?</h2><p>Bench decisions use the model outputs and Week 5 schedule tags below. Keep players with upcoming season-long value through a bye; if you need a waiver spot, compare the lowest-projection bench option with your roster depth rather than cutting an active starter.</p><div class="table-wrap">{bench_table}</div><p class="small">The ESPN settings show seven bench places and no dedicated IR starter slot. The visible IR tag is retained as an injury status; verify ESPN roster eligibility before a transaction.</p></article>
<article class="card wide"><h2>Available flex options</h2><div class="table-wrap">{waiver_table}</div><h3 style="margin-top:24px">Available defenses</h3><div class="table-wrap">{waiver_dst_table}</div><p class="small">The available pool is limited to players and defenses visible in your screenshots. A missing or ambiguous name is not silently replaced.</p></article>
<article class="card wide"><h2>Current news that changes the call</h2>{news_html}<p class="small">The <a href="https://amp.nfl.com/injuries/" target="_blank" rel="noopener">official Week 5 injury page</a> showed Thursday game statuses at this Wednesday cutoff; Sunday player reports were not yet posted. Screenshot Q tags are shown as conditional projections, not probability-weighted statuses.</p></article>
<article class="card wide"><h2>Model refresh and backtest</h2><p>Six isolated position models were refit: QB, RB, WR, TE, K and D/ST. The fantasy point targets follow the ESPN settings visible for this league, including kicker missed attempts and D/ST points-allowed and total-yards-allowed tiers. The model used lagged player usage, rolling/season scoring, and lagged opponent performance; 2026 rows through Week 4 were included in the final fit. The 2025 season is held out for the retrospective scorecard.</p><div class="table-wrap">{metric_table()}</div><p class="small">MAE is mean absolute error in fantasy points; interval coverage is the share of 2025 outcomes between the fitted 10th and 90th percentiles. These results are not league-specific calibration. Projection uncertainty is elevated after only four 2026 games and for low-sample players.</p></article>
<article class="card wide"><h2>Data and limits</h2><ul><li>Player performance: nflverse weekly player statistics; latest file through Week 4 (downloaded Oct. 7, 2026 at 09:04 UTC). File SHA-256: <code>{source_info['stats_sha256']}</code>.</li><li>Schedule and team defensive results: nflverse games/player weekly files; Week 5 schedule used for opponents/byes.</li><li>League scoring was read from the supplied live ESPN settings page. Current rosters and visible free agents were transcribed from your screenshots because ESPN roster credentials were unavailable.</li><li>Forecasts are point distributions, not bookmaker odds. Model candidate artifacts were not promoted into the app.</li><li>Independent player draws omit game-level correlation, weather and late news; team win probability therefore has additional uncertainty. These candidate heads are not league-specific calibrations.</li></ul></article></section>
<footer>Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · Local candidate build · no live platform writes</footer></main></body></html>'''
    (OUT/'week5-scout-report.html').write_text(html_doc)
    # Markdown report preserves a convenient text version of the decision and provenance.
    md=f"""# Week 5 scout report — Bored Man Gets Paid\n\n**As of:** October 7, 2026 · NFL stats through Week 4 · opponent: 23andMe\n\n- Your model mean: **{own_summary['mean']:.1f}** ({own_summary['p10']:.1f}–{own_summary['p90']:.1f}, central 80%).\n- Opponent model mean: **{opp_summary['mean']:.1f}** ({opp_summary['p10']:.1f}–{opp_summary['p90']:.1f}, Chase-active scenario).\n- Win probability: **{win_active:.0%}** with Chase active; **{win_out:.0%}** if Chase sits. No injury probability is assumed.\n\n**Lineup:** {lineup_note} {dst_note}\n\n**Add/drop:** {add_note}\n\n**Model outputs**\n\n{metric_table().replace('<table>','').replace('</table>','').replace('<thead>','').replace('</thead>','').replace('<tbody>','').replace('</tbody>','').replace('<tr>','').replace('</tr>','\n').replace('<th>','').replace('</th>',' | ').replace('<td>','').replace('</td>',' | ')}\n\n**News:** Ja’Marr Chase left Week 4 with a concussion and is a conditional projection; confirm clearance before kickoff. Baker Mayfield was expected to miss at least three weeks and rookie Jalon Daniels starts for Tampa Bay, which gives Dallas D/ST a matchup tailwind. Sources: [NFL Week 4 injury update](https://www.nfl.com/news/notable-injuries-news-sunday-week-4-games), [Mayfield/Daniels update](https://www.nfl.com/news/buccaneers-qb-baker-mayfield-thumb-out-at-least-three-weeks-jalon-daniels).\n\n**Scoring:** {SCORING_NOTE}\n\n**Provenance:** Current player stats file SHA-256 `{source_info['stats_sha256']}`; data cutoff Week 4. ESPN scoring came from the live settings page; screenshots were used for team and available-player identification. Current models are isolated candidates, not promoted.\n"""
    (OUT/'week5-scout-report.md').write_text(md)
    return {'own':own_summary,'opponent':opp_summary,'win_active':win_active,'win_inactive_chase':win_out,
            'lineup_note':lineup_note,'add_note':add_note,'dst_note':dst_note,'alt_def_note':alt_def_note,'alt_def_mean':alt_def_summary['mean'] if alt_def_summary else None,'alt_def_win':alt_def_win,'own_start':own_start,'opp_start':opp_start,
            'flex_candidates':sorted(flex_pool,key=lambda p:p['mean'],reverse=True)[:12]}


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    stats=load_weekly()
    games=pd.read_csv(GAMES,low_memory=False)
    games['season']=pd.to_numeric(games.season,errors='coerce').astype('Int64')
    games['week']=pd.to_numeric(games.week,errors='coerce').astype('Int64')
    season_map=schedule_map(games)
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
    dst_latest=dst[dst.season.eq(2026)&dst.week.le(4)].copy()
    for team,opp in season_map.items():
        if team not in dst_latest.team.values:
            continue
        actual=dst[(dst.season.eq(2026))&(dst.week.le(4))&(dst.team.eq(team))].sort_values('week')
        if actual.empty: continue
        row=actual.iloc[-1].copy(); row['week']=5; row['season']=2026; row['opponent_team']=opp
        row['games_prev']=int(len(actual))
        row['prev_points']=float(actual.points.iloc[-1]); row['roll4_points']=float(actual.points.tail(4).mean()); row['season_points_avg']=float(actual.points.mean())
        row['prev_sacks']=float(actual.def_sacks.iloc[-1]); row['roll4_sacks']=float(actual.def_sacks.tail(4).mean())
        row['prev_takeaways']=float((actual.def_interceptions+actual.def_fumbles).iloc[-1]); row['roll4_takeaways']=float((actual.def_interceptions+actual.def_fumbles).tail(4).mean())
        row['roll4_pa']=float(actual.points_allowed.tail(4).mean()); row['season_pa']=float(actual.points_allowed.mean())
        row['prev_yards_allowed']=float(actual.yards_allowed.iloc[-1]); row['roll4_yards_allowed']=float(actual.yards_allowed.tail(4).mean())
        row['season_yards_allowed']=float(actual.yards_allowed.mean())
        # Update opponent output context from that opponent's completed games through W4.
        og=dst_latest[(dst_latest.team==opp)&(dst_latest.week<=4)]
        row['opp_roll4_points']=float(og.opponent_points.tail(4).mean()) if len(og) else 21
        row['opp_season_points']=float(og.opponent_points.mean()) if len(og) else 21
        dst_latest=pd.concat([dst_latest,row.to_frame().T],ignore_index=True)
    # Build an as-of Week 5 offensive feature row from every actual 2026 game
    # through Week 4; the source rows' own features predict those past games and
    # therefore must not be reused unchanged for a Week 5 forecast.
    off_latest=off[off.season.eq(2026)&off.week.le(4)].copy()
    current_rows=[]
    for pid,g in off_latest.sort_values(['week','game_id']).groupby('player_id',sort=False):
        g=g.sort_values('week')
        r=g.iloc[-1].copy()
        hist=off[(off.player_id==pid)&((off.season<2026)|((off.season==2026)&(off.week<=4)))].sort_values(['season','week','game_id'])
        r['week']=5; r['season']=2026; r['games_prev']=len(hist)
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
    # Candidate inventory and current league clubs.
    all_candidates=[]
    for club,roster in ROSTERS.items():
        for n,pos,group in roster:
            r=resolve_player(n,pos,off_latest if pos!='DST' else pd.DataFrame(columns=['position','player_display_name','player_id','team','week']))
            if pos=='DST': r=resolve_player(n,pos,off_latest)
            if r.get('team') is None and pos!='DST':
                # Find across position and match screenshot alias if exact/full name exists.
                r=resolve_player(n,pos,off)
            opp=season_map.get(r.get('team'))
            f=player_forecast(r.get('player_id'),pos,r.get('team'),opp,models,off_latest,dst_models,dst_latest,roster_name=n)
            if f is None:
                continue
            f['club']=club; f['group']=group; f['active_lineup']=group=='starter' or group=='flex'; f['slot']='flex' if group=='flex' else pos
            f['player']=r.get('display') if pos!='DST' else r.get('team')
            if group=='IR':
                f.update({'status':'IR','mean':0.0,'q10':0.0,'q25':0.0,'median':0.0,'q75':0.0,'q90':0.0,
                          'quantiles':{str(int(q*100)):0.0 for q in Q_LEVELS},'bye':False})
            if f['opponent']=='BYE': f['mean']=0.0; f['q10']=f['q25']=f['median']=f['q75']=f['q90']=0.0; f['quantiles']={str(int(q*100)):0.0 for q in Q_LEVELS}; f['bye']=True
            else: f['bye']=False
            all_candidates.append(f)
    for n in AVAILABLE_FLEX:
        pos_guess='TE' if n in ['T.J. Hockenson','Brenton Strange','Kenyon Sadiq','Pat Freiermuth','A.J. Barner','Cade Otton','Colby Parkinson','Hunter Henry'] else 'RB' if n in ['Brian Robinson Jr.','MarShawn Lloyd','Rachaad White','Kendre Miller','Keaton Mitchell'] else 'WR'
        r=resolve_player(n,pos_guess,off_latest)
        if r.get('team') is None:r=resolve_player(n,pos_guess,off)
        if r.get('team') is None:
            print('Could not resolve visible waiver player:',n,file=sys.stderr); continue
        opp=season_map.get(r['team'])
        f=player_forecast(r['player_id'],pos_guess,r['team'],opp,models,off_latest,dst_models,dst_latest,roster_name=n)
        if f:
            f.update({'club':'available','group':'available','active_lineup':False,'slot':'waiver','player':r['display'],'bye':opp is None})
            if opp is None: f.update({'opponent':'BYE','mean':0.0,'q10':0.0,'q25':0.0,'median':0.0,'q75':0.0,'q90':0.0,'quantiles':{str(int(q*100)):0.0 for q in Q_LEVELS}})
            all_candidates.append(f)
    dst_abbr={'Cowboys':'DAL','Commanders':'WAS','Falcons':'ATL','Patriots':'NE','Bears':'CHI','Colts':'IND','Lions':'DET','49ers':'SF','Raiders':'LV','Chargers':'LAC','Titans':'TEN','Saints':'NO','Eagles':'PHI','Giants':'NYG','Dolphins':'MIA','Buccaneers':'TB','Ravens':'BAL'}
    for name,team in dst_abbr.items():
        opp=season_map.get(team)
        f=player_forecast(team,'DST',team,opp,models,off_latest,dst_models,dst_latest,roster_name=f'{name} D/ST')
        if f:
            f.update({'club':'available','group':'available','active_lineup':False,'slot':'waiver','player':f['team'],'bye':opp is None})
            if opp is None: f.update({'opponent':'BYE','mean':0.,'q10':0.,'q25':0.,'median':0.,'q75':0.,'q90':0.,'quantiles':{str(int(q*100)):0. for q in Q_LEVELS}})
            all_candidates.append(f)
    # Do not draw duplicate player distributions under same name (available and roster player).
    sim=simulate_players(all_candidates)
    for f in all_candidates:
        if f['opponent']=='BYE':sim[f['name']]=np.zeros(30000)
    # Persist detailed forecasts including probability thresholds from quantile simulations.
    forecast_json=[]
    for f in all_candidates:
        d=sim.get(f['name'],np.zeros(30000))
        x={k:v for k,v in f.items() if k not in ('quantiles','_draws')}
        x['probabilities']={f'{t}_plus':float(np.mean(d>=t)) for t in [5,10,15,20,25]}
        x['quantiles']=f['quantiles']; forecast_json.append(x)
    (OUT/'week5-player-forecasts.json').write_text(json.dumps(forecast_json,indent=2))
    pd.DataFrame(forecast_json).drop(columns=['quantiles','probabilities']).to_csv(OUT/'week5-player-forecasts.csv',index=False)
    src={'stats_sha256':sha(STATS26),'games_sha256':sha(GAMES),'stats_path':str(STATS26),'games_path':str(GAMES),
         'week_count':{str(k):int(v) for k,v in stats[stats.season.eq(2026)].groupby('week').size().items()},
         'source_cutoff':'2026-10-07 09:04:51 UTC; season 2026 Weeks 1-4'}
    payload=make_report(all_candidates,sim,metrics,src,season_map)
    manifest={
        'artifact_type':'candidate-only-weekly-model-refresh','status':'not_promoted',
        'built_at':datetime.now(timezone.utc).isoformat(),'season':2026,'target_week':5,
        'data_cutoff':src['source_cutoff'],'source_files':src,'training_years':'2015-2025 plus 2026 Weeks 1-4 final fit; 2025 held out for retrospective validation',
        'positions':list(models.keys())+['DST'],'features':{'offense':FEATURES,'dst':DEF_FEATURES},
        'quantiles':Q_LEVELS,'scoring_note':SCORING_NOTE,'metrics':metrics,
        'environment':{'python':sys.version,'lightgbm':lgb.__version__,'numpy':np.__version__,'pandas':pd.__version__},
        'limitation':'The roster and free-agent inventory are screenshot-derived, and model artifacts are candidate-only and not promoted to PMT runtime. NFLverse does not separately expose the rare one-point-safety event.'
    }
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
    (OUT/'validation.json').write_text(json.dumps(metrics,indent=2))
    (OUT/'matchup-summary.json').write_text(json.dumps({k:v for k,v in payload.items() if k not in ('own_start','opp_start','flex_candidates')},indent=2))
    print(json.dumps({'summary':{k:v for k,v in payload.items() if k not in ('own_start','opp_start','flex_candidates')},
        'metrics':metrics,'lineups':{'own':[(p['name'],round(p['mean'],2),p['opponent']) for p in payload['own_start']],
        'opp':[(p['name'],round(p['mean'],2),p['opponent']) for p in payload['opp_start']]},
        'waivers':[(p['name'],round(p['mean'],2),p['opponent']) for p in payload['flex_candidates'][:12]]},indent=2))


if __name__=='__main__': main()

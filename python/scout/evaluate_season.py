#!/usr/bin/env python3
"""Causal season replay, separate archived forecasts, and population-focused evaluation."""
import importlib.util,json,math,re,hashlib,sys
sys.path.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
from pathlib import Path
import numpy as np,pandas as pd,lightgbm as lgb
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/evaluation/2026-model-performance';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('weekly_scout',ROOT/'python/scout/weekly_scout.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
live=json.loads((OUT/'live-input.json').read_text());weekly=json.loads((ROOT/'public/scout-data.json').read_text());roster=next(t for t in weekly['teams'] if t['id']=='7')['players'];model_ids={p['name']:p['player'] for p in json.loads((ROOT/f"artifacts/week{weekly['meta']['week']}-2026-scout/player-forecasts.json").read_text()) if p['name'] in {q['name'] for q in roster}}
source=OUT/'source-stats-2026.csv';games_path=OUT/'source-games.csv'
current=pd.read_csv(source,low_memory=False);current=current[current.season_type.eq('REG')];last=min(int(current.week.max()),live['currentWeek']-1);current=current[current.week<=last]
parts=[pd.read_csv(ROOT/f'data/nflverse/stats_player_week_{y}.csv.gz',low_memory=False) for y in range(2010,2026)];raw=pd.concat(parts+[current],ignore_index=True,sort=False);raw=raw[raw.season_type.eq('REG')].copy();raw['season']=pd.to_numeric(raw.season).astype(int);raw['week']=pd.to_numeric(raw.week).astype(int)
games=pd.read_csv(games_path,low_memory=False);games['season']=pd.to_numeric(games.season).astype(int);games['week']=pd.to_numeric(games.week).astype(int)
actual_map={(m.norm(p['name']),p['week']):float(p['actual']) for p in live.get('leagueActuals',[]) if p.get('actual') is not None}
own_actual={(p['name'],s['week']):float(s['actual']) for p in live['roster'] for s in p['stats'] if s.get('actual') is not None}
known=current[current.position.isin(['QB','RB','WR','TE','K'])].sort_values('week').drop_duplicates('player_id',keep='last')[['player_id','player_display_name','position','team']]
all_rows=[];training_rows=[];training_diagnostics=[];missing=[];scoring_audit=[]
rng=np.random.default_rng(642026)
def offense_base(source):
 d=source[source.position.isin(['QB','RB','WR','TE','K'])].copy();d['player_id']=d.player_id.astype(str);d['points']=m.ppr_points(d);mask=d.position.eq('K');d.loc[mask,'points']=m.kicker_points(d.loc[mask])
 for c in ['carries','targets','receptions','attempts','passing_yards','rushing_yards','receiving_yards']:
  if c not in d:d[c]=0
  d[c]=pd.to_numeric(d[c],errors='coerce').fillna(0)
 d['touches']=d.carries+d.receptions;d['yards']=d.passing_yards+d.rushing_yards+d.receiving_yards;return d

def fit(df,features,position,week):
 train=df[df.season.ge(2015)].copy();X=train[features].replace([np.inf,-np.inf],np.nan).fillna(0);y=train.points.astype(float)
 pack={};params={'metric':'l1','learning_rate':.035,'num_leaves':15,'min_data_in_leaf':100,'lambda_l2':3,'verbosity':-1,'seed':52026,'num_threads':4}
 for key,q in [('mean',None)]+[(f'q{int(q*100):02d}',q) for q in m.Q_LEVELS]:
  pp={**params,'objective':'regression' if q is None else 'quantile','feature_fraction_seed':52026+(int(q*100) if q else 0),'bagging_seed':52026+(int(q*100) if q else 0),'seed':52026+(int(q*100) if q else 0),'num_leaves':15 if q is None else 13}
  if q is not None:pp['alpha']=q
  pack[key]=lgb.train(pp,lgb.Dataset(X,label=y),num_boost_round=140 if q is None else 110)
 mean=pack['mean'].predict(X);q10=pack['q10'].predict(X);q90=pack['q90'].predict(X)
 for i,(_,row) in enumerate(train.iterrows()):training_rows.append({'evaluationWeek':week,'season':int(row.season),'week':int(row.week),'position':position,'name':str(row.get('player_display_name',row.get('team',''))),'mean':float(mean[i]),'actual':float(row.points),'q10':float(min(q10[i],q90[i])),'q90':float(max(q10[i],q90[i]))})
 training_diagnostics.append({'week':week,'position':position,'n':len(train),'mae':float(np.mean(abs(mean-y))),'rmse':float(np.sqrt(np.mean((mean-y)**2))),'residualSD':float(np.std(mean-y)),'coverage80':float(np.mean((y>=q10)&(y<=q90))),'maxTrainingSeason':int(train.season.max()),'max2026Week':int(train[train.season.eq(2026)].week.max()) if any(train.season.eq(2026)) else 0})
 return pack

def predict(pack,features,row):
 X=pd.DataFrame([{c:float(row.get(c,0)) if pd.notna(row.get(c,0)) else 0 for c in features}]);mean=float(pack['mean'].predict(X)[0]);qs=np.maximum.accumulate([float(pack[f'q{int(q*100):02d}'].predict(X)[0]) for q in m.Q_LEVELS]);qs+=mean-float(np.dot(qs,[.075,.10,.20,.25,.20,.10,.075]));draw=m.quantile_draw(qs,4000,642026);return mean,{str(int(q*100)):float(v) for q,v in zip(m.Q_LEVELS,qs)},float(np.var(draw))

for week in range(1,last+1):
 print(f'Week {week}: strict training cutoff before target week',flush=True)
 past=raw[(raw.season<2026)|((raw.season==2026)&(raw.week<week))].copy();base=offense_base(past);off=m.make_offense_features(base);completed_games=games[(games.season<2026)|((games.season==2026)&(games.week<week))];dst=m.dst_team_games(past,completed_games)
 packs={pos:fit(off[off.position.eq(pos)],m.FEATURES,pos,week) for pos in ['QB','RB','WR','TE','K']};packs['DST']=fit(dst,m.DEF_FEATURES,'DST',week)
 weekgames=games[(games.season==2026)&(games.week==week)&games.game_type.eq('REG')];schedule={}
 for _,g in weekgames.iterrows():schedule[g.home_team]=g.away_team;schedule[g.away_team]=g.home_team
 actualrows=offense_base(current[current.week==week]);pool=known.copy();rows_this=[]
 for _,p in pool.iterrows():
  pid=str(p.player_id);pos=p.position;name=str(p.player_display_name);actualrow=actualrows[actualrows.player_id.eq(pid)];hist=base[base.player_id.eq(pid)].sort_values(['season','week']);cur=hist[hist.season.eq(2026)];g=cur if len(cur) else hist[hist.season.eq(hist.season.max())] if len(hist) else hist
  target_team=str(actualrow.iloc[-1].team) if len(actualrow) else str(cur.iloc[-1].team) if len(cur) else str(p.team);opp=schedule.get(target_team)
  prev=off[off.player_id.eq(pid)];row=prev.iloc[-1].to_dict() if len(prev) else {};row.update({'week':week,'season':2026,'games_prev':len(hist)})
  for target,source_col in [('points','points'),('touches','touches'),('targets','targets'),('pass_attempts','attempts'),('yards','yards')]:
   vals=g[source_col] if len(g) else pd.Series(dtype=float);career=hist[source_col] if len(hist) else pd.Series(dtype=float)
   row['prev_'+target]=float(vals.iloc[-1]) if len(vals) else 0;row['roll4_'+target]=float(vals.tail(4).mean()) if len(vals) else 0;row['season_'+target+'_avg']=float(vals.mean()) if len(vals) else 0
   if target=='points':row['career_points_avg']=float(career.mean()) if len(career) else float(base[base.position.eq(pos)].points.mean());row['career_points_sd']=float(career.std()) if len(career)>1 else 5;row['roll4_points_sd']=float(vals.tail(4).std()) if len(vals)>1 else row['career_points_sd']
  mean,qs,var=predict(packs[pos],m.FEATURES,row)
  if not opp:mean=0;qs={k:0 for k in qs};var=0
  actual=float(actualrow.points.iloc[-1]) if len(actualrow) else None;source_actual='NFLverse league-compatible target' if actual is not None else 'not recorded'
  if (m.norm(name),week) in actual_map:actual=actual_map[(m.norm(name),week)];source_actual='ESPN league-scored actual'
  if actual is not None and len(actualrow) and (m.norm(name),week) in actual_map:scoring_audit.append({'name':name,'week':week,'position':pos,'nflverse':float(actualrow.points.iloc[-1]),'espn':actual,'difference':actual-float(actualrow.points.iloc[-1])})
  rowout={'week':week,'name':name,'playerId':pid,'position':pos,'team':target_team,'opponent':opp or 'BYE','predicted':mean,'quantiles':qs,'variance':var,'actual':actual,'actualSource':source_actual,'historyGames':len(hist),'coldStart':len(hist)==0,'forecastType':'causal_replay','rostered':pid in model_ids.values(),'rankingEligible':bool(opp),'observedGame':len(actualrow)>0}
  rows_this.append(rowout)
 for team,opp in schedule.items():
  hist=dst[dst.team.eq(team)].sort_values(['season','week']);cur=hist[hist.season.eq(2026)];g=cur if len(cur) else hist[hist.season.eq(hist.season.max())];row=hist.iloc[-1].to_dict();row.update({'week':week,'season':2026,'games_prev':len(g)})
  for field,source_col in [('points','points'),('sacks','def_sacks'),('pa','points_allowed'),('yards_allowed','yards_allowed')]:
   row['prev_'+field]=float(g[source_col].iloc[-1]);row['roll4_'+field]=float(g[source_col].tail(4).mean());row['season_'+field+'_avg']=float(g[source_col].mean())
  row['prev_takeaways']=float((g.def_interceptions+g.def_fumbles).iloc[-1]);row['roll4_takeaways']=float((g.def_interceptions+g.def_fumbles).tail(4).mean());og=dst[dst.team.eq(opp)&dst.season.eq(2026)];row['opp_roll4_points']=float(og.opponent_points.tail(4).mean()) if len(og) else 21;row['opp_season_points']=float(og.opponent_points.mean()) if len(og) else 21
  mean,qs,var=predict(packs['DST'],m.DEF_FEATURES,row);name=m.TEAM_NAMES[team]+' D/ST';a=actual_map.get((m.norm(name),week));rows_this.append({'week':week,'name':name,'playerId':team,'position':'DST','team':team,'opponent':opp,'predicted':mean,'quantiles':qs,'variance':var,'actual':a,'actualSource':'ESPN league-scored actual' if a is not None else 'not recorded','coldStart':False,'forecastType':'causal_replay','rostered':team in model_ids.values(),'rankingEligible':True,'observedGame':True})
 # Rank BEFORE looking at the outcome. Missing actuals remain in the denominator and are reported.
 ranked=sorted([r for r in rows_this if r['rankingEligible']],key=lambda r:(-r['predicted'],r['name']))
 for rank,r in enumerate(ranked,1):r['rank']=rank
 flex=sorted([r for r in rows_this if r['rankingEligible'] and r['position'] in ['RB','WR','TE']],key=lambda r:(-r['predicted'],r['name']))
 for rank,r in enumerate(flex,1):r['flexRank']=rank
 all_rows.extend(rows_this)
 (OUT/f'replay-week{week}.json').write_text(json.dumps(rows_this,indent=2))
 print(f'Week {week}: {len(rows_this)} forecast rows complete',flush=True)

# Only Week 5 has a complete pregame archived candidate package; do not backfill its labels.
archive=json.loads((ROOT/'artifacts/week5-2026-scout/week5-player-forecasts.json').read_text());archive_manifest=json.loads((ROOT/'artifacts/week5-2026-scout/manifest.json').read_text());archived=[]
for p in roster:
 f=next((f for f in archive if m.norm(f['name'])==m.norm(p['name'])),None)
 if not f:continue
 a=own_actual.get((p['name'],5));qs=f['quantiles'];archived.append({'week':5,'name':p['name'],'position':p['position'],'predicted':f['mean'],'quantiles':qs,'actual':a,'actualSource':'ESPN league-scored actual' if a is not None else 'not recorded','forecastType':'archived_before_kickoff','builtAt':archive_manifest['built_at'],'rostered':True})
# Verified immutable snapshots take precedence over legacy saved artifacts for that week.
verified_path=ROOT/'data/scout/verified-forecast-archives.json'
if verified_path.exists():
 snapshots=json.loads(verified_path.read_text());chosen={}
 for a in snapshots:
  if a['season']==2026 and a['week']<=last:
   if a['week'] not in chosen or a['recordedAt']>chosen[a['week']]['recordedAt']:chosen[a['week']]=a
 for w,a in sorted(chosen.items()):
  archived=[r for r in archived if r['week']!=w]
  for p in roster:
   f=next((v for v in a['forecasts'] if m.norm(v['name'])==m.norm(p['name'])),None)
   if f:archived.append({'week':w,'name':p['name'],'position':p['position'],'predicted':f['mean'],'quantiles':f['quantiles'],'actual':own_actual.get((p['name'],w)),'actualSource':'ESPN league-scored actual' if (p['name'],w) in own_actual else 'not recorded','forecastType':'archived_before_kickoff','builtAt':a['modelManifest']['builtAt'],'recordedAt':a['recordedAt'],'archiveSha256':a['sha256'],'rostered':True})
roster_rows=[]
for p in roster:
 for week in range(1,last+1):
  r=next((r for r in all_rows if r['week']==week and r['playerId']==model_ids[p['name']]),None)
  if not r:missing.append({'name':p['name'],'week':week,'reason':'No identifiable forecast row'});continue
  r={**r,'name':p['name']};actual=own_actual.get((p['name'],week));
  if actual is not None:r['actual']=actual;r['actualSource']='ESPN league-scored actual'
  if r['opponent']=='BYE' and r['actual'] is None:r['actual']=0;r['actualSource']='Scheduled bye; structurally zero'
  roster_rows.append(r)

# In-sample historic training cohorts use the same pregame-output rank rule, clearly marked in-sample.
training_df=pd.DataFrame(training_rows);training_df['rank']=training_df.groupby(['evaluationWeek','season','week'])['mean'].rank(method='first',ascending=False)
training_summary=[]
for week in range(1,last+1):
 for size in [50,150]:
  f=training_df[(training_df.evaluationWeek==week)&training_df['rank'].le(size)];err=f['mean']-f.actual
  training_summary.append({'week':week,'cohort':size,'n':len(f),'mae':float(abs(err).mean()),'rmse':float(np.sqrt((err**2).mean())),'residualSD':float(err.std()),'coverage80':float(((f.actual>=f.q10)&(f.actual<=f.q90)).mean())})
payload={'season':2026,'completedWeeks':list(range(1,last+1)),'roster':[{'name':p['name'],'position':p['position']} for p in roster],'replay':all_rows,'rosterRows':roster_rows,'archived':archived,'training':training_summary,'trainingByPosition':training_diagnostics,'scoringAudit':scoring_audit,'missing':missing,'provenance':{'sourceSha256':m.sha(source),'sourceGamesSha256':m.sha(games_path),'rosterReadAt':live['readAt'],'archiveBuiltAt':archive_manifest['built_at'],'rankDefinition':'Pregame model mean, all eligible observed-season identities; no outcome-based ranking','rankUniverse':'Current-season observed identities, not an archived pregame roster/inactive universe. Conditional participation models lack historical injury/role inputs. Missing actuals remain counted, never silently set to zero.','cutoffRule':'2015–2025 plus 2026 weeks strictly before each target; features built only from that past dataset.','replayNote':'Reconstructed weekly forecasts, not forecasts issued at the time. Week 1 uses prior-season usage; zero-history rookies use position priors. Week 5 saved forecasts are evaluated separately.','modelStatus':'Isolated evaluation; production artifacts and approved model state unchanged','dstTargetRepair':'Recovered opponent fumbles credited; opponent fumble-loss penalty removed; recovered-fumble TDs and defensive-score exclusions corrected. Captured 2026 ESPN stat counts independently rescored; 2015-2025 historical component parity is incomplete.','dstTargetSourceSha256':m.sha(ROOT/'data/scout/espn-dst-targets.json'),'modelCodeSha256':m.sha(ROOT/'python/scout/weekly_scout.py'),'featureLimit':'Inherited matchup-feature conventions; replay is an audit of the weekly model family, not a reconstruction of historical betting lines, roles or injury decisions.'}}
(OUT/'evaluation-data.json').write_text(json.dumps(payload,indent=2));print('Evaluation data saved',flush=True)

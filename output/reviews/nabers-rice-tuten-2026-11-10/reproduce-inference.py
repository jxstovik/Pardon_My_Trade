import os, sys, json, ast, textwrap
from pathlib import Path
os.environ['PMT_SCOUT_WEEK']='10'
os.environ['PMT_NFLVERSE_DATA_DIR']=str(Path.cwd()/'data/nflverse')
sys.path.insert(0,str(Path.cwd()/'python/scout'))
import weekly_scout as m
import pandas as pd
import numpy as np
out=Path('output/reviews/nabers-rice-tuten-2026-11-10');out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((m.OUT/'manifest.json').read_text())
assert m.sha(m.STATS26)==manifest['sourceSha256']['stats']
assert m.sha(m.GAMES)==manifest['sourceSha256']['games']
assert m.sha(Path(m.__file__))==manifest['modelCodeSha256']
stats=m.load_weekly();games=pd.read_csv(m.GAMES,low_memory=False)
coverage=m.validate_completed_coverage(stats,games)
off=m.make_offense_features(stats)
# Execute the unchanged candidate's as-of feature construction, without main's training or writes.
source=Path(m.__file__).read_text(); tree=ast.parse(source)
main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
start=next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='off_latest' for t in n.targets))
end=next(i for i in range(start+1,len(main.body)) if isinstance(main.body[i],ast.Assign) and any(isinstance(t,ast.Name) and t.id=='off_latest' for t in main.body[i].targets))
env={**vars(m),'off':off}
exec(compile(ast.Module(body=main.body[start:end+1],type_ignores=[]),m.__file__,'exec'),env)
latest=env['off_latest'];schedule=m.schedule_map(games)
packs={pos:{key:m.lgb.Booster(model_file=str(m.OUT/f'{pos.lower()}_{key}.txt')) for key in ['final_mean']+[f'final_q{int(q*100):02d}' for q in m.Q_LEVELS]} for pos in ['RB','WR']}
league=json.load(open('output/pdf/week10-scout/league-input.json'))
runtime={p['playerId']:p for p in json.load(open('data/models.json'))['models']}
forecasts=[]; missing=[]
for team in league['league']['teams']:
 if team['team_id'] not in ['1','7']:continue
 for group in ['starters','bench','injured_reserve']:
  for slot in team['roster'][group]:
   p=runtime.get(slot['player_id'])
   if not p or p['position'] not in ['RB','WR']:continue
   rows=latest[(latest.position==p['position'])&(latest.player_display_name.map(m.norm)==m.norm(m.ALIASES.get(p['playerName'],p['playerName'])))]
   if rows.empty and p['playerName'].endswith(' Jr.'):rows=latest[(latest.position==p['position'])&(latest.player_display_name.map(m.norm)==m.norm(p['playerName'][:-4]))]
   if rows.empty or rows.player_id.nunique()!=1:
    missing.append(p['playerName']);continue
   r=rows.iloc[-1]
   f=m.player_forecast(r.player_id,p['position'],r.team,schedule.get(r.team),packs,latest,{},pd.DataFrame(),roster_name=p['playerName'])
   f.update(espnId=p['playerId'],teamId=team['team_id'],available=False)
   forecasts.append(f)
# Identity and feature parity check against previously published forecasts.
saved={f['name']:f for f in json.load(open(m.OUT/'player-forecasts.json'))}
parity={f['name']:abs(f['mean']-saved[f['name']]['mean']) for f in forecasts if f['name'] in saved and saved[f['name']].get('status')=='—' and not saved[f['name']].get('bye')}
assert max(parity.values())<1e-8,parity
h=m.forecast_horizon(forecasts,games,latest,pd.DataFrame(),off,pd.DataFrame(columns=['season','week']),packs,{},m.FEATURES,m.DEF_FEATURES,10,9)
hm={p['playerId']:p for p in h['players']}
for f in forecasts:
 f['horizon']=hm[f['espnId']]['weeks']
 f['weeks10_17']=sum(p['mean'] for p in f['horizon'] if p['week']<=17)
 f['weeks15_17']=sum(p['mean'] for p in f['horizon'] if 15<=p['week']<=17)
result={'modelVersion':manifest['modelVersion'],'builtAt':manifest['builtAt'],'cutoffWeek':9,'status':manifest['status'],'coverage':coverage,'parity':parity,'rosterReadAt':league['readAt'],'health':'All-player active-state inference; no new live health read. Horizon assumes healthy, frozen role.','missing':missing,'forecasts':forecasts,'horizonLimitations':h['limitations']}
(out/'model-comparison.json').write_text(json.dumps(result,indent=2))
for f in forecasts:print(json.dumps({k:f[k] for k in ['name','teamId','mean','q10','q90','weeks10_17','weeks15_17']}),flush=True)
print('PARITY',parity,'MISSING',missing)

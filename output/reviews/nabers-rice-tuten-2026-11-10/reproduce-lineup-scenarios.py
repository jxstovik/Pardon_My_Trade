import ast,json
from pathlib import Path
out=Path('output/reviews/nabers-rice-tuten-2026-11-10')
c=json.loads((out/'model-comparison.json').read_text());live=json.loads((out/'live-rosters.json').read_text())
saved=json.load(open('artifacts/week10-2026-scout/player-forecasts.json'))
orig_h=json.load(open('artifacts/week10-2026-scout/waiver-horizon.json'))
print('horizon player',str(orig_h['players'][0])[:120])
by={f['name']:f for f in saved};by.update({f['name']:f for f in c['forecasts']})
health={p['name']:p.get('status','ACTIVE') for t in live['teams'] for p in t['players']}
mapstatus={'ACTIVE':'—','QUESTIONABLE':'Q','OUT':'O','INJURY_RESERVE':'IR','DOUBTFUL':'D'}
own=[p['name'] for t in live['teams'] if t['id']=='7' for p in t['players']]
hmap={p['playerId']:p['weeks'] for p in orig_h['players']}
func=next(n for n in ast.parse(Path('scripts/scout_report_helpers.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='recommend')
ns={'SLOTS':['QB','RB1','RB2','WR1','WR2','TE','FLEX','D/ST','K']};exec(compile(ast.Module(body=[func],type_ignores=[]),'existing-lineup-optimizer','exec'),ns)
def evaluate(remove,add,week):
 names=[n for n in own if n not in remove]+add;players=[]
 for n in names:
  p=dict(by[n]);p['status']=mapstatus.get(health.get(n),'—');p['group']='bench'
  if week!=10:
   weeks=p.get('horizon') or hmap[str(p['espnId'])]
   v=next(x for x in weeks if x['week']==week)
   p['mean']=v['mean'];p['bye']=not v['playing']
  else:p['bye']=p.get('opponent')=='BYE'
  players.append(p)
 team={'players':players,'currentLineup':{}}
 lineup=ns['recommend'](team);ix={p['name']:p for p in players}
 return {'week':week,'mean':sum(ix[n]['mean'] for n in lineup.values() if n),'lineup':lineup}
scenarios={
 'keep':([],[]),
 'original_offer':(['Malik Nabers'],['Rashee Rice','Bhayshul Tuten']),
 'counter_gibbs_rice_for_nabers_pollard':(['Malik Nabers','Tony Pollard'],['Jahmyr Gibbs','Rashee Rice']),
 'gibbs_for_nabers':(['Malik Nabers'],['Jahmyr Gibbs']),
 'london_tuten_for_nabers':(['Malik Nabers'],['Drake London','Bhayshul Tuten']),
 'rice_gordon_for_nabers':(['Malik Nabers'],['Rashee Rice','Ollie Gordon II'])}
results={}
for label,(remove,add) in scenarios.items():
 rows=[evaluate(remove,add,w) for w in range(10,18)]
 results[label]={'weeks':rows,'weeks10_17':sum(r['mean'] for r in rows),'weeks15_17':sum(r['mean'] for r in rows if r['week']>=15)}
for label,r in results.items():
 r['week10_delta']=r['weeks'][0]['mean']-results['keep']['weeks'][0]['mean'];r['weeks10_17_delta']=r['weeks10_17']-results['keep']['weeks10_17'];r['weeks15_17_delta']=r['weeks15_17']-results['keep']['weeks15_17']
 print(label,json.dumps({k:v for k,v in r.items() if k!='weeks'}));print(r['weeks'][0])
assert abs(results['keep']['weeks'][0]['mean']-111.29676462164896)<1e-8
(out/'lineup-scenarios.json').write_text(json.dumps({'scenarios':results,'limitations':'Existing PMT lineup optimizer, frozen-role horizon through Week 17; current O/IR/D excluded, Q conditional on active. No future injury or role prediction; horizon unvalidated. No platform validation or writes.'},indent=2))

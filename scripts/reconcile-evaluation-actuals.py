import json,re
from pathlib import Path
import numpy as np
OUT=Path('output/evaluation/2026-model-performance');D=json.loads((OUT/'evaluation-data.json').read_text());L=json.loads((OUT/'live-input.json').read_text())
def norm(s):return re.sub('[^a-z0-9]','',s.lower()).removesuffix('jr')
look={};ids={}
for a in L['leagueActuals']:
 key=(norm(a['name']),a['week']);ids.setdefault(key,set()).add(a['espnId']);look[key]=a['actual']
look={k:v for k,v in look.items() if len(ids[k])==1};own={(p['name'],a['week']):a['actual'] for p in L['roster'] for a in p['stats']};audit={}
for a in D['scoringAudit']:audit[(a['name'],a['week'])]=a
for r in D['replay']:
 if r['actualSource']=='NFLverse league-compatible target':r['nflverseActual']=r['actual']
 value=look.get((norm(r['name']),r['week']))
 if value is not None:
  if r.get('nflverseActual') is not None:audit[(r['name'],r['week'])]={'name':r['name'],'week':r['week'],'position':r['position'],'nflverse':r['nflverseActual'],'espn':value,'difference':value-r['nflverseActual']}
  r['actual']=value;r['actualSource']='ESPN league-scored actual'
for r in D['rosterRows']+D['archived']:
 value=own.get((r['name'],r['week']))
 if value is not None:r['actual']=value;r['actualSource']='ESPN league-scored actual'
 if r['forecastType']=='archived_before_kickoff':
  q=sorted((float(k)/100,v) for k,v in r['quantiles'].items());u=np.linspace(0,1,4000);r['variance']=float(np.var(np.interp(u,[x for x,_ in q],[v for _,v in q])))
D['scoringAudit']=list(audit.values());D['provenance']['actualHistory']='ESPN player-card season history; all 80 current-roster player-week actuals available. Cohort missing coverage reported separately.';(OUT/'evaluation-data.json').write_text(json.dumps(D,indent=2));print('Updated actuals without retraining or changing forecasts.')

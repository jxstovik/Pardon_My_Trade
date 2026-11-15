import importlib.util,json,pandas as pd
from pathlib import Path
p=Path('python/scout/weekly_scout.py');s=importlib.util.spec_from_file_location('m',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=pd.read_csv('output/evaluation/2026-model-performance/source-stats-2026.csv',low_memory=False);g=pd.read_csv('output/evaluation/2026-model-performance/source-games.csv',low_memory=False);g=g[(g.season==2026)&(g.week<=5)];d=m.dst_team_games(r,g);a=json.load(open('output/evaluation/2026-model-performance/live-input.json'));lookup={(m.norm(x['name']),x['week']):x['actual'] for x in a['leagueActuals']};out=[]
for _,x in d.iterrows():
 name=m.TEAM_NAMES[x.team]+' D/ST';actual=lookup.get((m.norm(name),int(x.week)))
 if actual is not None:out.append({'name':name,'week':int(x.week),'modelTrainingTarget':float(x.points),'espnActual':actual,'difference':actual-float(x.points),'opponentFumblesLost':float(x.off_fumbles_lost),'nflverseReconstruction':float(x.nflverse_points),'targetSource':x.target_source})
Path('output/evaluation/2026-model-performance/dst-target-audit.json').write_text(json.dumps(out,indent=2));print(out[:10]);print('mismatch',sum(abs(x['difference'])>.001 for x in out),'of',len(out))

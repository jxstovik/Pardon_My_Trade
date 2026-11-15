import csv,json
from pathlib import Path
p=Path(__file__).parent
week=json.loads((p/'preflight.json').read_text())['week'];cutoff=week-1
m=json.loads(Path(f'artifacts/week{week}-2026-scout/manifest.json').read_text())
g=[r for r in csv.DictReader(open('data/nflverse/games.csv')) if r['season']=='2026' and r['game_type']=='REG' and int(r['week'])<=cutoff]
s=[r for r in csv.DictReader(open('data/nflverse/stats_player_week_2026.csv')) if r['season']=='2026' and r['season_type']=='REG' and int(r['week'])<=cutoff and r['position'] in ('QB','RB','WR','TE','K') and (r['position']=='K' or r['fantasy_points_ppr'])]
ids=sorted({r['game_id'] for r in g});observed={r['game_id'] for r in s}
assert all(r['home_score'] and r['away_score'] for r in g)
assert ids==m['completedOutcomeCoverage']['gameIds']
assert set(ids)<=observed
assert len(s)==m['completedOutcomeCoverage']['currentSeasonStatsRows']
r={'requestedWeek':week,'latestCompletedWeek':cutoff,'publishedGames':len(g),'cutoffWeekGames':sum(int(r['week'])==cutoff for r in g),'modeledInputRows':len(s),'maxObservedWeek':max(int(r['week']) for r in s),'missingGameIds':sorted(set(ids)-observed),'futureRowsExcluded':True,'allPublishedGamesCompleted':True,'gameIds':ids}
(p/'independent-training-coverage.json').write_text(json.dumps(r,indent=2))
print({k:v for k,v in r.items() if k!='gameIds'})

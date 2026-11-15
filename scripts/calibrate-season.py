from pathlib import Path
import json,sys,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python/scout'))
from calibration import chronological_calibration
out=Path('output/evaluation/2026-model-performance');data=json.loads((out/'evaluation-data.json').read_text());rows,fits=chronological_calibration(data['replay'])
def metrics(rows):
    a=[r for r in rows if r.get('actual') is not None];n=len(a)
    return {'n':n,'mae':sum(abs(r['predicted']-r['actual']) for r in a)/n,'coverage80':sum(r['quantiles']['10']<=r['actual']<=r['quantiles']['90'] for r in a)/n,'meanIntervalWidth':sum(r['quantiles']['90']-r['quantiles']['10'] for r in a)/n}
comparisons=[]
for size in [50,150]:
    for weeks,label in [(list(range(2,max(data['completedWeeks'])+1)),'rolling_W2_onward'),([max(data['completedWeeks'])],'final_week_holdout')]:
        selected=[r for r in rows if r['rank']<=size and r['week'] in weeks];before=[{**r,'quantiles':r['uncalibratedQuantiles']} for r in selected]
        comparisons.append({'cohort':size,'scope':label,'weeks':weeks,'before':metrics(before),'after':metrics(selected)})
manifest={'candidateVersion':'conformal-rank-bands-v1-'+hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()[:16],'status':'candidate_not_promoted','method':'Non-shrinking conformalized quantile intervals; ceil((n+1)*0.8) nonconformity order statistic','grouping':'Pregame mean ranks 1-50 and 51-150; no outcome-based cohort selection','cutoffRule':'Each target week uses only completed earlier replay weeks. Week 1 remains unchanged. Final completed week is never used to fit its own interval correction.','sourceSha256':hashlib.sha256((out/'evaluation-data.json').read_bytes()).hexdigest(),'fits':fits,'comparisons':comparisons,'limitations':['Five completed weeks; only four rolling calibration test weeks','Dependent player-week samples and drift: finite-sample exchangeability guarantee does not apply','Historical replay identity and availability limitations remain','D/ST representation in ranked cohorts is too small to validate defense-specific calibration','Promotion requires human request and PMT gates; this workflow never promotes']}
(out/'calibration-manifest.json').write_text(json.dumps(manifest,indent=2));data['calibrated']=rows;data['calibration']=manifest;(out/'evaluation-data.json').write_text(json.dumps(data,indent=2));print(json.dumps(comparisons,indent=2))

"""Non-shrinking conformal interval adjustment fit only on earlier replay outcomes.

Finite-sample order statistic ceil((n+1)*coverage). Coverage guarantees require
exchangeability; football player-week dependence and season drift violate that
assumption, so chronological measured coverage is reported instead of promised.
"""
import math
import numpy as np

def conformal_offset(rows, coverage=.8):
    scores=sorted(max(r['quantiles']['10']-r['actual'],r['actual']-r['quantiles']['90'],0.) for r in rows if r.get('actual') is not None)
    k=math.ceil((len(scores)+1)*coverage)
    if not scores or k>len(scores):
        return None
    return float(scores[k-1])

def expand_quantiles(quantiles, offset):
    # Preserve the mean/median and order. q10/q90 expand by the fitted offset;
    # outer quantiles expand proportionally, avoiding crossing at the tails.
    return {p:float(v+offset*(float(p)/100-.5)/.4) for p,v in quantiles.items()}

def chronological_calibration(rows):
    output=[];fits=[]
    for week in sorted({r['week'] for r in rows}):
        for label,lo,hi in [('top50',0,50),('rank51to150',50,150)]:
            prior=[r for r in rows if r['week']<week and lo<r.get('rank',100000)<=hi and r.get('actual') is not None]
            offset=conformal_offset(prior)
            fits.append({'week':week,'band':label,'calibrationWeeks':sorted({r['week'] for r in prior}),'n':len(prior),'offset':offset,'status':'prior_outcomes_only' if offset is not None else 'insufficient_prior_outcomes'})
            for r in rows:
                if r['week']!=week or not lo<r.get('rank',100000)<=hi:continue
                new={**r,'uncalibratedQuantiles':r['quantiles'],'calibrationBand':label,'calibrationOffset':offset,'calibrationMaxWeek':max((p['week'] for p in prior),default=0),'forecastType':'calibrated_causal_replay'}
                new['quantiles']=expand_quantiles(r['quantiles'],offset) if offset is not None else dict(r['quantiles'])
                pairs=sorted((float(k)/100,v) for k,v in new['quantiles'].items());draw=np.interp(np.linspace(0,1,4000),[k for k,v in pairs],[v for k,v in pairs]);new['variance']=float(np.var(draw));output.append(new)
    return output,fits

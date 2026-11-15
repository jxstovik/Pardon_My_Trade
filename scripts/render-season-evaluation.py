from pathlib import Path
import json,math,csv,zipfile
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Image,PageBreak,Table,TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from xml.sax.saxutils import escape
ROOT=Path.cwd();OUT=ROOT/'output/evaluation/2026-model-performance';D=json.loads((OUT/'evaluation-data.json').read_text());R=D['replay'];OWN=D['rosterRows'];ARCH=D['archived'];COLORS={'QB':'#2463a0','RB':'#d56c27','WR':'#0d8066','TE':'#9361a6','K':'#666666','DST':'#ae4047'}
archive_weeks=sorted({r['week'] for r in ARCH});archive_label='Saved pregame forecasts (Weeks '+', '.join(map(str,archive_weeks))+')';completed_label='Weeks 1-'+str(max(D['completedWeeks']))
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False,'axes.titleweight':'bold','figure.facecolor':'white','axes.grid':True,'grid.alpha':.16})
def score_rows(rows):return [r for r in rows if r.get('actual') is not None]
def cohort(size,week=None,flex=False):return [r for r in R if (week is None or r['week']==week) and r.get('flexRank' if flex else 'rank',100000)<=size]
def boot_ci(values):
 a=np.asarray(values,dtype=float)
 if not len(a):return [None,None]
 rng=np.random.default_rng(642026);b=np.mean(rng.choice(a,(1000,len(a)),replace=True),axis=1);return list(map(float,np.quantile(b,[.025,.975])))
def metrics(rows):
 valid=score_rows(rows)
 if not valid:return {'n':0,'selected':len(rows),'missing':len(rows),'mae':None}
 e=np.array([r['predicted']-r['actual'] for r in valid]);covered=np.array([r['quantiles']['10']<=r['actual']<=r['quantiles']['90'] for r in valid]);width=np.array([r['quantiles']['90']-r['quantiles']['10'] for r in valid]);mean_errors=np.abs(e)
 return {'n':len(valid),'selected':len(rows),'missing':len(rows)-len(valid),'mae':float(mean_errors.mean()),'rmse':float(np.sqrt(np.mean(e**2))),'bias':float(e.mean()),'residualSD':float(e.std(ddof=1)) if len(e)>1 else 0,'coverage80':float(covered.mean()),'meanIntervalWidth':float(width.mean()),'maeCI95':boot_ci(mean_errors),'meanPredictiveSD':float(np.mean([math.sqrt(r.get('variance',0)) for r in valid]))}
S={'overall':{},'weekly':[],'positions':[],'roster':{},'archived':metrics(ARCH),'training':D['training']}
for size in [50,150]:
 for flex in [False,True]:
  key=f"{'flex' if flex else 'all'}_top{size}";S['overall'][key]=metrics(cohort(size,flex=flex))
  for week in D['completedWeeks']:S['weekly'].append({'cohort':size,'flex':flex,'week':week,**metrics(cohort(size,week,flex))})
 for pos in COLORS:S['positions'].append({'cohort':size,'position':pos,**metrics([r for r in cohort(size) if r['position']==pos])})
for p in D['roster']:S['roster'][p['name']]=metrics([r for r in OWN if r['name']==p['name']])
S['rosterOverall']=metrics(OWN)
if D.get('calibration'):S['calibration']=D['calibration']
audit=json.loads((OUT/'dst-target-audit.json').read_text()) if (OUT/'dst-target-audit.json').exists() else []
S['targetAudit']={'dstRows':len(audit),'dstMismatches':sum(abs(r['difference'])>1e-6 for r in audit),'dstMAE':float(np.mean([abs(r['difference']) for r in audit])) if audit else None,'offenseRows':len(D['scoringAudit']),'offenseMismatches':sum(abs(r['difference'])>1e-5 for r in D['scoringAudit'])}
S['targetAudit']['historicalLimit']='2015-2025 corrected reconstruction; complete ESPN component parity is verified only for captured 2026 records.'
(OUT/'summary.json').write_text(json.dumps(S,indent=2));(OUT/'evaluation-data.json').write_text(json.dumps({**D,'summary':S},indent=2))

def scatter(rows,title,path,archive=False):
 fig,ax=plt.subplots(figsize=(9,8));rows=score_rows(rows);maximum=max([r['actual'] for r in rows]+[r['quantiles']['90'] for r in rows]+[35]);minimum=min([r['actual'] for r in rows]+[r['quantiles']['10'] for r in rows]+[-3]);ax.plot([minimum,maximum],[minimum,maximum],'--',color='#333',lw=1.4,label='Perfect prediction (45 degrees)')
 for pos,color in COLORS.items():
  v=[r for r in rows if r['position']==pos]
  if not v:continue
  for r in v:ax.plot([r['actual'],r['actual']],[r['quantiles']['10'],r['quantiles']['90']],color=color,alpha=.16,lw=.7)
  ax.scatter([r['actual'] for r in v],[r['predicted'] for r in v],s=18,c=color,alpha=.64,label=f'{pos} (n={len(v)})',edgecolors='none')
 if archive:
  v=score_rows(ARCH);ax.scatter([r['actual'] for r in v],[r['predicted'] for r in v],c='#c89410',marker='D',s=55,edgecolors='#624902',label='Saved pregame forecasts')
 ax.set(xlim=(minimum-1,maximum+1),ylim=(minimum-1,maximum+1),xlabel='Actual fantasy points',ylabel='Predicted mean and 80% predictive interval',title=title);ax.set_aspect('equal',adjustable='box');ax.legend(fontsize=9,loc='upper left');fig.text(.12,.015,'Above line: overprediction. Below line: underprediction. Whiskers are predictive intervals, not confidence in the mean.',fontsize=8);fig.tight_layout(rect=(0,.035,1,1));fig.savefig(OUT/path,dpi=180);plt.close(fig)
for size in [50,150]:
 scatter(cohort(size),f'Top {size} by pregame model mean - {completed_label}',f'top{size}-45-degree.png');scatter(cohort(size,flex=True),f'FLEX top {size} - {completed_label}',f'flex-top{size}-45-degree.png')
scatter(OWN,'Your current roster: replay and saved forecasts','roster-45-degree.png',True)

fig,axs=plt.subplots(2,1,figsize=(11,8),sharex=True)
for size,color in [(50,'#2463a0'),(150,'#0d8066')]:
 v=[s for s in S['weekly'] if s['cohort']==size and not s['flex']];x=np.array([r['week'] for r in v]);y=np.array([r['mae'] for r in v]);ci=np.array([r['maeCI95'] for r in v]);axs[0].errorbar(x,y,yerr=[y-ci[:,0],ci[:,1]-y],color=color,marker='o',capsize=4,label=f'Top {size}');axs[1].plot(x,[r['coverage80']*100 for r in v],color=color,marker='o',label=f'Top {size}')
axs[0].set(ylabel='Mean absolute error (points)',title='Weekly forward-test accuracy - whiskers: 95% bootstrap CI');axs[0].legend();axs[1].axhline(80,color='#333',ls='--',label='80% nominal coverage');axs[1].set(ylabel='Actual scores within interval (%)',xlabel='Completed 2026 week',ylim=(0,100));axs[1].legend();axs[1].set_xticks(D['completedWeeks']);fig.tight_layout();fig.savefig(OUT/'weekly-accuracy-calibration.png',dpi=180);plt.close(fig)

fig,axs=plt.subplots(1,2,figsize=(13,5.5))
for size,color in [(50,'#2463a0'),(150,'#0d8066')]:
 tr=[r for r in D['training'] if r['cohort']==size];te=[r for r in S['weekly'] if r['cohort']==size and not r['flex']];axs[0].plot([r['week'] for r in tr],[r['mae'] for r in tr],ls='--',color=color,label=f'Top {size}: in-sample train');axs[0].plot([r['week'] for r in te],[r['mae'] for r in te],marker='o',color=color,label=f'Top {size}: forward test');offset=-.07 if size==50 else .07;axs[1].errorbar(np.array([r['week'] for r in te])+offset,[r['bias'] for r in te],yerr=[r['residualSD'] for r in te],color=color,capsize=4,marker='o',label=f'Top {size}: mean error +/- 1 SD')
axs[0].set(title='Training vs genuinely later outcomes',xlabel='Replay iteration / target week',ylabel='Mean absolute error');axs[1].axhline(0,color='#333',ls='--');axs[1].set(title='Variation of realized prediction errors',xlabel='Completed week',ylabel='Predicted minus actual points');
for ax in axs:ax.legend(fontsize=8);ax.set_xticks(D['completedWeeks'])
fig.tight_layout();fig.savefig(OUT/'training-and-error-variation.png',dpi=180);plt.close(fig)

fig,axes=plt.subplots(2,1,figsize=(11,8));positions=list(COLORS);x=np.arange(len(positions))
for size,color,shift in [(50,'#2463a0',-.18),(150,'#0d8066',.18)]:
 vals=[next(v for v in S['positions'] if v['cohort']==size and v['position']==pos) for pos in positions]
 axes[0].bar(x+shift,[v['mae'] if v['mae'] is not None else np.nan for v in vals],width=.34,color=color,label=f'Top {size}')
 for xx,v in zip(x+shift,vals):
  if v['mae'] is not None:axes[0].text(xx,v['mae']+.12,f"n={v['n']}",ha='center',fontsize=8)
 axes[1].bar(x+shift,[v.get('coverage80',np.nan)*100 for v in vals],width=.34,color=color,label=f'Top {size}')
axes[0].set(title='Performance by position in the ranked cohorts',ylabel='Mean absolute error (points)');axes[1].set(ylabel='80% interval coverage (%)',ylim=(0,100));axes[1].axhline(80,color='#333',ls='--',label='80% nominal');
for ax in axes:ax.set_xticks(x,positions);ax.legend()
fig.text(.08,.012,'Missing bars mean no scored observations in that cohort. Historical D/ST component parity remains incomplete.',fontsize=9);fig.tight_layout(rect=(0,.035,1,1));fig.savefig(OUT/'position-breakdowns.png',dpi=180);plt.close(fig)

for page in [0,1]:
 names=[p['name'] for p in D['roster']][page*8:(page+1)*8];fig,axes=plt.subplots(4,2,figsize=(11,13),sharex=True)
 for ax,name in zip(axes.flat,names):
  v=sorted([r for r in OWN if r['name']==name],key=lambda r:r['week']);x=[r['week'] for r in v];pred=np.array([r['predicted'] for r in v]);q10=[r['quantiles']['10'] for r in v];q90=[r['quantiles']['90'] for r in v];actual=[r['actual'] if r['actual'] is not None else np.nan for r in v];ax.fill_between(x,q10,q90,color='#2463a0',alpha=.18);ax.plot(x,pred,color='#2463a0',marker='o',label='Replay mean');ax.plot(x,actual,color='#d56c27',marker='o',label='Actual');arch=[r for r in ARCH if r['name']==name];
  if arch:ax.scatter([r['week'] for r in arch],[r['predicted'] for r in arch],marker='D',color='#b88608',s=40,zorder=5,label='Archived prediction')
  ax.set_title(name,fontsize=11);ax.set_xticks(D['completedWeeks']);ax.set_ylabel('Points');ax.tick_params(labelbottom=True);ax.set_xlabel('Week')
 fig.suptitle(f'Your current roster - weekly predicted vs actual ({page+1}/2)',fontsize=15);handles=[Line2D([],[],color='#2463a0',label='Replay mean; blue band = 80% interval'),Line2D([],[],color='#d56c27',label='Actual (gaps = unavailable record)'),Line2D([],[],marker='D',color='#b88608',linestyle='',label='Saved pregame prediction')];fig.legend(handles=handles,loc='lower center',ncol=1,fontsize=10);fig.tight_layout(rect=(0,.065,1,.96));fig.savefig(OUT/f'roster-weekly-{page+1}.png',dpi=180);plt.close(fig)

if D.get('calibration'):
 fig,axs=plt.subplots(2,1,figsize=(11,8),sharex=True)
 for size,color in [(50,'#2463a0'),(150,'#0d8066')]:
  for calibrated,ls in [(False,'--'),(True,'-')]:
   values=[]
   for week in D['completedWeeks'][1:]:
    rows=[r for r in D['calibrated'] if r['week']==week and r['rank']<=size]
    if not calibrated:rows=[{**r,'quantiles':r['uncalibratedQuantiles']} for r in rows]
    values.append(metrics(rows))
   xs=D['completedWeeks'][1:];label=f'Top {size} '+('calibrated' if calibrated else 'original')
   axs[0].plot(xs,[v['coverage80']*100 for v in values],color=color,ls=ls,marker='o',label=label)
   axs[1].plot(xs,[v['meanIntervalWidth'] for v in values],color=color,ls=ls,marker='o',label=label)
 axs[0].axhline(80,color='#333',ls=':',label='80% nominal');axs[0].set(ylabel='Actual interval coverage (%)',ylim=(40,100),title='Earlier-week calibration tested on later weeks');axs[0].legend(fontsize=9,ncol=2)
 axs[1].set(ylabel='Mean 80% interval width (points)',xlabel='Holdout week');axs[1].set_xticks(D['completedWeeks'][1:]);fig.tight_layout();fig.savefig(OUT/'chronological-calibration.png',dpi=180);plt.close(fig)
 scatter([r for r in D['calibrated'] if r['rank']<=50 and r['week']>1],'Calibrated top 50 - chronological Weeks 2 onward','calibrated-top50-45-degree.png')

fields=['forecastType','name','position','week','predicted','q10','q90','actual','error','variance','rank','flexRank','actualSource','coldStart']
with (OUT/'player-week-results.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
 for r in R+ARCH:writer.writerow({k:(r.get(k) if k not in ['q10','q90','error'] else r['quantiles']['10'] if k=='q10' else r['quantiles']['90'] if k=='q90' else r['predicted']-r['actual'] if r.get('actual') is not None else '') for k in fields})

fmt=lambda x:'N/A' if x is None else f'{x:.2f}'
md=f'# 2026 season model-performance audit\n\nCompleted {completed_label}. **Replay forecasts are reconstructed, not issued at the time.** Saved pregame forecasts are evaluated separately. This tracks today’s roster retrospectively; it does not imply you owned every player every week.\n\n## Cohort results\n\nTop 50 and top 150 are selected each week by pregame model mean, not actual scoring. The all-position and FLEX-only versions are separate. Missing actuals are counted, never filled with zero.\n\n| Group | Scored / selected | MAE | RMSE | Bias | 80% interval coverage |\n|---|---:|---:|---:|---:|---:|\n'
for key,v in S['overall'].items():md+=f"| {key} | {v['n']} / {v['selected']} | {fmt(v['mae'])} | {fmt(v.get('rmse'))} | {fmt(v.get('bias'))} | {v.get('coverage80',0):.1%} |\n"
md+='\n## Position breakdowns\n\n| Cohort | Position | N | MAE | RMSE | Bias | 80% coverage |\n|---|---|---:|---:|---:|---:|---:|\n'
for v in S['positions']:md+=f"| Top {v['cohort']} | {v['position']} | {v['n']} | {fmt(v['mae'])} | {fmt(v.get('rmse'))} | {fmt(v.get('bias'))} | {v.get('coverage80',0):.1%} |\n"
md+='\n![[position-breakdowns.png]]\n\n![[top50-45-degree.png]]\n\n![[top150-45-degree.png]]\n\n![[weekly-accuracy-calibration.png]]\n\n![[training-and-error-variation.png]]\n\n## Your individual players\n\n![[roster-weekly-1.png]]\n\n![[roster-weekly-2.png]]\n\n| Player | Week | Replay prediction | 80% interval | Actual | Error | Actual source |\n|---|---:|---:|---|---:|---:|---|\n'
for p in D['roster']:
 for r in sorted([r for r in OWN if r['name']==p['name']],key=lambda r:r['week']):md+=f"| {r['name']} | {r['week']} | {fmt(r['predicted'])} | {fmt(r['quantiles']['10'])}–{fmt(r['quantiles']['90'])} | {fmt(r['actual'])} | {fmt(r['predicted']-r['actual'] if r['actual'] is not None else None)} | {r['actualSource']} |\n"
md+='\n## Saved pregame forecasts\n\n| Player | Saved prediction | 80% interval | ESPN actual | Error |\n|---|---:|---|---:|---:|\n'
for r in ARCH:md+=f"| {r['name']} | {fmt(r['predicted'])} | {fmt(r['quantiles']['10'])}–{fmt(r['quantiles']['90'])} | {fmt(r['actual'])} | {fmt(r['predicted']-r['actual'] if r['actual'] is not None else None)} |\n"
md+=f"\n## Scoring-target audit\n\nD/ST: {S['targetAudit']['dstMismatches']} of {S['targetAudit']['dstRows']} training-target totals disagree with ESPN actuals. Mean absolute target discrepancy: {fmt(S['targetAudit']['dstMAE'])}. Captured 2026 targets are independently rescored from ESPN stat counts. Historical 2015-2025 targets use the corrected NFLverse reconstruction and are not fully verified against ESPN components. Offense/kicker cross-check: {S['targetAudit']['offenseMismatches']} discrepancies across {S['targetAudit']['offenseRows']} compared records.\n\n## Interpretation and provenance\n\n- 45-degree charts: x = actual, y = predicted. Vertical whiskers show the model’s 10th–90th percentiles. They represent game-to-game predictive uncertainty, not confidence intervals for model parameters.\n- Training curves are in-sample and optimistic. The later-week replay is the appropriate accuracy check.\n- Weekly MAE CIs bootstrap player rows within each week. Residual error whiskers show one standard deviation, not a CI.\n- The player universe uses identities observed in this season. Historical pregame roster/role/inactive snapshots are absent; selection and participation bias remain.\n- Missing outcomes, cold-start rookies, and inherited matchup-feature conventions limit conclusions.\n- No production model was changed or promoted; no roster action was executed.\n\n"
for k,v in D['provenance'].items():md+=f'- **{k}:** {v}\n'
if D.get('calibration'):
 md+='\n## Chronological interval-calibration candidate\n\nNo model has been promoted. Each week uses only earlier weeks to fit a non-shrinking conformal interval correction. Mean projections remain unchanged. Week 1 has no prior replay calibration outcomes.\n\n| Cohort | Holdout | N | MAE before/after | Coverage before | Coverage after | Width before | Width after |\n|---|---|---:|---:|---:|---:|---:|---:|\n'
 for v in D['calibration']['comparisons']:
  a,b=v['before'],v['after'];md+=f"| Top {v['cohort']} | {v['scope']} | {b['n']} | {a['mae']:.2f} / {b['mae']:.2f} | {a['coverage80']:.1%} | {b['coverage80']:.1%} | {a['meanIntervalWidth']:.2f} | {b['meanIntervalWidth']:.2f} |\n"
 md+='\n![[chronological-calibration.png]]\n\n![[calibrated-top50-45-degree.png]]\n\n'+D['calibration']['cutoffRule']+'\n\n'+' '.join(D['calibration']['limitations'])+'\n'
(OUT/'model-performance.md').write_text(md)
# A concise print preview uses the same verified figures and summaries.
pdfmetrics.registerFont(TTFont('AuditRegular','/usr/share/fonts/truetype/lato/Lato-Regular.ttf'));pdfmetrics.registerFont(TTFont('AuditBold','/usr/share/fonts/truetype/lato/Lato-Bold.ttf'));pdfmetrics.registerFont(TTFont('AuditItalic','/usr/share/fonts/truetype/lato/Lato-Italic.ttf'));pdfmetrics.registerFontFamily('AuditRegular',normal='AuditRegular',bold='AuditBold',italic='AuditItalic',boldItalic='AuditBold')
styles=getSampleStyleSheet()
for style in styles.byName.values():style.fontName='AuditRegular'
for name in ['Title','Heading1','Heading2','Heading3']:styles[name].fontName='AuditBold'
styles['BodyText'].fontSize=9;styles['BodyText'].leading=12
P=lambda t,style='BodyText':Paragraph(escape(t.replace("–","-").replace("—","-")),styles[style]);story=[P('2026 model-performance audit','Title'),P(completed_label+': current roster, top 50 and top 150','Heading2'),P('Historical replay forecasts are not original issued forecasts. Archived pregame forecasts are evaluated separately. Cohorts are ranked by predicted mean before outcome matching.'),Spacer(1,10)]
rows=[['Cohort','Scored / selected','MAE','RMSE','80% coverage']]+[[k,str(v['n'])+' / '+str(v['selected']),fmt(v['mae']),fmt(v.get('rmse')),f"{v.get('coverage80',0):.1%}"] for k,v in S['overall'].items()];t=Table([[P(str(c)) for c in r] for r in rows],colWidths=[145,110,70,70,120]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EDE6')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),8)]));story+=[t,Spacer(1,14),P(f"Scoring warning: {S['targetAudit']['dstMismatches']}/{S['targetAudit']['dstRows']} D/ST targets disagree with ESPN. This separates target error from forecasting error."),P('Read the Markdown or interactive page for every player-week result, missing records, position breakdowns, source hashes and limitations.'),PageBreak()]
for title,path,width,height in [('Top 50: prediction and uncertainty','top50-45-degree.png',510,455),('Top 150: prediction and uncertainty','top150-45-degree.png',510,455),('Weekly accuracy and interval calibration','weekly-accuracy-calibration.png',515,375),('Position breakdowns','position-breakdowns.png',515,375),('Training gap and error variation','training-and-error-variation.png',515,220),('Your roster: players 1–8','roster-weekly-1.png',515,609),('Your roster: players 9–16','roster-weekly-2.png',515,609)]:
 story += [P(title,'Heading1'),Image(str(OUT/path),width=width,height=height),PageBreak()]
story+=[P(archive_label,'Heading1'),P(f"{S['archived']['n']} scored roster forecasts. MAE {fmt(S['archived']['mae'])}; 80% interval coverage {S['archived'].get('coverage80',0):.1%}. Forecast timestamp: {D['provenance']['archiveBuiltAt']}.")]
rows=[['Player','Week','Predicted','10–90%','Actual']]+[[r['name'],str(r['week']),fmt(r['predicted']),fmt(r['quantiles']['10'])+' to '+fmt(r['quantiles']['90']),fmt(r['actual'])] for r in ARCH];t=Table([[P(str(c)) for c in r] for r in rows],colWidths=[175,40,80,125,95],repeatRows=1);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EDE6')),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story+=[t,Spacer(1,12),P('Rank selection is based on pregame mean. Current-season identity universe, missing historical inactive/role inputs and scoring-target discrepancies limit replay evidence. Production models remain unchanged.')]
if D.get('calibration'):
 story += [PageBreak(),P('Chronological interval calibration candidate','Heading1'),P('No promotion. Corrections use only earlier replay weeks; Week 1 remains uncalibrated. Means and ranking are unchanged.'),Image(str(OUT/'chronological-calibration.png'),width=515,height=375)]
 for v in D['calibration']['comparisons']:
  a,b=v['before'],v['after'];story.append(P(f"Top {v['cohort']} {v['scope']}: n={b['n']}; coverage {a['coverage80']:.1%} to {b['coverage80']:.1%}; width {a['meanIntervalWidth']:.2f} to {b['meanIntervalWidth']:.2f}; MAE remains {b['mae']:.2f}."))
 story.append(P('Dependent player-week outcomes and drift mean conformal coverage is not guaranteed. Only four rolling test weeks are available. Defense-specific calibration has insufficient representation.'))
SimpleDocTemplate(str(OUT/'model-performance.pdf'),pagesize=letter,leftMargin=38,rightMargin=38,topMargin=32,bottomMargin=32).build(story)
print(json.dumps(S['overall']))

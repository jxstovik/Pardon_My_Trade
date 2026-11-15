from pathlib import Path
import runpy,json,numpy as np,zipfile
from xml.sax.saxutils import escape
h=runpy.run_path('scripts/scout_report_helpers.py');globals().update({k:v for k,v in h.items() if not k.startswith('__')})
week=D['meta']['week'];OPPREC=recommend(OPP);oppbest=ts(OPP,OPPREC)
summary={'week':week,'owner':OWN['name'],'opponent':OPP['name'],'currentMean':MOC,'recommendedMean':MOR,'opponentCurrentMean':MOA,'opponentRecommendedMean':lm(OPP,OPPREC),'currentWin':WA,'recommendedWin':float(np.mean(OR>OA)),'winAgainstOpponentRecommended':float(np.mean(OR>oppbest)),'recommendedLineup':REC,'opponentRecommendedLineup':OPPREC,'currentRange10_90':list(map(float,np.quantile(OC,[.1,.9]))),'recommendedRange10_90':list(map(float,np.quantile(OR,[.1,.9])))}
FA=[p for p in D['freeAgents'] if not p['bye'] and p['status'] not in ['IR','O','D']];flex=sorted([p for p in FA if p['position'] in ['RB','WR','TE']],key=lambda p:-p['mean'])[:8];defs=sorted([p for p in FA if p['position']=='DST'],key=lambda p:-p['mean'])[:5]
teamimg=OUT/'team-score-distributions.png';playerimg=OUT/'player-score-comparison.png';density_plot(teamimg,f'Week {week}: total scoring distributions','Conditional on available players; independent model quantile draws',[{'name':'You - current','values':OC,'mean':MOC},{'name':'You - recommended','values':OR,'mean':MOR},{'name':'Opponent - current','values':OA,'mean':MOA},{'name':'Opponent - optimized','values':oppbest,'mean':lm(OPP,OPPREC)}]);names=[n for n in [REC['FLEX'],'Tony Pollard','RJ Harvey','Brian Robinson Jr.'] if fp(OWN,n)];density_plot(playerimg,'Your FLEX and RB comparison','Active-state statistical forecasts; no inferred play probabilities',[{'name':n,'values':ps(fp(OWN,n)),'mean':fp(OWN,n)['mean']} for n in names])
summary['freeAgentFlex']=[{'name':p['name'],'mean':p['mean'],'status':p['status'],'position':p['position']} for p in flex];summary['freeAgentDefenses']=[{'name':p['name'],'mean':p['mean']} for p in defs];(OUT/'summary.json').write_text(json.dumps(summary,indent=2))
intro=f"Current model means: you {MOC:.1f}, opponent {MOA:.1f}; win chance {WA:.1%}. Your recommended lineup: {MOR:.1f}, win chance {summary['recommendedWin']:.1%}. Against an optimized opponent lineup: {summary['winAgainstOpponentRecommended']:.1%}. Their current lineup contains a bye-week player; the current win estimate assumes they leave it unchanged."
actions=[];selected=set(REC.values())
for p in OWN['players']:
 label='START' if p['name'] in selected else 'STASH / BYE' if p['bye'] else 'CUT / REPLACE CANDIDATE' if p['status'] in ['O','D'] else 'BENCH / KEEP'
 detail='Confirm availability before kickoff.' if p['status']=='Q' else 'Advisory only; preserve depth.'
 if p['position']=='DST' and defs and defs[0]['mean']>p['mean']:label='STREAM / REPLACE';detail=f"Replace this defense with {defs[0]['name']} ({defs[0]['mean']:.1f}) if available; carry one defense."
 actions.append((p['name'],label,p['mean'],p['status'],detail))
limits=D['meta']['distributionNote']+' '+D['meta']['availabilityCoverage']+' D/ST targets use repaired fumble-recovery and touchdown rules plus independently rescored captured 2026 ESPN stat counts. Historical D/ST component parity remains incomplete. Experimental interval calibration remains unpromoted and is not applied to these weekly curves. Models were retrained with causal data through Week '+str(week-1)+' and remain candidates, not promoted. 2025 retrospective holdout metrics are included in the manifest; they are not a Week 6 accuracy guarantee. Report generation makes no ESPN writes; any separately approved moves are listed in provenance.'
md=f"# Week {week} scouting report\n\n**{OPP['name']} vs {OWN['name']}**\n\nESPN read: {D['meta']['rosterReadAt']}\n\n{intro}\n\n![[team-score-distributions.png]]\n\n## Current vs recommended\n\n| Slot | Opponent current | Your current | Your recommended |\n|---|---|---|---|\n"
for slot in SLOTS:md+=f"| {slot} | {OPP['currentLineup'].get(slot,'')} | {OWN['currentLineup'].get(slot,'')} | {REC.get(slot,'')} |\n"
md+='\n## Start / bench / stash / cut\n\n'+'\n'.join(f'- **{label}: {name}** ({mean:.1f} model pts, {status}). {detail}' for name,label,mean,status,detail in actions)+'\n\n![[player-score-comparison.png]]\n\n## Available players\n\n'
for p in flex+defs:md+=f"- {p['name']}: {p['mean']:.1f} model points, {p['status']}; {p['team']} vs {p['opponent']}.\n"
md+='\n## News\n\n'
for n in D['meta']['news']:md+=f"- **{n['headline']}**: {n['detail']} [{n['source']}]({n['url']}); published {n['date']}; retrieved {n['retrievedAt']}.\n"
md+='\n## Confirmed roster actions\n\n'+'\n'.join(f"- {a['change']} - {a['actionId']}, confirmed {a['confirmedAt']}." for a in D['meta'].get('executedActions',[]))+'\n'
md+='\n## Provenance and limits\n\n'+D['meta']['newsStatus']+'\n\n'+limits+'\n';(OUT/f'week{week}-scout-report.md').write_text(md)
# Optional shareable PDF; the orchestration wrapper marks each PDF authoring operation.
pdfmetrics.registerFont(TTFont('ScoutRegular',FONT));pdfmetrics.registerFont(TTFont('ScoutBold',FBOLD));pdfmetrics.registerFont(TTFont('ScoutItalic','/usr/share/fonts/truetype/lato/Lato-Italic.ttf'));pdfmetrics.registerFontFamily('ScoutRegular',normal='ScoutRegular',bold='ScoutBold',italic='ScoutItalic',boldItalic='ScoutBold');st=getSampleStyleSheet()
for style in st.byName.values():style.fontName='ScoutRegular'
for name in ['Title','Heading1','Heading2','Heading3']:st[name].fontName='ScoutBold'
st['BodyText'].fontSize=9;st['BodyText'].leading=12;P=lambda text,style='BodyText':Paragraph(escape(str(text)),st[style])
def table(rows,widths):
 t=Table([[P(c) for c in row] for row in rows],colWidths=widths,repeatRows=1);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EDE6')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));return t
story=[P(f'Week {week} scouting report','Title'),P(f"{OPP['name']} vs {OWN['name']}",'Heading2'),P(D['meta']['rosterReadAt']),P(intro),RLImage(str(teamimg),width=535,height=244),P(limits),PageBreak(),P('Lineup and roster actions','Title')]
rows=[['Slot','Their current','Your current','Your recommended']]+[[s,OPP['currentLineup'].get(s,''),OWN['currentLineup'].get(s,''),REC.get(s,'')] for s in SLOTS];story.extend([table(rows,[40,165,165,165]),Spacer(1,8)])
for name,label,mean,status,detail in actions:story.extend([P(f'{label}: {name} - {mean:.1f} ({status}). {detail}'),Spacer(1,4)])
story.extend([PageBreak(),P('Player distributions and available options','Title'),RLImage(str(playerimg),width=535,height=244),table([['Available player','Pos','Mean','Status']]+[[p['name'],p['position'],f"{p['mean']:.1f}",p['status']] for p in flex[:6]+defs[:3]],[320,65,75,75]),P('Any defense stream replaces your current defense. No bench defense.'),PageBreak(),P('News and model validation','Title')])
for n in D['meta']['news'][:6]:story.extend([P(n['headline'],'Heading3'),P(n['detail']),Paragraph(f'<link href="{escape(n["url"])}">{escape(n["source"])}</link> - {escape(n["date"])}',st['BodyText'])])
val=D['meta']['validation'];story.extend([Spacer(1,8),table([['2025 holdout','Model MAE','Baseline MAE','80% interval coverage']]+[[p,f"{v['model_mae']:.2f}",f"{v['baseline_mae']:.2f}",f"{v['q10_q90_coverage']:.1%}"] for p,v in val.items()],[155,125,125,130])]);SimpleDocTemplate(str(OUT/f'week{week}-scout-report.pdf'),pagesize=letter,leftMargin=38,rightMargin=38,topMargin=32,bottomMargin=32).build(story)
print(json.dumps(summary))

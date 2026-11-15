from pathlib import Path
import runpy, json, numpy as np, zipfile
from xml.sax.saxutils import escape
h=runpy.run_path(str(Path(__file__).with_name('scout_report_helpers.py')));globals().update({k:v for k,v in h.items() if not k.startswith('__')})
from reportlab.platypus import KeepTogether
stamp=D['meta']['rosterReadAt'];scenarios=[]
def scenario(label,own,opp):
 a=ts(OWN,own);b=ts(OPP,opp);scenarios.append((label,lm(OWN,own),lm(OPP,opp),float(np.mean(a>b)),a,b))
scenario('Live lineups; flagged players active',OWN['currentLineup'],OPP['currentLineup'])
a=dict(OWN['currentLineup']);a[next(k for k,v in a.items() if v=='Malik Nabers')]="Wan'Dale Robinson";scenario('Nabers out; Robinson at WR',a,OPP['currentLineup'])
a=dict(OWN['currentLineup']);a['FLEX']="Wan'Dale Robinson";scenario('Pollard out; Robinson at FLEX',a,OPP['currentLineup'])
a=dict(OWN['currentLineup']);a[next(k for k,v in a.items() if v=='Malik Nabers')]="Wan'Dale Robinson";a['FLEX']='Jameson Williams';scenario('Nabers + Pollard out; Robinson + Williams',a,OPP['currentLineup'])
b=dict(OPP['currentLineup']);b[next(k for k,v in b.items() if v=="Ja'Marr Chase")]='Khalil Shakir';scenario('Chase out; opponent starts Khalil Shakir',OWN['currentLineup'],b)
teamimg=OUT/'team-score-distributions.png';playerimg=OUT/'player-score-comparison.png'
density_plot(teamimg,'Live Week 5 team scoring curves','Conditional active-player forecasts; ESPN roster read Oct 8', [{'name':'Your live lineup','values':OC,'mean':MOC},{'name':'23andMe live lineup','values':OA,'mean':MOA},{'name':'You: Nabers + Pollard out','values':scenarios[3][4],'mean':scenarios[3][1]},{'name':'Opponent: Chase replaced','values':scenarios[4][5],'mean':scenarios[4][2]}])
density_plot(playerimg,'Your injury fallback comparisons','Active-state model curves, not play-probability estimates',[{'name':name,'values':ps(fp(OWN,name)),'mean':fp(OWN,name)['mean']} for name in ['Malik Nabers','Tony Pollard','Brian Robinson Jr.',"Wan'Dale Robinson"]])
pdfmetrics.registerFont(TTFont('ScoutRegular',FONT));pdfmetrics.registerFont(TTFont('ScoutBold',FBOLD));pdfmetrics.registerFont(TTFont('ScoutItalic','/usr/share/fonts/truetype/lato/Lato-Italic.ttf'));pdfmetrics.registerFontFamily('ScoutRegular',normal='ScoutRegular',bold='ScoutBold',italic='ScoutItalic',boldItalic='ScoutBold')
styles=getSampleStyleSheet()
for style in styles.byName.values(): style.fontName='ScoutRegular'
for name in ['Title','Heading1','Heading2','Heading3']: styles[name].fontName='ScoutBold'
styles['BodyText'].fontSize=8.5;styles['BodyText'].leading=11
styles['Heading3'].fontSize=10;styles['Heading3'].spaceBefore=6;styles['Heading3'].spaceAfter=3
styles['Title'].fontSize=21
P=lambda text,style='BodyText':Paragraph(text,styles[style]);story=[]
PDF=OUT/'week5-scout-report.pdf';doc=SimpleDocTemplate(str(PDF),pagesize=letter,rightMargin=38,leftMargin=38,topMargin=35,bottomMargin=35)
def table(rows,widths):
 t=Table([[P(escape(str(c))) for c in row] for row in rows],colWidths=widths,repeatRows=1);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EDE6')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.5,colors.grey)]));return t
story += [P('Week 5 · Live scout report','Title'),P('23andMe vs Bored Man Gets Paid','Heading2'),P(f'Authenticated ESPN read: {stamp}. Candidate model built {D["meta"]["asOf"]}; NFL statistics through Week 4.'),Spacer(1,8),P(f'Your live lineup: <b>{MOC:.1f}</b> model points. Opponent: <b>{MOA:.1f}</b>. Your win chance: <b>{WA:.1%}</b>, conditional on Chase, Nabers and Pollard playing. Your current nine players already match the preferred model lineup.'),RLImage(str(teamimg),width=535,height=244)]
rows=[['Scenario','Your mean','Their mean','Your win']]+[[s[0],f'{s[1]:.1f}',f'{s[2]:.1f}',f'{s[3]:.1%}'] for s in scenarios]
story += [table(rows,[310,75,75,75]),P('Scenarios are conditional outcomes, not estimated injury probabilities. Team draws assume independence; shared game script and correlations are omitted.'),PageBreak()]
rows=[['Slot','23andMe · left','Bored Man Gets Paid · right']]
for slot in SLOTS:
 def label(t):
  p=fp(t,t['currentLineup'][slot]);return f"{p['name']} ({p['status']}) · {p['mean']:.1f}"
 rows.append([slot,label(OPP),label(OWN)])
story += [P('Current ESPN lineups','Title'),table(rows,[45,245,245]),Spacer(1,8),P('Start / bench / stash / cut','Heading2'),P('START / RETAIN: Josh Allen, Ashton Jeanty, RJ Harvey, Michael Wilson, Malik Nabers, George Kittle, Tony Pollard, Bills D/ST and Eddy Pineiro, subject to inactive checks.'),P('BENCH / KEEP: Jameson Williams, Wan’Dale Robinson, Kenny Gainwell, Rashid Shaheed and Brian Robinson Jr. (10.2 model points). Robinson is the first eligible model fallback if either Nabers or Pollard is out; use both Williams and Robinson if both are out.'),P('STASH / MONITOR: Adonai Mitchell (doubtful); retain Tyjae Spears as RB depth while monitoring Pollard. Do not assume Spears inherits workload without evidence.'),P('COMPLETED MOVE: Brian Robinson Jr. added to the bench; Jauan Jennings dropped at 9:12 AM EDT on October 8. No further cut is recommended from a one-week forecast alone. Carry one defense; any D/ST stream replaces Bills D/ST.'),Spacer(1,6),P(D['meta']['availabilityCoverage']),PageBreak()]
story += [P('Player curves and availability','Title'),RLImage(str(playerimg),width=535,height=244)]
for n in D['meta']['news']:
 story += [P(escape(n['headline']),'Heading3'),P(escape(n['detail'])),P(escape(n['impact'])),P(f'<link href="{escape(n["url"])}" color="#16845D">{escape(n["source"])} · published {n["date"]}</link>')]
story += [Spacer(1,5),P('News retrieved Oct 8. Thursday/Friday practice reports and final Sunday inactive lists are pending. ESPN Q/D labels can differ from team reports whose final game designation is still unspecified. Forecast means were not manually adjusted for news. The standalone HTML lets you substitute players on either roster and recompute all curves.')]
doc.build(story)
md=f'# Week 5 live scout report\n\n**ESPN read:** {stamp}\n\n**Model:** {D["meta"]["asOf"]}; statistics through Week 4.\n\nYour current lineup already matches the model’s preferred nine players. Active-state forecast: **{MOC:.1f} vs {MOA:.1f}; {WA:.1%} win chance**.\n\n![[team-score-distributions.png]]\n\n## Injury replacement scenarios\n\n| Scenario | Your mean | Their mean | Your win |\n|---|---:|---:|---:|\n'
for s in scenarios:md+=f'| {s[0]} | {s[1]:.1f} | {s[2]:.1f} | {s[3]:.1%} |\n'
md+='\n## Current lineups\n\n| Slot | 23andMe | Bored Man Gets Paid |\n|---|---|---|\n'
for slot in SLOTS:md+=f"| {slot} | {OPP['currentLineup'][slot]} | {OWN['currentLineup'][slot]} |\n"
md+='\n## Recommended actions\n\n- **Start/retain:** Current starters, conditional on availability.\n- **Bench/keep:** Jameson Williams, Wan’Dale Robinson, Kenny Gainwell, Rashid Shaheed, Brian Robinson Jr. Robinson is first injury fallback; if both Nabers and Pollard are out, start Williams plus Robinson.\n- **Stash/monitor:** Adonai Mitchell; Tyjae Spears as RB depth.\n- **Completed move:** Added Brian Robinson Jr. to the bench and dropped Jauan Jennings at 9:12 AM EDT October 8. No further cut recommended solely on one-week mean. Carry one defense; stream by replacing Bills D/ST.\n\n![[player-score-comparison.png]]\n\n## Relevant news\n\n'
for n in D['meta']['news']:md+=f"- **{n['headline']}:** {n['detail']} {n['impact']} [{n['source']}]({n['url']}) Published {n['date']}; retrieved {n['retrievedAt']}.\n"
md+='\n## Limits\n\n'+D['meta']['availabilityCoverage']+' News manually verified from primary sources; automated PMT ingestion and projection refresh were not run. Model forecasts remain the existing isolated Week 5 candidate outputs, not ESPN projections. Injury scenarios do not assign play probabilities. Team draws assume independence. The prior approved Brian-for-Jennings move was executed and verified; no additional transaction during this refresh.\n'
(OUT/'week5-scout-report.md').write_text(md)
print(json.dumps({'means':[MOC,MOA],'win':WA,'scenarios':[[s[0],s[1],s[2],s[3]] for s in scenarios]},indent=2))

from pathlib import Path
import runpy,json,numpy as np
from xml.sax.saxutils import escape
h=runpy.run_path('scripts/scout_report_helpers.py');globals().update({k:v for k,v in h.items() if not k.startswith('__')})
from reportlab.platypus import KeepTogether
stamp=D['meta']['rosterReadAt'];a=dict(OWN['currentLineup']);a[next(k for k,v in a.items() if v=='Ashton Jeanty')]='Tony Pollard';a['FLEX']="Wan'Dale Robinson"
b=dict(OPP['currentLineup']);b[next(k for k,v in b.items() if v=="Ja'Marr Chase")]='Khalil Shakir'
scenarios=[('Current; Jeanty and Chase play',OWN['currentLineup'],OPP['currentLineup']),('Jeanty out; Pollard RB, Robinson FLEX',a,OPP['currentLineup']),('Chase out; Shakir replaces him',OWN['currentLineup'],b),('Both out; each uses replacement',a,b)]
rows=[]
for label,own,opp in scenarios:
 rows.append([label,f'{lm(OWN,own):.1f}',f'{lm(OPP,opp):.1f}',f'{np.mean(ts(OWN,own)>ts(OPP,opp)):.1%}'])
teamimg=OUT/'team-score-distributions.png';playerimg=OUT/'player-score-comparison.png'
density_plot(teamimg,'Week 5: updated total-score distributions','Includes Irving 31.5 fixed points; remaining players use model forecasts',[{'name':'Your current lineup','values':OC,'mean':MOC},{'name':'Opponent current lineup','values':OA,'mean':MOA},{'name':'You: Jeanty out + replacement','values':ts(OWN,a),'mean':lm(OWN,a)}])
density_plot(playerimg,'Jeanty contingency: active-state model curves','No injury play probabilities assigned',[{'name':n,'values':ps(fp(OWN,n)),'mean':fp(OWN,n)['mean']} for n in ['Ashton Jeanty','Tony Pollard',"Wan'Dale Robinson",'Brian Robinson Jr.']])
pdfmetrics.registerFont(TTFont('ScoutRegular',FONT));pdfmetrics.registerFont(TTFont('ScoutBold',FBOLD));pdfmetrics.registerFont(TTFont('ScoutItalic','/usr/share/fonts/truetype/lato/Lato-Italic.ttf'));pdfmetrics.registerFontFamily('ScoutRegular',normal='ScoutRegular',bold='ScoutBold',italic='ScoutItalic',boldItalic='ScoutBold')
st=getSampleStyleSheet()
for x in st.byName.values():x.fontName='ScoutRegular'
for n in ['Title','Heading1','Heading2','Heading3']:st[n].fontName='ScoutBold'
st['BodyText'].fontSize=9;st['BodyText'].leading=12
P=lambda s,style='BodyText':Paragraph(s,st[style])
def table(rows,widths):
 t=Table([[P(escape(str(c))) for c in row] for row in rows],colWidths=widths,repeatRows=1);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EDE6')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));return t
intro=f'Your total-score model forecast: {MOC:.1f}; opponent: {MOA:.1f}. Estimated win chance: {WA:.1%}, conditional on Jeanty and Chase playing. Irving has already scored 31.5 points; Shrader replaces Mevis at opponent kicker.'
limits='Statistics cutoff remains Week 4; existing candidate models were not retrained with partial Week 5 games. Shrader was newly inferred with the same kicker model. Quantile interpolation and independent player draws omit game correlations. Early-game inactives were not yet published at the read cutoff. ESPN matchup-total fields report zero despite Thursday player results; this report uses recorded player points. Raiders D/ST added and Bills D/ST dropped at 10:35 AM EDT; a fresh ESPN read confirmed Raiders starting. No other lineup move was made.'
actions=['START: Allen; Jeanty if active and Harvey at RB; Nabers and Wilson at WR; Kittle; Pollard at FLEX; Pineiro; one defense.','JEANTY OUT: Pollard moves to RB; Wan\'Dale Robinson starts at FLEX. Jameson Williams and Brian Robinson Jr. remain reserves. Gainwell already played Thursday and cannot replace Jeanty.','BENCH / KEEP: Jameson Williams, Wan\'Dale Robinson, Brian Robinson Jr., Rashid Shaheed and Gainwell. STASH: Spears as RB depth.','CUT / REPLACE CANDIDATE: Mitchell is out and is the least useful immediate lineup option. A cut is optional, not required. Keenan Allen (11.2) is the best eligible modeled available FLEX player; he is expected to play but still carries a groin designation.','COMPLETED DEFENSE SWAP: Raiders D/ST now starts at 5.1 model points. Bills D/ST was dropped; you own one defense. Action act-1791729308840-9zsi9b executed and verified.']
lineups=[['Slot','23andMe','Bored Man Gets Paid']]
for slot in SLOTS:
 lineups.append([slot]+[f"{t['currentLineup'][slot]} - {fp(t,t['currentLineup'][slot])['mean']:.1f}" for t in [OPP,OWN]])
story=[P('Week 5 - Sunday reassessment','Title'),P(f'ESPN read: {stamp}. News refresh: October 11.'),Spacer(1,8),P(intro),RLImage(str(teamimg),width=535,height=244),table([['Scenario','Your mean','Their mean','Win chance']]+rows,[310,75,75,75]),Spacer(1,8),P(limits),PageBreak(),P('Live matchup and decisions','Title'),table(lineups,[45,245,245]),Spacer(1,12)]
for v in actions:story.extend([P(escape(v)),Spacer(1,8)])
story.extend([P(D['meta']['availabilityCoverage']),PageBreak(),P('Player curves and latest news','Title'),RLImage(str(playerimg),width=535,height=244)])
for n in D['meta']['news']:
 story.append(KeepTogether([P(escape(n['headline']),'Heading3'),P(escape(n['detail']+' '+n['impact'])),P(f'<link href="{escape(n["url"])}" color="#16845D">{escape(n["source"])}, published {n["date"]}</link>')]))
SimpleDocTemplate(str(OUT/'week5-scout-report.pdf'),pagesize=letter,leftMargin=38,rightMargin=38,topMargin=32,bottomMargin=32).build(story)
md=f'# Week 5 - Sunday reassessment\n\nESPN read: {stamp}\n\n{intro}\n\n![[team-score-distributions.png]]\n\n| Scenario | Your mean | Their mean | Win chance |\n|---|---:|---:|---:|\n'
for r in rows:md+='| '+' | '.join(r)+' |\n'
md+='\n## Live lineup\n\n| Slot | 23andMe | Bored Man Gets Paid |\n|---|---|---|\n'
for r in lineups[1:]:md+='| '+' | '.join(r)+' |\n'
md+='\n## Recommendations\n\n'+'\n'.join('- '+v for v in actions)+'\n\n![[player-score-comparison.png]]\n\n## Latest news\n\n'
for n in D['meta']['news']:md+=f"- **{n['headline']}:** {n['detail']} {n['impact']} [{n['source']}]({n['url']}); published {n['date']}, retrieved {stamp}.\n"
md+='\n## Data coverage and limits\n\n'+D['meta']['newsStatus']+'\n\n'+D['meta']['availabilityCoverage']+'\n\n'+limits+'\n'
(OUT/'week5-scout-report.md').write_text(md)
print(json.dumps({'mean':MOC,'opponentMean':MOA,'win':WA,'scenarios':rows}))

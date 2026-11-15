from __future__ import annotations
import json, math, re
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path.cwd(); D=json.loads((ROOT/'public/scout-data.json').read_text()); OUT=ROOT/f"output/pdf/week{D['meta']['week']}-scout"; OUT.mkdir(parents=True,exist_ok=True)
OWN=next(t for t in D['teams'] if t['name']==D['meta']['owner']); OPP=next(t for t in D['teams'] if t['name']==D['meta']['opponent'])
SLOTS=['QB','RB1','RB2','WR1','WR2','TE','FLEX','D/ST','K']; ALL=OWN['players']+OPP['players']+D['freeAgents']; BY={p['name']:p for p in ALL}
def fp(team,name): return next((p for p in team['players'] if p['name']==name),None) or next((p for p in D['freeAgents'] if p['name']==name),None)
def recommend(team):
    cand=[p for p in team['players'] if p.get('group')!='IR' and p.get('status') not in ('IR','O','D')]; used=set(); out={}
    for pos,slot in [('QB','QB'),('RB','RB1'),('RB','RB2'),('WR','WR1'),('WR','WR2'),('TE','TE')]:
        arr=[p for p in cand if p['position']==pos and p['name'] not in used and not p.get('bye')]
        if arr: p=max(arr,key=lambda x:x['mean']); out[slot]=p['name']; used.add(p['name'])
    arr=[p for p in cand if p['position'] in ('RB','WR','TE') and p['name'] not in used and not p.get('bye')]
    if arr: p=max(arr,key=lambda x:x['mean']); out['FLEX']=p['name']; used.add(p['name'])
    for pos,slot in [('DST','D/ST'),('K','K')]:
        arr=[p for p in cand if p['position']==pos and p['name'] not in used and not p.get('bye')]
        if arr: p=max(arr,key=lambda x:x['mean']); out[slot]=p['name']; used.add(p['name'])
    for slot in SLOTS: out.setdefault(slot,team['currentLineup'].get(slot,''))
    return out
REC=recommend(OWN)
def seed(name):
    h=2166136261
    for c in name: h=((h^ord(c))*16777619)&0xffffffff
    return h or 1
def rng(seed0):
    s=seed0&0xffffffff
    while True:
        s^=(s<<13)&0xffffffff; s&=0xffffffff; s^=s>>17; s&=0xffffffff; s^=(s<<5)&0xffffffff; s&=0xffffffff
        yield s/4294967296
CACHE={}
def ps(p,active=True,n=7000):
    if not p: return np.zeros(n,dtype=np.float32)
    key=(p['name'],active,n)
    if key in CACHE:return CACHE[key]
    a=np.zeros(n,dtype=np.float32)
    if p.get('bye') or p.get('status') in ('IR','O') or (not active and p['name']=="Ja'Marr Chase"):
        CACHE[key]=a;return a
    q=sorted((float(k)/100,float(v)) for k,v in (p.get('quantiles') or {}).items() if math.isfinite(float(v)))
    if not q:a.fill(float(p.get('mean') or 0));CACHE[key]=a;return a
    g=rng(seed(p['name']))
    for i in range(n):
        u=next(g); l=q[0]; r=q[-1]
        if u<=l[0]:a[i]=l[1]
        elif u>=r[0]:a[i]=r[1]
        else:
            for j in range(1,len(q)):
                if u<=q[j][0]:l,r=q[j-1],q[j];break
            t=(u-l[0])/(r[0]-l[0]);a[i]=l[1]+t*(r[1]-l[1])
    CACHE[key]=a;return a
def ts(team,lineup,active=True):
    out=np.zeros(7000,dtype=np.float32)
    for slot in SLOTS:out+=ps(fp(team,lineup.get(slot,'')),active)
    return out
def lm(team,lineup,active=True):
    n=0.0
    for slot in SLOTS:
        p=fp(team,lineup.get(slot,''))
        if p and not p.get('bye') and p.get('status') not in ('IR','O','D') and (active or p['name']!="Ja'Marr Chase"):n+=float(p.get('mean') or 0)
    return n
OC=ts(OWN,OWN['currentLineup']); OR=ts(OWN,REC); OA=ts(OPP,OPP['currentLineup']); OO=ts(OPP,OPP['currentLineup'],False)
MOC=lm(OWN,OWN['currentLineup']); MOR=lm(OWN,REC); MOA=lm(OPP,OPP['currentLineup']); WA=float(np.mean(OC>OA)); WO=float(np.mean(OC>OO))

# High-resolution, printer-friendly distribution figures.
FONT='/usr/share/fonts/truetype/lato/Lato-Regular.ttf'; FBOLD='/usr/share/fonts/truetype/lato/Lato-Bold.ttf'
def fnt(s,b=False):
    p=FBOLD if b else FONT
    if not Path(p).exists():p='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if b else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    return ImageFont.truetype(p,s)
COL=['#66789A','#16845D','#D56F50','#BA982E','#9473B8']; BG='#F7F8F5'; INK='#1D2B29'; MUT='#677773'; GRID='#DEE5DF'
def pastel(hex_color):
    rgb=tuple(int(hex_color[i:i+2],16) for i in (1,3,5)); base=(247,248,245)
    return tuple(round(.78*b+.22*c) for b,c in zip(base,rgb))
def density_plot(path,title,subtitle,series,w=1800,h=820):
    im=Image.new('RGB',(w,h),BG); dr=ImageDraw.Draw(im); dr.text((75,38),title,font=fnt(40,True),fill=INK);dr.text((78,96),subtitle,font=fnt(22),fill=MUT)
    left,top,right,bottom=110,170,w-55,h-120; vals=np.concatenate([np.asarray(s['values']) for s in series]); lo=float(np.percentile(vals,1));hi=float(np.percentile(vals,99));pad=max(2,(hi-lo)*.08);xmin=math.floor(lo-pad);xmax=math.ceil(hi+pad)
    if xmax-xmin<20:xmax=xmin+20
    xs=np.linspace(xmin,xmax,170); pw=right-left;ph=bottom-top; curves=[]; ymax=0
    for i,s in enumerate(series):
        v=np.asarray(s['values'],dtype=float);bw=max(1.1,(xmax-xmin)/105);z=(xs[:,None]-v[None,:])/bw;y=np.exp(-.5*z*z).sum(axis=1)/(len(v)*bw*math.sqrt(2*math.pi));curves.append((s,y,COL[i%len(COL)]));ymax=max(ymax,float(y.max()))
    for k in range(6):
        x=xmin+(xmax-xmin)*k/5;px=left+pw*k/5;dr.line((px,top,px,bottom),fill=GRID,width=2);lab=f'{x:.0f}';box=dr.textbbox((0,0),lab,font=fnt(19));dr.text((px-(box[2]-box[0])/2,bottom+13),lab,font=fnt(19),fill=MUT)
    dr.line((left,bottom,right,bottom),fill='#AAB8B2',width=3);ymax*=1.16
    for s,y,c in curves:
        pts=[(left+(x-xmin)/(xmax-xmin)*pw,bottom-(yy/ymax)*ph) for x,yy in zip(xs,y)];dr.polygon([(left,bottom)]+pts+[(right,bottom)],fill=pastel(c));dr.line(pts,fill=c,width=5)
        mean=float(s.get('mean',np.mean(s['values'])));mx=left+(mean-xmin)/(xmax-xmin)*pw
        for yy in range(top,bottom,18):dr.line((mx,yy,mx,min(yy+9,bottom)),fill=c,width=2)
    # Redraw every curve above the fills so overlapping densities stay visible.
    for item,y,c in curves:
        pts=[(left+(x-xmin)/(xmax-xmin)*pw,bottom-(yy/ymax)*ph) for x,yy in zip(xs,y)];dr.line(pts,fill=c,width=5)
    dr.text((left,bottom+55),'Projected fantasy points',font=fnt(20,True),fill=INK)
    # Two-row legend avoids crowding on the team chart.
    legend_y=top-27; x=left
    for i,(s,y,c) in enumerate(curves):
        if i==2:x=left;legend_y+=32
        dr.line((x,legend_y+10,x+35,legend_y+10),fill=c,width=5);dr.text((x+44,legend_y-1),s['name'],font=fnt(19),fill=INK);x+=min(820,300+len(s['name'])*7)
    im.save(path,optimize=True)

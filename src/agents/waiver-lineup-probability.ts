import { optimizeLineup } from "./skills/lineup-optimizer.js";
import type { RosterSlotInput } from "./types.js";
import type { PlayerPosition } from "../models/types.js";
import type { PlayerModel } from "../probabilistic/bayesian-model.js";
import { normalCdf } from "../probabilistic/normal.js";

export interface ForecastWeek { week: number; mean: number; playing?: boolean; quantiles?: Record<string, number> }
export interface HorizonPlayer { playerId: string; position: PlayerPosition; team?: string; weeks: ForecastWeek[] }
export interface HandcuffScenario {
  leaderPlayerId: string; backupPlayerId: string; probability: number;
  sampleGames: number; absentGames: number; gameIds: string[]; conditionalWeeks: ForecastWeek[];
}
export interface StackCorrelation { qbPlayerId: string; receiverPlayerId: string; rho: number; sampleGames: number; gameIds: string[] }
export interface ProbabilitySummary {
  improves: number; worsens: number; ties: number; expectedGain: number;
  /** Monte Carlo precision only: not model confidence or calibration. */
  favorableMarginLowerBound: number;
}
export interface LineupProbability {
  nextWeek: ProbabilitySummary; nearTerm: ProbabilitySummary; season: ProbabilitySummary;
  probabilityAddedPlayerStarts: number; probabilityAddedPlayerStartsNextWeek: number;
  matchupWinProbabilityChange?: number; matchupWinGainLowerBound?: number; baselineMatchupWinProbability?: number;
  handcuffLeaders: string[]; stackQbIds: string[];
  handcuffEvidence: Array<{leaderPlayerId:string;historicalScenarioFrequency:number;sampleGames:number;takeoverGames:number}>;
  stackEvidence: StackCorrelation[];
  weeklyGains: Array<{week: number; gain: number}>;
  caveats: string[];
}
const levels = [5,10,25,50,75,90,95];
export function validDistribution(point: ForecastWeek): boolean {
  return Number.isFinite(point.mean) && !!point.quantiles && levels.every((q,i)=>Number.isFinite(point.quantiles![String(q)]) && (!i || point.quantiles![String(q)]>=point.quantiles![String(levels[i-1]!)]!));
}
function uniform(key: string): number {
  let n=2166136261;
  for (let i=0;i<key.length;i++) n=Math.imul(n^key.charCodeAt(i),16777619);
  n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);n^=n>>>16;
  return ((n>>>0)+.5)/4294967296;
}
function gaussian(key: string) { return Math.sqrt(-2*Math.log(uniform(key+":u")))*Math.cos(2*Math.PI*uniform(key+":v")); }
function quantile(point: ForecastWeek, u: number) {
  const qs=[0,...levels,100], values=[point.quantiles!["5"]!,...levels.map(q=>point.quantiles![String(q)]!),point.quantiles!["95"]!];
  const p=u*100;
  for(let i=1;i<qs.length;i++)if(p<=qs[i]!)return values[i-1]!+(values[i]!-values[i-1]!)*(p-qs[i-1]!)/(qs[i]!-qs[i-1]!);
  return values.at(-1)!;
}
function summary(draws: number[], expectedGain: number): ProbabilitySummary {
  const n=draws.length, improves=draws.filter(v=>v>1e-8).length/n, worsens=draws.filter(v=>v< -1e-8).length/n;
  const margin=improves-worsens;
  return {improves,worsens,ties:1-improves-worsens,expectedGain,favorableMarginLowerBound:margin-2*Math.sqrt(Math.max(0,improves+worsens-margin*margin)/n)};
}

/** Compare lineups chosen using pregame means/availability, never realized sample scores. */
export function createLineupProbabilityEvaluator(input: {
  forecasts: HorizonPlayer[]; weeks: number[]; starterCounts: Array<{slot: PlayerPosition;count:number}>;
  nearTermWeeks: number; simulations: number; handcuffs?: HandcuffScenario[];
  correlations?: StackCorrelation[]; opponentRoster?: RosterSlotInput[];
}) {
  const {weeks,starterCounts,simulations}=input;
  if(!Number.isInteger(simulations)||simulations<128||simulations>2048)throw new Error("Invalid lineup simulation count.");
  const forecasts=new Map(input.forecasts.map(p=>[p.playerId,p]));
  const points=new Map(input.forecasts.map(p=>[p.playerId,new Map(p.weeks.map(w=>[w.week,w]))]));
  const pairs=(input.correlations??[]).filter(c=>c.sampleGames>=4 && c.gameIds.length===c.sampleGames && new Set(c.gameIds).size===c.sampleGames && Number.isFinite(c.rho)&&Math.abs(c.rho)<1 && forecasts.get(c.qbPlayerId)?.position==="QB" && forecasts.get(c.receiverPlayerId)?.position==="WR" && !!forecasts.get(c.qbPlayerId)?.team && forecasts.get(c.qbPlayerId)?.team===forecasts.get(c.receiverPlayerId)?.team);
  const linkByReceiver=new Map<string,StackCorrelation>();
  for(const c of [...pairs].sort((a,b)=>b.sampleGames-a.sampleGames))if(!linkByReceiver.has(c.receiverPlayerId))linkByReceiver.set(c.receiverPlayerId,c);
  const validatedHandcuffs=(input.handcuffs??[]).filter(h=>h.absentGames>=2 && h.sampleGames>=h.absentGames && h.gameIds.length===h.absentGames && new Set(h.gameIds).size===h.absentGames && h.probability===h.absentGames/h.sampleGames && h.probability>0&&h.probability<1 && forecasts.get(h.leaderPlayerId)?.position==="RB" && forecasts.get(h.backupPlayerId)?.position==="RB" && !!forecasts.get(h.leaderPlayerId)?.team && forecasts.get(h.leaderPlayerId)?.team===forecasts.get(h.backupPlayerId)?.team && weeks.every(w=>h.conditionalWeeks.some(p=>p.week===w&&validDistribution(p))));
  // Ambiguous multi-back role evidence does not define a joint availability model.
  const handcuffs=validatedHandcuffs.filter(h=>new Set(validatedHandcuffs.filter(x=>x.leaderPlayerId===h.leaderPlayerId).map(x=>x.backupPlayerId)).size===1&&new Set(validatedHandcuffs.filter(x=>x.backupPlayerId===h.backupPlayerId).map(x=>x.leaderPlayerId)).size===1);
  const scoreCache=new Map<string,Float64Array>();
  function scores(id:string,week:number,conditional?:ForecastWeek) {
    const key=`${id}:${week}:${conditional?JSON.stringify(conditional):"base"}`;
    if(scoreCache.has(key))return scoreCache.get(key)!;
    const point=conditional??points.get(id)?.get(week);
    if(!point||!validDistribution(point))throw new Error(`Missing fitted score distribution: ${id}/${week}`);
    const link=linkByReceiver.get(id);
    const draws=Float64Array.from({length:simulations},(_,s)=>{
      let z=gaussian(`${id}:${week}:${s}`);
      if(link)z=link.rho*gaussian(`${link.qbPlayerId}:${week}:${s}`)+Math.sqrt(1-link.rho*link.rho)*z;
      return quantile(point,normalCdf(z));
    });
    scoreCache.set(key,draws);return draws;
  }
  return (before: RosterSlotInput[],after: RosterSlotInput[],addedId:string):LineupProbability=>{
    const beforeIds=new Set(before.map(p=>p.playerId));
    // The same observable availability scenario is supplied to both decisions.
    const relevant=handcuffs.filter(h=>beforeIds.has(h.leaderPlayerId) && (beforeIds.has(h.backupPlayerId)||after.some(p=>p.playerId===h.backupPlayerId)));
    const near=new Float64Array(simulations),season=new Float64Array(simulations),next=new Float64Array(simulations);
    let starts=0,startsNext=0,winsBefore=0,winsAfter=0;
    const winChanges:number[]=[];
    const weeklyGains:Array<{week:number;gain:number}>=[];
    const evaluate=(roster:RosterSlotInput[],week:number,absent:Set<string>,conditional:Map<string,ForecastWeek>)=>{
      const models=new Map(roster.map(p=>[p.playerId,{mu:absent.has(p.playerId)?0:(conditional.get(p.playerId)??points.get(p.playerId)?.get(week))?.mean??0} as PlayerModel]));
      const eligible=roster.filter(p=>!absent.has(p.playerId)&&(conditional.get(p.playerId)??points.get(p.playerId)?.get(week))?.playing!==false);
      const result=optimizeLineup(eligible,starterCounts,models);
      // A vacancy caused by a modeled absence contributes zero in either roster.
      return {ids:result.starters.map(p=>p.playerId),mean:result.expectedPoints};
    };
    for(const [wi,week] of weeks.entries()) {
      const contexts=new Map<string,{a:ReturnType<typeof evaluate>;b:ReturnType<typeof evaluate>;conditional:Map<string,ForecastWeek>}>();
      let gain=0;
      const opponent=input.opponentRoster?.length?evaluate(input.opponentRoster,week,new Set(),new Map()):undefined;
      for(let s=0;s<simulations;s++) {
        const absent=new Set(relevant.filter(h=>uniform(`availability:${h.leaderPlayerId}:${week}:${s}`)<h.probability).map(h=>h.leaderPlayerId));
        const key=[...absent].sort().join(",");
        let context=contexts.get(key);
        if(!context) {
          const conditional=new Map(relevant.filter(h=>absent.has(h.leaderPlayerId)).map(h=>[h.backupPlayerId,h.conditionalWeeks.find(p=>p.week===week)!]));
          context={a:evaluate(before,week,absent,conditional),b:evaluate(after,week,absent,conditional),conditional};contexts.set(key,context);
        }
        const total=(ids:string[])=>ids.reduce((sum,id)=>sum+scores(id,week,context!.conditional.get(id))[s]!,0);
        const a=total(context.a.ids),b=total(context.b.ids),delta=b-a;
        gain+=(context.b.mean-context.a.mean)/simulations;
        season[s]+=delta;if(wi<input.nearTermWeeks)near[s]+=delta;
        if(context.b.ids.includes(addedId)){starts++;if(wi===0)startsNext++;}
        if(wi===0) {
          next[s]=delta;
          if(opponent) {const other=total(opponent.ids);const wa=a>other?1:a===other?0.5:0,wb=b>other?1:b===other?0.5:0;winsBefore+=wa;winsAfter+=wb;winChanges.push(wb-wa);}
        }
      }
      weeklyGains.push({week,gain});
    }
    const ownedQbs=before.filter(p=>forecasts.get(p.playerId)?.position==="QB").map(p=>p.playerId);
    const isReceiver=forecasts.get(addedId)?.position==="WR";
    return {nextWeek:summary([...next],weeklyGains[0]!.gain),nearTerm:summary([...near],weeklyGains.slice(0,input.nearTermWeeks).reduce((s,w)=>s+w.gain,0)),season:summary([...season],weeklyGains.reduce((s,w)=>s+w.gain,0)),probabilityAddedPlayerStarts:starts/(simulations*weeks.length),probabilityAddedPlayerStartsNextWeek:startsNext/simulations,
      ...(input.opponentRoster?.length?{matchupWinProbabilityChange:(winsAfter-winsBefore)/simulations,matchupWinGainLowerBound:(winsAfter-winsBefore)/simulations-2*Math.sqrt(Math.max(0,winChanges.reduce((s,v)=>s+v*v,0)/simulations-((winsAfter-winsBefore)/simulations)**2)/simulations),baselineMatchupWinProbability:winsBefore/simulations}:{}),
      handcuffEvidence:relevant.filter(h=>h.backupPlayerId===addedId).map(h=>({leaderPlayerId:h.leaderPlayerId,historicalScenarioFrequency:h.probability,sampleGames:h.sampleGames,takeoverGames:h.absentGames})),
      stackEvidence:pairs.filter(c=>c.receiverPlayerId===addedId&&ownedQbs.includes(c.qbPlayerId)),
      handcuffLeaders:relevant.filter(h=>h.backupPlayerId===addedId).map(h=>h.leaderPlayerId),
      stackQbIds:isReceiver?ownedQbs.filter(id=>pairs.some(c=>c.qbPlayerId===id&&c.receiverPlayerId===addedId)):[],weeklyGains,
      caveats:["Conditional model simulations, not calibrated probabilities; lineups selected before sampled scores; quantile tails clamped at fitted 5th/95th percentiles", ...(relevant.length?["RB absence frequencies and conditional scores are historical scenarios, not predicted injury rates"]:[]),...(isReceiver&&ownedQbs.length?["QB–WR pairing receives no points bonus; covariance requires paired completed-game evidence"]:[])]};
  };
}

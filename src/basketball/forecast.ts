import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CATEGORIES, instant, type BasketballConfig, type Category } from "./contracts.js";
import { type readHistory } from "./history.js";
import { StatLineSchema, type StatLine } from "./categories.js";
import { contentHash, immutableText, leagueDirectory } from "./store.js";

const n=z.number().finite().nonnegative();
export const SupplementSchema=z.object({schemaVersion:z.literal(1),season:z.string(),source:z.object({provider:z.literal("RotoWire"),url:z.url(),observedAt:instant,publishedLabel:z.string(),scope:z.string()}).strict(),
  players:z.array(z.object({fantraxId:z.string().transform(s=>s.replace(/^\*|\*$/g,"")),name:z.string(),schoolLabel:z.string(),providerRank:z.number().int().positive().nullable().optional(),minutes:n.max(40).positive(),PTS:n,REB:n,AST:n,
    ST:n.optional(),BLK:n.optional(),threeMade:n.optional(),GP:n.optional(),TO:n.optional(),DD:n.optional(),TD:n.optional(),FGM:n.optional(),FGA:n.optional(),FTM:n.optional(),FTA:n.optional(),
    fieldObservedAt:z.record(z.string(),instant.nullable()).optional(),notes:z.string(),matchMethod:z.string()}).strict())}).strict();
type History=Awaited<ReturnType<typeof readHistory>>;
type HistoricalPlayer=History["players"][number];
type Provider=z.infer<typeof SupplementSchema>["players"][number];
export const DraftStatusSchema=z.object({schemaVersion:z.literal(1),season:z.string(),observations:z.array(z.object({
  fantraxId:z.string(),status:z.enum(["out","eligibility-uncertain"]),draftAction:z.literal("manual-review-only"),observedAt:instant,sourceUrl:z.url(),sourcePublishedAt:z.string(),reason:z.string()
}).strict())}).strict();
const nameKey=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const SCHOOL_ALIASES:Record<string,string>={MSU:"Michigan State",Vand:"Vanderbilt",Fla:"Florida",Ark:"Arkansas",Ariz:"Arizona",Bama:"Alabama",Kan:"Kansas",UVA:"Virginia",BYU:"BYU",Nebras:"Nebraska",Marq:"Marquette",StJon:"St. John's",Duke:"Duke",Tenn:"Tennessee",Wisc:"Wisconsin",Lou:"Louisville",Hou:"Houston",TxTch:"Texas Tech",Stan:"Stanford",Ind:"Indiana",MissSt:"Mississippi State",TAMU:"Texas A&M",KY:"Kentucky"};
type Group="G"|"F/C";
type Rates={FGA:number;FTA:number;three:number;REB:number;AST:number;ST:number;BLK:number};
type Prior=Rates & {minutes:number;fg:number;ft:number;rows:number};
export type DraftForecastRecipe = {
  version: string; priorGames: number; fgPseudoAttempts: number; ftPseudoAttempts: number;
  minimumHistoricalGP: number; minimumHistoricalMinutes: number; referenceMaximumADP: number;
  cohortMinimumGP: number; cohortMinimumMinutes: number; minimumCohortRows: number;
  scenarioMinutesFraction: {providerHistory:number;historyOnly:number;coldStart:number};
  categoryWeights: Record<Category,number>; status: string;
};
export const FORECAST_RECIPE={version:"draft-baseline-v1",priorGames:8,fgPseudoAttempts:50,ftPseudoAttempts:30,
  minimumHistoricalGP:8,minimumHistoricalMinutes:10,referenceMaximumADP:200,
  cohortMinimumGP:15,cohortMinimumMinutes:15,minimumCohortRows:8,
  scenarioMinutesFraction:{providerHistory:.20,historyOnly:.30,coldStart:.40},
  categoryWeights:Object.fromEntries(CATEGORIES.map(c=>[c,1])) as Record<Category,number>,
  status:"experimental-fixed-heuristics-not-trained-or-calibrated"} as const satisfies DraftForecastRecipe;
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
function prior(players:HistoricalPlayer[],recipe:DraftForecastRecipe):Prior {
  if(players.length<recipe.minimumCohortRows)throw new Error("Insufficient reference cohort; no synthetic fallback");
  const sum=(f:(p:HistoricalPlayer)=>number)=>players.reduce((s,p)=>s+f(p),0);
  const minutes=sum(p=>p.displayedPerGame.MIN);
  const perMinute=(k:keyof HistoricalPlayer["displayedPerGame"])=>sum(p=>p.displayedPerGame[k])/minutes;
  const fgAttempts=sum(p=>p.displayedPerGame.FGA),ftAttempts=sum(p=>p.displayedPerGame.FTA);
  if(minutes<=0||fgAttempts<=0||ftAttempts<=0)throw new Error("Reference cohort has no shooting/minutes exposure");
  return {minutes:mean(players.map(p=>p.displayedPerGame.MIN)),FGA:perMinute("FGA"),FTA:perMinute("FTA"),three:perMinute("3PTM"),
    REB:perMinute("REB"),AST:perMinute("AST"),ST:perMinute("ST"),BLK:perMinute("BLK"),rows:players.length,
    fg:sum(p=>p.displayedPerGame.FGA*p.historicalPerGame["FG%"])/fgAttempts,
    ft:sum(p=>p.displayedPerGame.FTA*p.historicalPerGame["FT%"])/ftAttempts};
}
export type PlayerForecast={fantraxId:string;name:string;school:string;eligibleGroups:Group[];historicalGP:number;
  minutes:number;stats:StatLine;fg:number;ft:number;basis:"provider-plus-model"|"historical-shrinkage"|"provider-plus-cold-start-prior";
  sourceFields:string[];modeledFields:string[];flags:string[];reviewRequired:boolean;adp:number|null;providerRank:number|null;providerNotes:string|null;
  scenarioMinutes:{low:number;high:number};sensitivity:{low:StatLine;high:StatLine};sourceFieldObservedAt?:Record<string,string|null>};

function forecast(p:HistoricalPlayer,pr:Prior,provider:Provider|undefined,recipe:DraftForecastRecipe):PlayerForecast {
  const history=p.usableForBaselineResearch && p.displayedPerGame.MIN>0;
  const weight=history?p.gamesPlayed/(p.gamesPlayed+recipe.priorGames):0;
  const h=p.displayedPerGame;
  const blend=(k:keyof Rates,hk:keyof typeof h)=>weight*(h[hk]/Math.max(h.MIN,1))+(1-weight)*pr[k];
  const minutes=provider?.minutes??clamp(weight*h.MIN+(1-weight)*pr.minutes,5,40);
  // Rounded GP*attempts are approximate evidence weights, never exact reconstructed season totals.
  const pct=(attempts:number,pct:number,base:number,pseudo:number)=>history?(p.gamesPlayed*attempts+pseudo)>0?(p.gamesPlayed*attempts*pct+pseudo*base)/(p.gamesPlayed*attempts+pseudo):base:base;
  const fg=pct(h.FGA,p.historicalPerGame["FG%"],pr.fg,recipe.fgPseudoAttempts);
  const ft=pct(h.FTA,p.historicalPerGame["FT%"],pr.ft,recipe.ftPseudoAttempts);
  let FGA=blend("FGA","FGA")*minutes,FTA=blend("FTA","FTA")*minutes;
  let threes=provider?.threeMade??Math.min(blend("three","3PTM")*minutes,fg*FGA);
  const initialPTS=2*fg*FGA+threes+ft*FTA;
  if(provider && initialPTS<=0)throw new Error("Cannot reconcile provider points with shooting prior");
  const nonThreePoints=2*fg*FGA+ft*FTA;
  const shotScale=provider?(provider.threeMade===undefined?provider.PTS/initialPTS:(provider.PTS-threes)/Math.max(nonThreePoints,1e-9)):1;
  FGA*=shotScale;FTA*=shotScale;if(provider?.threeMade===undefined)threes*=shotScale;
  const directShooting=[provider?.FGM,provider?.FGA,provider?.FTM,provider?.FTA];
  if(directShooting.some(v=>v!==undefined)&&directShooting.some(v=>v===undefined))throw new Error("Provider direct shooting line is partial; it cannot be reconciled coherently");
  if(provider?.FGM!==undefined&&provider.FGM>provider.FGA!)throw new Error("Provider field goals exceed attempts");
  if(provider?.FTM!==undefined&&provider.FTM>provider.FTA!)throw new Error("Provider free throws exceed attempts");
  if(provider?.threeMade!==undefined&&provider.threeMade>(provider.FGM??fg*FGA)+1e-9)throw new Error("Provider three-pointers exceed field goals");
  if(provider?.FGM!==undefined){FGA=provider.FGA!;FTA=provider.FTA!;threes=provider.threeMade??threes;}
  const FGM=provider?.FGM??fg*FGA,FTM=provider?.FTM??ft*FTA;
  const coherentPTS=2*FGM+threes+FTM;
  if(provider?.FGM!==undefined&&Math.abs(coherentPTS-provider.PTS)>1e-6)throw new Error("Provider direct shooting line does not reconcile points");
  const stats=StatLineSchema.parse({FGA,FGM,FTA,FTM,"3PTM":threes,PTS:coherentPTS,
    REB:provider?.REB??blend("REB","REB")*minutes,AST:provider?.AST??blend("AST","AST")*minutes,
    ST:provider?.ST??blend("ST","ST")*minutes,BLK:provider?.BLK??blend("BLK","BLK")*minutes});
  const basis=provider?(history?"provider-plus-model":"provider-plus-cold-start-prior"):"historical-shrinkage";
  const flags:string[]=[];
  flags.push("current-availability-unverified");
  if(!provider)flags.push("current-role-unverified");
  if(!history)flags.push("cold-start-shooting-steals-blocks-imputed");
  if(history&&p.gamesPlayed<recipe.minimumHistoricalGP)flags.push("short-history-shooting-steals-blocks-review");
  if(p.flags.length)flags.push("historical-row-quarantined-not-used");
  if(provider && /transfer|eligible|eligibility|EuroLeague|ACL|injur/i.test(provider.notes))flags.push("provider-role-or-eligibility-note-review");
  if(provider && (shotScale<.6||shotScale>1.6))flags.push("large-modeled-shot-volume-adjustment");
  const fraction=!history?recipe.scenarioMinutesFraction.coldStart:provider?recipe.scenarioMinutesFraction.providerHistory:recipe.scenarioMinutesFraction.historyOnly;
  const scenarioMinutes={low:minutes*(1-fraction),high:Math.min(40,minutes*(1+fraction))};
  const scaled=(m:number)=>StatLineSchema.parse(Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v*m/minutes])));
  const sourceFields=provider?Object.entries(provider).flatMap(([key,value])=>typeof value==="number"&&Number.isFinite(value)&&["minutes","PTS","REB","AST","ST","BLK","threeMade","FGM","FGA","FTM","FTA"].includes(key)?[key==="minutes"?"MIN":key==="threeMade"?"3PTM":key]:[]):[];
  const fieldObservedAt=provider?.fieldObservedAt?Object.fromEntries(sourceFields.map(field=>[field,provider.fieldObservedAt?.[field]??null])):undefined;
  return {fantraxId:p.fantraxId,name:p.fullName,school:p.schoolLabel,eligibleGroups:p.eligibleGroups,historicalGP:p.gamesPlayed,
    minutes,stats,fg,ft,basis,sourceFields,
    modeledFields:provider?["FGM","FGA","FTM","FTA","3PTM","ST","BLK"].filter(k=>!sourceFields.includes(k)):["MIN",...Object.keys(stats)],
    flags,reviewRequired:flags.length>0,adp:p.adp,providerRank:provider?.providerRank??null,providerNotes:provider?.notes??null,
    scenarioMinutes,sensitivity:{low:scaled(scenarioMinutes.low),high:scaled(scenarioMinutes.high)},...(fieldObservedAt?{sourceFieldObservedAt:fieldObservedAt}:{})};
}
type Ranked=PlayerForecast & {rank:number;draftRank:number|null;positionValue:number;categoryScore:number;categoryZ:Record<Category,number>;strengths:Category[];weaknesses:Category[];providerRankGap:number|null};

export function buildDraftBoard(config:BasketballConfig,history:History,supplementInput:unknown,asOf:Date,statusInput:unknown={schemaVersion:1,season:config.rules.seasonLabel,observations:[]},recipeInput:DraftForecastRecipe=FORECAST_RECIPE) {
  const recipe=recipeInput;
  const supplement=SupplementSchema.parse(supplementInput);
  const status=DraftStatusSchema.parse(statusInput);
  if(supplement.season!==config.rules.seasonLabel||history.leagueId!==config.leagueId)throw new Error("Draft forecast season/league mismatch");
  const url=new URL(supplement.source.url);
  if(url.origin!=="https://www.rotowire.com"||url.pathname!=="/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463"||url.search||url.hash)throw new Error("Unsupported provider source scope");
  if(Date.parse(history.source.observedAt)>asOf.getTime()||Date.parse(supplement.source.observedAt)>asOf.getTime())throw new Error("Future source observation cannot support an as-of forecast");
  const provider=new Map<string,Provider>(),seenRanks=new Set<number>();
  for(const row of supplement.players){
    if(provider.has(row.fantraxId)||(row.providerRank!==null&&row.providerRank!==undefined&&seenRanks.has(row.providerRank)))throw new Error("Duplicate provider identity/rank");
    const matched=history.players.find(p=>p.fantraxId===row.fantraxId);
    if(!matched)throw new Error("Provider identity absent from saved available pool");
    const exact=nameKey(row.name)===nameKey(matched.fullName);
    const documentedAlias=row.fantraxId==="07a8s"&&row.name==="Jordan Smith Jr."&&matched.fullName==="Jordan Smith"&&row.matchMethod.includes("Manual suffix alias");
    if((!exact&&!documentedAlias)||nameKey(SCHOOL_ALIASES[matched.schoolLabel]??matched.schoolLabel)!==nameKey(row.schoolLabel)||!row.matchMethod.trim())throw new Error("Provider name/school crosswalk mismatch");
    provider.set(row.fantraxId,row);if(row.providerRank!==null&&row.providerRank!==undefined)seenRanks.add(row.providerRank);
  }
  const statusIds=new Set<string>();
  if(status.season!==config.rules.seasonLabel)throw new Error("Draft status season mismatch");
  for(const s of status.observations){
    if(statusIds.has(s.fantraxId)||!history.players.some(p=>p.fantraxId===s.fantraxId))throw new Error("Unknown/duplicate status identity");
    if(Date.parse(s.observedAt)>asOf.getTime())throw new Error("Future status observation");
    const u=new URL(s.sourceUrl);if(u.protocol!=="https:"||u.username||u.password)throw new Error("Invalid status source URL");
    statusIds.add(s.fantraxId);
  }
  const cohort=history.players.filter(p=>p.usableForBaselineResearch&&p.gamesPlayed>=recipe.cohortMinimumGP&&p.displayedPerGame.MIN>=recipe.cohortMinimumMinutes&&p.adp!==null&&p.adp>0&&p.adp<=recipe.referenceMaximumADP);
  const priors={G:prior(cohort.filter(p=>p.eligibleGroups.includes("G")),recipe),"F/C":prior(cohort.filter(p=>p.eligibleGroups.includes("F/C")),recipe)};
  const blendedPrior=(p:HistoricalPlayer):Prior=>{
    if(p.eligibleGroups.length===1)return priors[p.eligibleGroups[0]!];
    return Object.fromEntries(Object.keys(priors.G).map(k=>[k,(priors.G[k as keyof Prior]+priors["F/C"][k as keyof Prior])/2])) as Prior;
  };
  const excluded:{fantraxId:string;name:string;school:string;eligibleGroups:Group[];adp:number|null;historicalGP:number;reason:string}[]=[];
  const forecasts:PlayerForecast[]=[];
  for(const p of history.players){
    const expert=provider.get(p.fantraxId);
    if(!expert&&(!p.usableForBaselineResearch||p.gamesPlayed<recipe.minimumHistoricalGP||p.displayedPerGame.MIN<recipe.minimumHistoricalMinutes)){
      excluded.push({fantraxId:p.fantraxId,name:p.fullName,school:p.schoolLabel,eligibleGroups:p.eligibleGroups,adp:p.adp,historicalGP:p.gamesPlayed,reason:p.flags.length?"quarantined-history":"insufficient-history-no-current-provider-projection"});continue;
    }
    try {forecasts.push(forecast(p,blendedPrior(p),expert,recipe));}
    catch(error) {
      if(!expert)throw error;
      const reason=error instanceof Error?error.message:String(error);
      try {
        const fallback=forecast(p,blendedPrior(p),undefined,recipe);
        fallback.flags.push("provider-projection-reconciliation-error");fallback.reviewRequired=true;
        forecasts.push(fallback);
      } catch {
        excluded.push({fantraxId:p.fantraxId,name:p.fullName,school:p.schoolLabel,eligibleGroups:p.eligibleGroups,adp:p.adp,historicalGP:p.gamesPlayed,reason:"provider-projection-rejected; "+reason});
      }
    }
  }
  const referenceIds=new Set([...cohort.map(p=>p.fantraxId),...provider.keys()]);
  const reference=forecasts.filter(p=>referenceIds.has(p.fantraxId));
  const refFG=reference.reduce((s,p)=>s+p.stats.FGM,0)/reference.reduce((s,p)=>s+p.stats.FGA,0);
  const refFT=reference.reduce((s,p)=>s+p.stats.FTM,0)/reference.reduce((s,p)=>s+p.stats.FTA,0);
  const value=(p:PlayerForecast,c:Category)=>c==="FG%"?p.stats.FGM-refFG*p.stats.FGA:c==="FT%"?p.stats.FTM-refFT*p.stats.FTA:p.stats[c];
  const moments=Object.fromEntries(CATEGORIES.map(c=>{const xs=reference.map(p=>value(p,c)),m=mean(xs),sd=Math.sqrt(mean(xs.map(x=>(x-m)**2)));if(sd<=1e-9)throw new Error(`No reference variation in ${c}`);return [c,{mean:m,sd}];})) as Record<Category,{mean:number;sd:number}>;
  const rows:Ranked[]=forecasts.map(p=>{
    const categoryZ=Object.fromEntries(CATEGORIES.map(c=>[c,(value(p,c)-moments[c].mean)/moments[c].sd])) as Record<Category,number>;
    const sorted=[...CATEGORIES].sort((a,b)=>categoryZ[b]-categoryZ[a]);
    return {...p,rank:0,draftRank:null,positionValue:0,categoryZ,categoryScore:CATEGORIES.reduce((s,c)=>s+categoryZ[c],0)/8,strengths:sorted.slice(0,3),weaknesses:sorted.slice(-3).reverse(),providerRankGap:null};
  }).sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId));
  rows.forEach((p,i)=>{p.rank=i+1;p.providerRankGap=p.providerRank===null?null:p.rank-p.providerRank;if(p.providerRankGap!==null&&Math.abs(p.providerRankGap)>40)p.flags.push("large-provider-category-rank-disagreement");if(statusIds.has(p.fantraxId))p.flags.push("known-status-default-recommendation-block");p.reviewRequired=p.flags.length>0;});
  // Five players per group per team is an explicit replacement proxy, not an exact league allocation.
  const replacement=Object.fromEntries((["G","F/C"] as const).map(g=>{const eligible=rows.filter(p=>p.eligibleGroups.includes(g)&&!statusIds.has(p.fantraxId));return [g,eligible[Math.min(39,eligible.length-1)]!.categoryScore];})) as Record<Group,number>;
  rows.forEach(p=>p.positionValue=p.categoryScore-Math.min(...p.eligibleGroups.map(g=>replacement[g])));
  const draftOrder=rows.filter(p=>!statusIds.has(p.fantraxId)).sort((a,b)=>b.positionValue-a.positionValue||(a.providerRank??Infinity)-(b.providerRank??Infinity)||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId));
  draftOrder.forEach((p,i)=>p.draftRank=i+1);
  const content={schemaVersion:1,leagueId:config.leagueId,teamId:config.teamId,season:config.rules.seasonLabel,generatedAt:asOf.toISOString(),
    status:"experimental-draft-preparation",strategy:"balanced",recipe,
    inputs:{historyRevision:history.revision,historyRawSha256:history.rawSha256,historySource:history.source,supplementHash:contentHash(supplement),provider:supplement.source,statusHash:contentHash(status)},
    statusObservations:status.observations,statusCoverage:"targeted-partial; absence of a status record is not clearance",
    reference:{size:reference.length,selection:"Usable GP>=15/MIN>=15/cached ADP<=200 plus supplemented players; fixed heuristic",priors,refFG,refFT,moments,replacement,replacementPolicy:"40th eligible nonblocked player per G/F-C group; duals can enter both groups; approximate, not a joint allocation"},
    counts:{availablePool:history.players.length,forecasted:rows.length,providerSupplemented:provider.size,coldStarts:rows.filter(p=>p.basis==="provider-plus-cold-start-prior").length,excluded:excluded.length},
    limitations:["Per-game conditional-on-playing baseline; no season games, availability probabilities, matchup win probabilities or accuracy claim.",
      "Fixed heuristic priors and weights are not fitted/calibrated. Sensitivity scenarios are minutes-only stress tests, not confidence intervals.",
      "Provider MIN/PTS/REB/AST override baseline where present; shooting, threes, steals and blocks remain modeled.",
      "Eight equal standardized category contributions are a draft heuristic, not expected category wins; FG/FT use modeled attempt-weighted impact.",
      "RotoWire ranks use a different conference/scoring scope; provider rank gaps are review flags, not proof of value. Missing provider rank means uncovered, not rejected.",
      "Historical-only current roles, transfers, injuries and eligibility need draft-day review. Cached ADP is an unvalidated market reference.",
      "Draft order subtracts a declared 40th-player positional replacement proxy and excludes known blocked statuses; it is not a solved league-wide allocation.",
      "No Fantrax rank list, queue, autopick or live pick has been changed."],rows,excluded};
  return {revision:contentHash(content),...content};
}
export type DraftBoard=ReturnType<typeof buildDraftBoard>;
const csvCell=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;
export function boardCsv(board:DraftBoard):string {
  const header=["Draft priority","Category rank","ID","Player","School","Eligibility","MIN","PTS","REB","AST","ST","BLK","3PTM","FG%","FGA","FT%","FTA","Score","Fantrax ADP","RotoWire Rank","Basis","Review flags"];
  return [header.map(csvCell).join(","),...[...board.rows].sort((a,b)=>(a.draftRank??Infinity)-(b.draftRank??Infinity)).map(p=>[p.draftRank,p.rank,p.fantraxId,p.name,p.school,p.eligibleGroups.join("/"),p.minutes.toFixed(1),...(["PTS","REB","AST","ST","BLK","3PTM"] as const).map(k=>p.stats[k].toFixed(2)),p.fg.toFixed(3),p.stats.FGA.toFixed(2),p.ft.toFixed(3),p.stats.FTA.toFixed(2),p.categoryScore.toFixed(3),p.adp,p.providerRank,p.basis,p.flags.join("; ")].map(csvCell).join(","))].join("\n")+"\n";
}
export function boardMarkdown(board:DraftBoard):string {
  const clean=(s:string)=>s.replace(/[|<>\r\n]/g," ");
  return ["# Banging 3s: experimental eight-category draft forecast","",`Built ${board.generatedAt}; strategy Balanced. ${board.counts.forecasted} / ${board.counts.availablePool} players forecasted; ${board.counts.excluded} excluded and retained in the separate review file. ${board.counts.providerSupplemented} supplemented, ${board.counts.coldStarts} modeled cold starts.`,"",
    "Use this as a draft decision aid. All values are conditional on playing; no trained-model accuracy or win probability is claimed.","",
    "## Proposed draft priority — positional proxy, status blocks applied","",...[...board.rows].filter(p=>p.draftRank!==null).sort((a,b)=>a.draftRank!-b.draftRank!).slice(0,20).map(p=>`- ${p.draftRank}. ${clean(p.name)} (${p.school}, ${p.eligibleGroups.join(",")}); category rank ${p.rank}, ADP ${p.adp??"unknown"}, RW ${p.providerRank??"uncovered"}; ${p.flags.join(", ")}.`),"",
    "## Status review — excluded from the default pick list","",...board.statusObservations.map(s=>`- ${clean(board.rows.find(p=>p.fantraxId===s.fantraxId)?.name??s.fantraxId)}: ${clean(s.reason)} [Source](${s.sourceUrl}), observed ${s.observedAt}.`),"",
    "## Top 40 — conditional category value, not a cleared autopick order","","|Rank|Player|Pos|MIN|PTS|REB|AST|ST|BLK|3PM|FG%|FT%|ADP|RW|Basis / review|","|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...board.rows.slice(0,40).map(p=>`|${p.rank}|${clean(p.name)}|${p.eligibleGroups.join(",")}|${p.minutes.toFixed(1)}|${p.stats.PTS.toFixed(1)}|${p.stats.REB.toFixed(1)}|${p.stats.AST.toFixed(1)}|${p.stats.ST.toFixed(1)}|${p.stats.BLK.toFixed(1)}|${p.stats["3PTM"].toFixed(1)}|${p.fg.toFixed(3)}|${p.ft.toFixed(3)}|${p.adp??"—"}|${p.providerRank??"—"}|${p.basis}; ${p.flags.join(", ")}|`),"",
    "## Provider-covered review lane","",...board.rows.filter(p=>p.providerRank!==null).sort((a,b)=>a.providerRank!-b.providerRank!).map(p=>`- ${clean(p.name)}: RW ${p.providerRank}, our category rank ${p.rank}; ${p.flags.join("; ")||"no additional automatic flag"}.`),"",
    "## Method and limits","",...board.limitations.map(s=>`- ${s}`),"",
    "## Unmodeled review lane — cached ADP order only, not forecasts","",...board.excluded.filter(p=>p.adp!==null).sort((a,b)=>a.adp!-b.adp!).slice(0,20).map(p=>`- ${clean(p.name)} (${p.school}, ${p.eligibleGroups.join(",")}), ADP ${p.adp}; ${p.reason}.`),"",
    `Reference FG ${board.reference.refFG.toFixed(3)}, FT ${board.reference.refFT.toFixed(3)}; ${board.reference.size} draft-reference players. Recipe parameters, every forecast component, scenario values and source hashes are in board.json.`,"",
    `[RotoWire supplement](${board.inputs.provider.url}), publication label: ${clean(board.inputs.provider.publishedLabel)}; earliest component observed ${board.inputs.provider.observedAt}; history observed ${board.inputs.historySource.observedAt}. Retrieval age is not projection publication age.`,"",
    `Revision: ${board.revision}. No platform action executed.`,""].join("\n");
}
export async function saveDraftBoard(root:string,config:BasketballConfig,board:DraftBoard,out:string):Promise<void> {
  const privateDir=join(leagueDirectory(root,config),"draft-boards",board.revision);await mkdir(privateDir,{recursive:true});await mkdir(out,{recursive:true});
  const reviewCsv=[["ID","Player","School","Eligibility","Cached ADP","Historical GP","Reason"].map(csvCell).join(","),...board.excluded.map(p=>[p.fantraxId,p.name,p.school,p.eligibleGroups.join(","),p.adp,p.historicalGP,p.reason].map(csvCell).join(","))].join("\n")+"\n";
  const proposed=[...board.rows].filter(p=>p.draftRank!==null).sort((a,b)=>a.draftRank!-b.draftRank!).map(p=>[p.name,p.school].map(csvCell).join(",")).join("\n")+"\n";
  for(const [name,text] of [["board.json",JSON.stringify(board,null,2)+"\n"],["board.csv",boardCsv(board)],["board.md",boardMarkdown(board)],["unmodeled-review.csv",reviewCsv],["fantrax-rank-import.PROPOSED.csv",proposed]]){
    await immutableText(join(privateDir,name!),text!);await writeFile(join(out,name!),text!);
  }
}

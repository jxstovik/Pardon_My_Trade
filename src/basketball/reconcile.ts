import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { CATEGORIES, instant, type Category, type ProfileName } from "./contracts.js";
import { StatLineSchema, type StatLine } from "./categories.js";
import { activeSlotCount, canCompleteRoster, snakeTeam } from "./draft.js";
import { boardCsv, type DraftBoard, type PlayerForecast } from "./forecast.js";
import { contentHash, immutableText } from "./store.js";

const primitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const evidenceValue = z.union([primitive,z.array(primitive),z.record(z.string(),primitive)]);
const EvidenceRecordSchema = z.object({
  fantraxId: z.string().nullable().optional(),
  providerName: z.string().optional(),
  name: z.string().optional(),
  schoolLabel: z.string().nullable().optional(),
  values: z.record(z.string(), evidenceValue).default({}),
  missingFields: z.array(z.string()).default([]),
  fieldObservedAt: z.record(z.string(), instant.nullable()).default({}),
  disposition: z.string().optional(),
  matchMethod: z.string().optional()
}).passthrough();
const EvidenceSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["provider-projection", "provider-rank", "player-status", "available-pool", "rules", "adp"]),
  provider: z.string().min(1),
  url: z.url(), observedAt: instant, publishedAt: z.string().nullable().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  artifactPath: z.string().optional(), scope: z.string().optional(), fields: z.array(z.string()).default([]),
  records: z.array(EvidenceRecordSchema).default([])
}).passthrough();
export const ReconciliationEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  asOf: instant.optional(),
  baseline: z.object({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),revision:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough(),
  sources: z.array(EvidenceSourceSchema)
}).passthrough();
export type ReconciliationEvidence = z.infer<typeof ReconciliationEvidenceSchema>;
type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

const ScenarioConfigSchema = z.object({
  schemaVersion:z.literal(1),version:z.string(),categoryMetric:z.string(),
  replacementRankScenarios:z.array(z.object({label:z.string(),rankBy:z.enum(["category-value","positional-value"]),groupRanks:z.object({G:z.number().int().positive(),"F/C":z.number().int().positive()}).optional()})),
  minutesCases:z.array(z.enum(["low","current","high"])),priorStrengthMultipliers:z.array(z.number().finite().nonnegative()),
  profileWeights:z.record(z.enum(["balanced","guards","bigs"]),z.record(z.string(),z.number().finite())),limits:z.record(z.string(),z.string())
}).strict();
export type ReconciliationScenarios = z.infer<typeof ScenarioConfigSchema>;

const pct = (n:number,d:number):number|null=>d>0?n/d:null;
const mean = (xs:number[])=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:0;
const csvCell = (v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;
const safeText = (s:string)=>s.replace(/[\r\n|<>]/g," ");
const nameKey = (s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const schoolAliases:Record<string,string>={MSU:"Michigan State",Vand:"Vanderbilt",Fla:"Florida",Ark:"Arkansas",Ariz:"Arizona",Bama:"Alabama",Kan:"Kansas",UVA:"Virginia",BYU:"BYU",Nebras:"Nebraska",Marq:"Marquette",StJon:"St. John's",Duke:"Duke",Tenn:"Tennessee",Wisc:"Wisconsin",Lou:"Louisville",Hou:"Houston",TxTch:"Texas Tech",Stan:"Stanford",Ind:"Indiana",MissSt:"Mississippi State",TAMU:"Texas A&M",KY:"Kentucky"};
const schoolKey=(s:string)=>nameKey(schoolAliases[s]??s);
const statusValue = z.enum(["out","eligibility-uncertain"]);
const modelFields = new Set(["MIN","PTS","REB","AST","ST","BLK","3PTM","FGM","FGA","FTM","FTA"]);

function requireFreshManifest(evidence:ReconciliationEvidence, asOf:Date) {
  if(evidence.asOf && Date.parse(evidence.asOf)>asOf.getTime())throw new Error("Evidence manifest as-of timestamp is after requested as-of");
  const sourceIds=new Set<string>();
  for(const source of evidence.sources) {
    if(sourceIds.has(source.id))throw new Error("Duplicate evidence source id");
    sourceIds.add(source.id);
    if(Date.parse(source.observedAt)>asOf.getTime())throw new Error(`Future evidence source observation: ${source.id}`);
    const seenIds=new Set<string>();
    const seenProviderRanks=new Set<number>();
    for(const rec of source.records) {
      if(rec.fantraxId && seenIds.has(rec.fantraxId))throw new Error(`Duplicate evidence identity in ${source.id}`);
      if(rec.fantraxId)seenIds.add(rec.fantraxId);
      if(["provider-rank","provider-projection"].includes(source.kind)&&typeof rec.values.providerRank==="number") {
        if(!Number.isInteger(rec.values.providerRank)||rec.values.providerRank<1||seenProviderRanks.has(rec.values.providerRank))throw new Error(`Duplicate/invalid provider rank in ${source.id}`);
        seenProviderRanks.add(rec.values.providerRank);
      }
      const missing=new Set(rec.missingFields);
      if(missing.size!==rec.missingFields.length)throw new Error(`Duplicate missing field in ${source.id}`);
      for(const [field,value] of Object.entries(rec.values)) {
        if(!(field in rec.fieldObservedAt))throw new Error(`Missing field-level timestamp for ${source.id}.${field}`);
        const observed=rec.fieldObservedAt[field];
        if(observed!==null && Date.parse(observed)>asOf.getTime())throw new Error(`Future field observation: ${source.id}.${field}`);
        if(value!==null&&!source.fields.includes(field))throw new Error(`Evidence field is outside declared source scope: ${source.id}.${field}`);
        if(observed!==null&&Date.parse(observed)>Date.parse(source.observedAt))throw new Error(`Field observation is later than its source capture: ${source.id}.${field}`);
        if(value!==null&&observed===null)throw new Error(`Nonmissing evidence value lacks an observation time: ${source.id}.${field}`);
        if(value===null&&!missing.has(field))throw new Error(`Null evidence value is not explicitly marked missing: ${source.id}.${field}`);
      }
      for(const field of missing) {
        if(!(field in rec.values) || rec.values[field]!==null)throw new Error(`Missing field must have an explicit null value: ${source.id}.${field}`);
        if(rec.fieldObservedAt[field]!==null)throw new Error(`Missing field timestamp must be null: ${source.id}.${field}`);
      }
    }
  }
}

function evidenceRecordIdentity(record:EvidenceRecord, rows:PlayerForecast[], excluded:DraftBoard["excluded"]):PlayerForecast|DraftBoard["excluded"][number]|null {
  const found=record.fantraxId?[...rows,...excluded].find(p=>p.fantraxId===record.fantraxId):undefined;
  const label=record.providerName??record.name;
  if(found) {
    const declaredAlias=record.matchMethod?.toLowerCase().includes("suffix alias")===true;
    if(label && nameKey(label)!==nameKey(found.name) && !(declaredAlias&&found.fantraxId==="07a8s"&&label==="Jordan Smith Jr."&&found.name==="Jordan Smith"))throw new Error(`Evidence ID/name collision for ${found.fantraxId}`);
    if(record.schoolLabel && schoolKey(record.schoolLabel)!==schoolKey(found.school))throw new Error(`Evidence ID/school collision for ${found.fantraxId}`);
    return found;
  }
  if(record.fantraxId) return null;
  if(!label) return null;
  const byName=[...rows,...excluded].filter(p=>nameKey(p.name)===nameKey(label) && (!record.schoolLabel||schoolKey(p.school)===schoolKey(record.schoolLabel)));
  if(byName.length>1)throw new Error(`Ambiguous provider name/school identity: ${label}`);
  return byName[0]??null;
}

function numberValue(record:EvidenceRecord,key:string):number|undefined {
  const value=record.values[key];
  if(typeof value!=="number"||!Number.isFinite(value))return undefined;
  return value;
}

function newerProjectionFields(row:PlayerForecast,record:EvidenceRecord):EvidenceRecord {
  const values:EvidenceRecord["values"]={};
  const fieldObservedAt:Record<string,string|null>={};
  for(const field of Object.keys(record.values)) {
    if(!modelFields.has(field)||numberValue(record,field)===undefined)continue;
    const observed=record.fieldObservedAt[field]??null;
    const previous=row.sourceFieldObservedAt?.[field]??null;
    if(previous&&observed&&Date.parse(previous)>=Date.parse(observed))continue;
    values[field]=record.values[field]!;
    fieldObservedAt[field]=observed;
  }
  return {...record,values,fieldObservedAt,missingFields:[]};
}

function refreshProviderLine(row:PlayerForecast,record:EvidenceRecord) {
  const values=record.values;
  const update=(field:string)=>numberValue(record,field);
  const MIN=update("MIN"), PTS=update("PTS"), REB=update("REB"), AST=update("AST");
  const ST=update("ST"),BLK=update("BLK"),three=update("3PTM");
  const directFields=["FGM","FGA","FTM","FTA"].map(k=>update(k));
  const directPresent=directFields.some(v=>v!==undefined);
  if(directPresent&&directFields.some(v=>v===undefined))throw new Error("Provider direct shooting line is partial for "+row.fantraxId);
  let stats={...row.stats};
  if(directPresent) {
    const FGM=update("FGM")!,FGA=update("FGA")!,FTM=update("FTM")!,FTA=update("FTA")!,threes=three??stats["3PTM"];
    const directPTS=2*FGM+threes+FTM;
    if(PTS!==undefined&&Math.abs(directPTS-PTS)>1e-6)throw new Error("Direct provider shooting line does not reconcile PTS for "+row.fantraxId);
    stats={...stats,FGM,FGA,FTM,FTA,"3PTM":threes,PTS:directPTS};
  } else if(PTS!==undefined || three!==undefined) {
    // Keep provider 3PTM fixed. Scale only the modeled two-point/free-throw line.
    const fixedThree=three??stats["3PTM"];
    const baseNonThree=2*row.fg*stats.FGA+row.ft*stats.FTA;
    const targetNonThree=PTS===undefined?(row.sourceFields.includes("PTS")?row.stats.PTS-fixedThree:baseNonThree):PTS-fixedThree;
    if(targetNonThree<0 || baseNonThree<=0)throw new Error("Provider PTS/3PTM cannot be reconciled for "+row.fantraxId);
    const scale=targetNonThree/baseNonThree;
    const FGA=stats.FGA*scale,FTA=stats.FTA*scale,FGM=row.fg*FGA,FTM=row.ft*FTA;
    stats={...stats,FGA,FGM,FTA,FTM,"3PTM":fixedThree,PTS:2*FGM+fixedThree+FTM};
    if(three!==undefined && three>FGM+1e-9)throw new Error("Provider three-pointers exceed reconciled field goals for "+row.fantraxId);
    if(PTS!==undefined&&Math.abs(stats.PTS-PTS)>1e-6)throw new Error("Provider points line does not reconcile for "+row.fantraxId);
  }
  if(REB!==undefined)stats.REB=REB;
  if(AST!==undefined)stats.AST=AST;
  if(ST!==undefined)stats.ST=ST;
  if(BLK!==undefined)stats.BLK=BLK;
  if(three!==undefined&&directPresent&&three>stats.FGM+1e-9)throw new Error("Provider three-pointers exceed reconciled field goals for "+row.fantraxId);
  stats=StatLineSchema.parse(stats);
  const numericFields=Object.keys(values).filter(k=>modelFields.has(k)&&typeof values[k]==="number"&&Number.isFinite(values[k] as number));
  const sourceFields=[...new Set([...row.sourceFields,...numericFields])];
  const modeledFields=row.modeledFields.filter(k=>!sourceFields.includes(k));
  const minutes=MIN??row.minutes;
  const fraction=row.basis==="provider-plus-cold-start-prior"?.4:row.basis==="provider-plus-model"?.2:.3;
  const scenarioMinutes={low:minutes*(1-fraction),high:Math.min(40,minutes*(1+fraction))};
  const scaled=(m:number)=>StatLineSchema.parse(Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v*m/minutes])));
  const sourceFieldObservedAt={...row.sourceFieldObservedAt};
  for(const field of numericFields)sourceFieldObservedAt[field]=record.fieldObservedAt[field]??null;
  const basis=row.basis==="historical-shrinkage"?(row.historicalGP>0?"provider-plus-model":"provider-plus-cold-start-prior"):row.basis;
  return {...row,basis,minutes,stats,fg:stats.FGA?stats.FGM/stats.FGA:row.fg,ft:stats.FTA?stats.FTM/stats.FTA:row.ft,
    scenarioMinutes,sensitivity:{low:scaled(scenarioMinutes.low),high:scaled(scenarioMinutes.high)},sourceFieldObservedAt,
    sourceFields,modeledFields,flags:[...row.flags,"verified-provider-update"],reviewRequired:true};
}

function aggregateReference(rows:PlayerForecast[]) {
    const fga=rows.reduce((n,p)=>n+p.stats.FGA,0),fta=rows.reduce((n,p)=>n+p.stats.FTA,0);
  const fg=pct(rows.reduce((n,p)=>n+p.stats.FGM,0),fga),ft=pct(rows.reduce((n,p)=>n+p.stats.FTM,0),fta);
  if(fg===null||ft===null)throw new Error("Candidate pool has no coherent shooting exposure");
  const value=(p:PlayerForecast,c:Category)=>c==="FG%"?p.stats.FGM-fg*p.stats.FGA:c==="FT%"?p.stats.FTM-ft*p.stats.FTA:p.stats[c];
  const moments=Object.fromEntries(CATEGORIES.map(c=>{const xs=rows.map(p=>value(p,c)),m=mean(xs),sd=Math.sqrt(mean(xs.map(x=>(x-m)**2)));if(sd<=1e-9)throw new Error(`No normalization variation for ${c}`);return [c,{mean:m,sd}];})) as Record<Category,{mean:number;sd:number}>;
  return {refFG:fg,refFT:ft,moments,value};
}

type ScoredRow=PlayerForecast & {rank:number;draftRank:number|null;positionValue:number;categoryScore:number;categoryZ:Record<Category,number>;strengths:Category[];weaknesses:Category[];providerRankGap:number|null};
function scoreRows(rows:PlayerForecast[],refFG:number,refFT:number,moments:Record<Category,{mean:number;sd:number}>):ScoredRow[] {
  const value=(p:PlayerForecast,c:Category)=>c==="FG%"?p.stats.FGM-refFG*p.stats.FGA:c==="FT%"?p.stats.FTM-refFT*p.stats.FTA:p.stats[c];
  return rows.map(p=>{
    const categoryZ=Object.fromEntries(CATEGORIES.map(c=>[c,(value(p,c)-moments[c].mean)/moments[c].sd])) as Record<Category,number>;
    const categoryScore=CATEGORIES.reduce((s,c)=>s+categoryZ[c],0)/CATEGORIES.length;
    const sorted=[...CATEGORIES].sort((a,b)=>categoryZ[b]-categoryZ[a]||CATEGORIES.indexOf(a)-CATEGORIES.indexOf(b));
    return {...p,rank:0,draftRank:null as number|null,positionValue:categoryScore,categoryScore,categoryZ,strengths:sorted.slice(0,3),weaknesses:sorted.slice(-3).reverse(),providerRankGap:null as number|null};
  }).sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId)).map((row,i)=>{
    row.rank=i+1;row.draftRank=row.rank;row.providerRankGap=row.providerRank===null?null:row.rank-row.providerRank;return row;
  });
}

function rankOrder(rows:ScoredRow[],scenario:ReconciliationScenarios["replacementRankScenarios"][number],statusIds:Set<string>) {
  if(scenario.rankBy==="category-value")return [...rows].filter(p=>!statusIds.has(p.fantraxId)).sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId));
  const cutoffs=scenario.groupRanks!;
  const replacement=Object.fromEntries(([["G",cutoffs.G],["F/C",cutoffs["F/C"]]] as const).map(([group,n])=>{
    const ordered=rows.filter(p=>p.eligibleGroups.includes(group)&&!statusIds.has(p.fantraxId)).sort((a,b)=>b.categoryScore-a.categoryScore||a.fantraxId.localeCompare(b.fantraxId));
    return [group,ordered[Math.min(n-1,ordered.length-1)]?.categoryScore??0];
  })) as Record<"G"|"F/C",number>;
  return [...rows].filter(p=>!statusIds.has(p.fantraxId)).sort((a,b)=>{
    const av=a.categoryScore-Math.min(...a.eligibleGroups.map(g=>replacement[g]));
    const bv=b.categoryScore-Math.min(...b.eligibleGroups.map(g=>replacement[g]));
    return bv-av||(a.providerRank??Infinity)-(b.providerRank??Infinity)||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId);
  });
}

function rankMap(rows:ScoredRow[],ids?:Set<string>) {
  const selected=ids?[...rows].filter(p=>ids.has(p.fantraxId)):[...rows];
  return new Map(selected.sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId)).map((p,i)=>[p.fantraxId,i+1]));
}

function categorySensitivity(rows:ScoredRow[]) {
  const scoresFor=(row:ScoredRow,categories:Category[])=>mean(categories.map(c=>row.categoryZ[c]));
  const variants:[string,Category[]][]=[...CATEGORIES.map(c=>[`without-${c}`,CATEGORIES.filter(k=>k!==c)] as [string,Category[]]),
    ["without-percentages",CATEGORIES.filter(c=>c!=="FG%"&&c!=="FT%")],
    ["without-stocks",CATEGORIES.filter(c=>c!=="ST"&&c!=="BLK")],
    ["percentages-only",["FG%","FT%"]],
    ["stocks-only",["ST","BLK"]]];
  return variants.map(([label,cats])=>({label,categories:cats,rows:[...rows].map(p=>({fantraxId:p.fantraxId,score:scoresFor(p,cats)})).sort((a,b)=>b.score-a.score||a.fantraxId.localeCompare(b.fantraxId)).map((p,i)=>({...p,rank:i+1}))}));
}

function minutesScenarioRows(rows:ScoredRow[],caseName:"low"|"current"|"high",refFG:number,refFT:number,moments:Record<Category,{mean:number;sd:number}>) {
  const score=(row:ScoredRow)=>{
    const stat=caseName==="current"?row.stats:row.sensitivity[caseName];
    const zs=CATEGORIES.map(c=>{const x=c==="FG%"?stat.FGM-refFG*stat.FGA:c==="FT%"?stat.FTM-refFT*stat.FTA:stat[c];return (x-moments[c].mean)/moments[c].sd;});
    return mean(zs);
  };
  return [...rows].map(p=>({fantraxId:p.fantraxId,score:score(p)})).sort((a,b)=>b.score-a.score||a.fantraxId.localeCompare(b.fantraxId)).map((p,i)=>({...p,rank:i+1}));
}

function providerScoringEvidence(evidence:ReconciliationEvidence,modelRows:ScoredRow[]) {
  const ruleSources=evidence.sources.filter(s=>s.kind==="rules"&&s.provider.toLowerCase().includes("rotowire"));
  const rules=ruleSources.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  const rawWeights=rules?.records[0]?.values.scoringWeights;
  const weights=rawWeights&&typeof rawWeights==="object"&&!Array.isArray(rawWeights)?rawWeights as Record<string,unknown>:{ };
  const numericWeights=Object.fromEntries(Object.entries(weights).filter(([,v])=>typeof v==="number"&&Number.isFinite(v))) as Record<string,number>;
  const bonusDefinitionsMissing=rules?.records[0]?.values.missingBonusEventDefinitions===true;
  const coreTerms=["PTS","REB","AST","3PTM","ST","BLK","TO"];
  const allTerms=[...coreTerms,"DD","TD"];
  const byId=new Map<string,{values:Record<string,number>;fieldObservedAt:Record<string,string>;sources:Set<string>;name:string|null;school:string|null}>();
  for(const source of evidence.sources.filter(s=>s.kind==="provider-projection").sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt))) {
    for(const record of source.records) {
      if(!record.fantraxId)continue;
      const current=byId.get(record.fantraxId)??{values:{},fieldObservedAt:{},sources:new Set<string>(),name:record.providerName??record.name??null,school:record.schoolLabel??null};
      current.sources.add(source.id);
      for(const field of allTerms) {
        const value=numberValue(record,field);if(value===undefined)continue;
        const observed=record.fieldObservedAt[field]??source.observedAt,previous=current.fieldObservedAt[field];
        if(previous&&Date.parse(previous)>=Date.parse(observed))continue;
        current.values[field]=value;current.fieldObservedAt[field]=observed;
      }
      byId.set(record.fantraxId,current);
    }
  }
  const candidates=[...byId.entries()].flatMap(([fantraxId,row])=>{
    const weighted=coreTerms.filter(field=>row.values[field]!==undefined&&numericWeights[field]!==undefined);
    if(!weighted.length)return [];
    const partialScore=weighted.reduce((sum,field)=>sum+row.values[field]!*numericWeights[field]!,0);
    const completeCore=coreTerms.every(field=>row.values[field]!==undefined&&numericWeights[field]!==undefined);
    const bonusMissing=bonusDefinitionsMissing||["DD","TD"].some(field=>row.values[field]===undefined);
    return [{fantraxId,...row,weighted,partialScore,completeCore,bonusMissing}];
  });
  const modelIds=new Set(modelRows.map(p=>p.fantraxId));
  const commonCore=candidates.filter(p=>p.completeCore&&modelIds.has(p.fantraxId)).sort((a,b)=>b.partialScore-a.partialScore||a.fantraxId.localeCompare(b.fantraxId));
  const providerRank=new Map(commonCore.map((row,i)=>[row.fantraxId,i+1]));
  const commonModelRows=modelRows.filter(row=>providerRank.has(row.fantraxId)).sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId));
  const commonModelRank=new Map(commonModelRows.map((row,i)=>[row.fantraxId,i+1]));
  const rowReports=candidates.map(row=>{
    const model=modelRows.find(p=>p.fantraxId===row.fantraxId);
    const missing=allTerms.filter(field=>row.values[field]===undefined);
    const missingWeighted=allTerms.filter(field=>numericWeights[field]!==undefined&&row.values[field]===undefined);
    return {sourceIds:[...row.sources],fantraxId:row.fantraxId,providerName:row.name,school:row.school,
      verifiedProjectionValues:row.values,fieldObservedAt:row.fieldObservedAt,
      categoryRank:model?.rank??null,providerCorePointsPartialScore:row.partialScore,providerCorePointsRank:providerRank.get(row.fantraxId)??null,
      providerCorePointsTerms:row.weighted.map(field=>({field,value:row.values[field],weight:numericWeights[field]})),
      missingWeightedTerms:missingWeighted,missingProjectionFields:missing,
      missingBonusEventDefinitions:bonusDefinitionsMissing,bonusRatesExcludedFromComparableCore:["DD","TD"],
      fullProviderScore:null,fullScoreReason:"Provider-described weights are not verified league scoring; TO and/or double-/triple-double event definitions or rates are missing.",
      modelVsProviderCommonPool:row.completeCore&&model?{commonPoolSize:commonCore.length,providerPartialRank:providerRank.get(row.fantraxId),modelCategoryRankWithinSamePlayers:commonModelRank.get(row.fantraxId),globalModelCategoryRank:model.rank}:null};
  });
  return {rules:{provider:rules?.provider??null,url:rules?.url??null,observedAt:rules?.observedAt??null,scope:rules?.scope??null,weights:numericWeights,classification:"provider-described scoring; not independently verified league scoring",missingBonusEventDefinitions:bonusDefinitionsMissing},
    comparablePool:{rankMetric:"Provider-described DK core partial points using PTS/REB/AST/3PTM/ST/BLK/TO only, compared against eight-category model ranks for the exact same IDs.",commonPoolSize:commonCore.length,
      rows:commonCore.map(row=>({fantraxId:row.fantraxId,providerCorePartialRank:providerRank.get(row.fantraxId),providerCorePartialScore:row.partialScore,modelCategoryRankGlobal:modelRows.find(p=>p.fantraxId===row.fantraxId)?.rank??null,modelCategoryRankWithinSamePlayers:commonModelRank.get(row.fantraxId)??null,missingBonusEventDefinitions:bonusDefinitionsMissing,fullProviderScore:null}))},
    rows:rowReports,note:"Partial sums use only supplied numeric weighted fields. The comparable rank pool requires all seven non-bonus core terms; DD/TD remain excluded because bonus definitions are missing. Full provider score remains null."};
}

function priorityUnion(base:DraftBoard,rows:ScoredRow[],excluded:DraftBoard["excluded"],sources:EvidenceSource[],availableIds?:Set<string>) {
  const ids=new Set<string>();
  const knownIds=new Set([...rows,...excluded].map(p=>p.fantraxId));
  const frozenIds=new Set([...base.rows,...base.excluded].map(p=>p.fantraxId));
  for(const p of base.rows)if(p.draftRank!==null&&p.draftRank<=112)ids.add(p.fantraxId);
  for(const p of rows)if(p.providerRank!==null&&p.providerRank<=200)ids.add(p.fantraxId);
  for(const p of rows)if(p.adp!==null&&p.adp<=200)ids.add(p.fantraxId);
  for(const p of excluded)if(p.adp!==null&&p.adp<=200)ids.add(p.fantraxId);
  const unresolved:Record<string,unknown>[]=[];
  for(const source of sources)for(const record of source.records) {
    if(source.kind==="available-pool"&&(record.values.priorityReview===true||record.disposition==="priority-review")) {
      if(record.fantraxId)ids.add(record.fantraxId);
      else unresolved.push({sourceId:source.id,providerName:record.providerName??record.name??null,schoolLabel:record.schoolLabel??null,values:record.values,missingFields:record.missingFields,reason:"identity-unmatched; review only"});
    }
    if(source.kind==="available-pool"&&record.values.available===true&&record.fantraxId&&!frozenIds.has(record.fantraxId))ids.add(record.fantraxId);
    if(["provider-rank","provider-projection"].includes(source.kind)&&typeof record.values.providerRank==="number"&&(!record.fantraxId||!knownIds.has(record.fantraxId)||(availableIds&&!availableIds.has(record.fantraxId)))) unresolved.push({sourceId:source.id,provider:source.provider,fantraxId:record.fantraxId??null,providerName:record.providerName??record.name??null,schoolLabel:record.schoolLabel??null,providerRank:record.values.providerRank,reason:"provider identity is unmatched or not in the current available export; review only"});
  }
  if(availableIds)for(const id of [...ids])if(!availableIds.has(id))ids.delete(id);
  return {ids,unresolved};
}

function applyCompletePoolEvidence(rows:PlayerForecast[],excluded:DraftBoard["excluded"],sources:EvidenceSource[],priorBoard?:DraftBoard) {
  const candidates=sources.filter(s=>s.kind==="available-pool").sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
  if(!candidates.length)return {rows,excluded,poolCount:null,removed:[] as Record<string,unknown>[],added:[] as Record<string,unknown>[],source:null as EvidenceSource|null};
  const source=candidates[0]!;
  const scope=(source.scope??"").toLowerCase();
  if(!/(all|full|complete)/.test(scope)||!/(available|pool|player)/.test(scope))throw new Error("Available-pool evidence must declare a complete current pool scope before membership can filter candidates");
  const current=new Map<string,EvidenceRecord>();
  const unresolved:Record<string,unknown>[]=[];
  for(const record of source.records) {
    if(typeof record.values.available!=="boolean")throw new Error(`Complete pool record lacks boolean available field in ${source.id}`);
    const groups=record.values.eligibleGroups;
    if(!Array.isArray(groups)||groups.some(x=>x!=="G"&&x!=="F/C"))throw new Error(`Complete pool record lacks verified G/F-C eligibility in ${source.id}`);
    if(record.values.available&&record.fantraxId)current.set(record.fantraxId,record);
    else if(record.values.available&&!record.fantraxId)unresolved.push({providerName:record.providerName??record.name??null,schoolLabel:record.schoolLabel??null,reason:"available pool row has no stable Fantrax ID"});
  }
  const known=new Set([...rows,...excluded].map(p=>p.fantraxId));
  const previousIds=new Set(priorBoard?[...priorBoard.rows,...priorBoard.excluded].map(p=>p.fantraxId):[...rows,...excluded].map(p=>p.fantraxId));
  const removed:Record<string,unknown>[]=[];
  const previousRows=priorBoard?[...priorBoard.rows,...priorBoard.excluded]:[...rows,...excluded];
  const absentForecasts=previousRows.filter(p=>!current.has(p.fantraxId));
  for(const p of absentForecasts)removed.push({fantraxId:p.fantraxId,name:p.name,school:p.school,reason:"Not present in the fresh complete available-player export; absence does not establish why."});
  const keptRows=rows.filter(p=>current.has(p.fantraxId));
  const keptExcluded=[...excluded];
  const added:Record<string,unknown>[]=[];
  for(const [id,record] of current) {
    const name=record.providerName??record.name;
    const groups=(record.values.eligibleGroups as string[]).filter((g):g is "G"|"F/C"=>g==="G"||g==="F/C");
    if(!previousIds.has(id))added.push({fantraxId:id,name:name??null,school:record.schoolLabel??null,eligibleGroups:groups,forecastAvailable:rows.some(p=>p.fantraxId===id),reason:"Newly present in the fresh complete available-player export; membership change only, not a ranking or forecast."});
    if(known.has(id))continue;
    if(!name||!record.schoolLabel) {unresolved.push({fantraxId:id,providerName:name??null,schoolLabel:record.schoolLabel??null,reason:"Newly observed pool identity lacks a complete name/school; review only"});continue;}
    const row={fantraxId:id,name,school:record.schoolLabel,eligibleGroups:groups,adp:numberValue(record,"adp")??null,historicalGP:0,reason:"Present in fresh available pool; no verified forecast revision is available."};
    keptExcluded.push(row);
  }
  return {rows:keptRows,excluded:keptExcluded,poolCount:current.size,removed,added,unresolved,source};
}

function nativeImportIdentityConflicts(source:EvidenceSource|null) {
  const groups=new Map<string,{fantraxId:string;name:string;school:string}[]>();
  for(const record of source?.records??[]) {
    if(record.values.available!==true||!record.fantraxId)continue;
    const name=record.providerName??record.name,school=record.schoolLabel;
    if(!name||!school)continue;
    const key=nameKey(name)+"|"+schoolKey(school),rows=groups.get(key)??[];
    rows.push({fantraxId:record.fantraxId,name,school});groups.set(key,rows);
  }
  const conflicts=[...groups.values()].filter(rows=>new Set(rows.map(p=>p.fantraxId)).size>1);
  return {ids:new Set(conflicts.flatMap(rows=>rows.map(p=>p.fantraxId))),rows:conflicts};
}

function exactCategoryAndNormalizationDiagnostics(base:DraftBoard,rows:ScoredRow[],excluded:DraftBoard["excluded"],union:Set<string>,freshness:Record<string,unknown>) {
  const globalRanks=rankMap(rows),reviewUnionRanks=rankMap(rows,union);
  const globalPool=rows.filter(p=>p.stats.FGA>0&&p.stats.FTA>0);
  const allReference=aggregateReference(globalPool);
  const recomputedRows=scoreRows(globalPool,allReference.refFG,allReference.refFT,allReference.moments);
  const recomputedRank=rankMap(recomputedRows);
  const matched=rows.filter(p=>p.providerRank!==null);
  const matchedIds=new Set(matched.map(p=>p.fantraxId)),matchedGlobalRanks=rankMap(rows,matchedIds);
  const matchedPool=matched.filter(p=>p.stats.FGA>0&&p.stats.FTA>0);
  let matchedNormalization:Record<string,unknown>;
  try {
    const matchReference=aggregateReference(matchedPool),matchedRows=scoreRows(matchedPool,matchReference.refFG,matchReference.refFT,matchReference.moments);
    const matchedPoolRank=rankMap(matchedRows);
    matchedNormalization={status:"computed",reference:{refFG:matchReference.refFG,refFT:matchReference.refFT,moments:matchReference.moments,poolSize:matchedPool.length,selection:"exact model/provider identity intersection with positive FGA and FTA"},
      rankChanges:matchedPool.map(p=>({fantraxId:p.fantraxId,globalRank:p.rank,matchedPoolRank:matchedPoolRank.get(p.fantraxId)??null}))};
  } catch(error) {matchedNormalization={status:"unavailable",poolSize:matchedPool.length,matchedIdentityCount:matched.length,reason:error instanceof Error?error.message:String(error)};}
  const providerRanks=new Map([...matched].sort((a,b)=>(a.providerRank??Infinity)-(b.providerRank??Infinity)||a.fantraxId.localeCompare(b.fantraxId)).map((p,i)=>[p.fantraxId,i+1]));
  const candidateById=new Map<string,PlayerForecast|DraftBoard["excluded"][number]>([...rows,...excluded].map(p=>[p.fantraxId,p]));
  return {
    normalizationComparison:{frozen:{refFG:base.reference.refFG,refFT:base.reference.refFT,moments:base.reference.moments,selection:base.reference.selection,poolSize:base.reference.size},
      recomputedGlobal:{refFG:allReference.refFG,refFT:allReference.refFT,moments:allReference.moments,poolSize:globalPool.length,selection:"all forecasted board identities with positive FGA and FTA; diagnostic only"},
      recomputedMatchedProvider:matchedNormalization,
      rankChanges:rows.filter(p=>union.has(p.fantraxId)).map(p=>({fantraxId:p.fantraxId,frozenRank:p.rank,recomputedGlobalRank:recomputedRank.get(p.fantraxId)??null,delta:(recomputedRank.get(p.fantraxId)??p.rank)-p.rank}))},
    commonPoolVsGlobal:{poolSizes:{globalForecasted:rows.length,providerModelIntersection:matched.length,priorityReviewUnion:union.size},rows:matched.map(p=>({fantraxId:p.fantraxId,name:p.name,school:p.school,globalModelRank:globalRanks.get(p.fantraxId)??null,modelRankWithinProviderIntersection:matchedGlobalRanks.get(p.fantraxId)??null,providerRank:p.providerRank,providerRankWithinSameIntersection:providerRanks.get(p.fantraxId)??null,adp:p.adp,fields:p.sourceFields,flags:p.flags}))},
    priorityReviewUnionRanks:[...union].map(fantraxId=>{const p=candidateById.get(fantraxId);return {fantraxId,name:p?.name??null,school:p?.school??null,rankWithinReviewUnion:reviewUnionRanks.get(fantraxId)??null,globalModelRank:globalRanks.get(fantraxId)??null,forecastAvailable:globalRanks.has(fantraxId),unforecastedReason:p&&!("stats" in p)?p.reason:null};}),
    exactEightCategoryContributions:rows.map(p=>({fantraxId:p.fantraxId,categoryContributions:p.categoryZ,totalAverage:p.categoryScore})),
    leaveOneCategoryAndGroupedRanks:categorySensitivity(rows),
    rankEvidenceFreshness:freshness
  };
}

function outlierCards(rows:ScoredRow[],unresolved:Record<string,unknown>[]) {
  const top20=rows.filter(p=>p.providerRank!==null&&p.providerRank<=20).sort((a,b)=>a.providerRank!-b.providerRank!);
  const top20Outliers=[...top20].sort((a,b)=>Math.abs(b.providerRankGap??0)-Math.abs(a.providerRankGap??0)||a.providerRank!-b.providerRank!).slice(0,7).map(p=>({fantraxId:p.fantraxId,name:p.name,school:p.school,providerRank:p.providerRank,modelCategoryRank:p.rank,rankGap:p.providerRankGap,disposition:"unresolved" as const,reason:p.rank>112?"Provider-top20/model-outside-top112; preserve for human review, do not tune either rank.":"Largest absolute rank discrepancies in provider top20; preserve for human review, do not tune either rank."}));
  const historicalOnly=rows.filter(p=>p.providerRank===null&&p.rank<=40).slice(0,40).map(p=>({fantraxId:p.fantraxId,name:p.name,school:p.school,providerRank:null,modelCategoryRank:p.rank,historicalGP:p.historicalGP,disposition:"unresolved" as const,reason:"Historical-only high candidate; current role/projection coverage is absent."}));
  return {top20Outliers,historicalOnly,unmatchedPoolRows:unresolved,dispositionGuide:{"data-error":"verified identity or impossible arithmetic contradiction","format":"source presentation/schema interpretation issue","projection":"same-identity projection difference with explicit same-field provenance","unresolved":"evidence does not resolve current projection/rank disagreement"}};
}

function enrichOutlierCards<T extends {fantraxId:string;reason:string},U extends {fantraxId:string;reason:string}>(cards:{top20Outliers:T[];historicalOnly:U[]},rows:ScoredRow[],baseline:DraftBoard,diagnostics:ReturnType<typeof exactCategoryAndNormalizationDiagnostics>,priorStrength:Record<string,any>[],roleNotes:Record<string,unknown>[],statuses:DraftBoard["statusObservations"],sources:EvidenceSource[],projectionErrors:Record<string,unknown>[]) {
  const rowById=new Map(rows.map(row=>[row.fantraxId,row]));
  const baselineById=new Map(baseline.rows.map(row=>[row.fantraxId,row]));
  const contributions=new Map(diagnostics.exactEightCategoryContributions.map(row=>[row.fantraxId,row.categoryContributions]));
  const variants=diagnostics.leaveOneCategoryAndGroupedRanks.filter(variant=>variant.label.startsWith("without-"));
  const ranksByVariant=new Map(variants.map(variant=>[variant.label,new Map(variant.rows.map(row=>[row.fantraxId,row.rank]))]));
  const publicProjectionById=new Map<string,{sourceId:string;provider:string;url:string;observedAt:string;fields:Record<string,{value:number;observedAt:string|null}>}[]>();
  const providerRankById=new Map<string,{sourceId:string;provider:string;url:string;scope:string|null;rank:number;observedAt:string|null}[]>();
  for(const source of sources) for(const record of source.records) {
    if(!record.fantraxId)continue;
    if(source.kind==="provider-projection") {
      const fields:Record<string,{value:number;observedAt:string|null}>={};
      for(const field of modelFields) {const value=numberValue(record,field);if(value!==undefined)fields[field]={value,observedAt:record.fieldObservedAt[field]??null};}
      if(Object.keys(fields).length)publicProjectionById.set(record.fantraxId,[...(publicProjectionById.get(record.fantraxId)??[]),{sourceId:source.id,provider:source.provider,url:source.url,observedAt:source.observedAt,fields}]);
    }
    if(source.kind==="provider-rank"||source.kind==="provider-projection") {
      const rank=numberValue(record,"providerRank");
      if(rank!==undefined)providerRankById.set(record.fantraxId,[...(providerRankById.get(record.fantraxId)??[]),{sourceId:source.id,provider:source.provider,url:source.url,scope:source.scope??null,rank,observedAt:record.fieldObservedAt.providerRank??null}]);
    }
  }
  const attach=<C extends {fantraxId:string;reason:string}>(card:C)=>{
    const row=rowById.get(card.fantraxId),old=baselineById.get(card.fantraxId);
    if(!row)return {...card,baselineCategoryRank:old?.rank??null,baselineDraftPriority:old?.draftRank??null,newCategoryRank:null,newDraftPriority:null,
      categoryContributions:null,largestCategoryAblationRankShifts:[],frozenPriorStrengthRankResults:[],fieldProvenance:null,evidenceQuality:{status:"unforecasted; no model statistics available"},roleStatusNotes:{role:[],status:null}};
    const categoryContributions=contributions.get(card.fantraxId)??row.categoryZ;
    const largestCategoryAblationRankShifts=variants.flatMap(variant=>{
      const ablatedRank=ranksByVariant.get(variant.label)?.get(card.fantraxId);
      return ablatedRank===undefined?[]:[{variant:variant.label,category:variant.label.slice("without-".length),baselineCategoryValueRank:row.rank,ablatedRank,rankShift:ablatedRank-row.rank}];
    }).sort((a,b)=>Math.abs(b.rankShift)-Math.abs(a.rankShift)||a.variant.localeCompare(b.variant)).slice(0,3);
    const priorResults=priorStrength.map(scenario=>{
      const match=(scenario.rankChanges??[]).find((change:Record<string,unknown>)=>change.fantraxId===card.fantraxId);
      return {multiplier:scenario.multiplier,status:scenario.status,context:"frozen-history-source replay; baseline board comparison",baselineCategoryRank:match?.baselineCategoryRank??old?.rank??null,replayCategoryRank:match?.replayCategoryRank??null,categoryRankDelta:match?.categoryRankDelta??null};
    });
    const providerProjectionFields=publicProjectionById.get(card.fantraxId)??[];
    const providerRankEvidence=providerRankById.get(card.fantraxId)??[];
    const sourceFields=row.sourceFields.map(field=>({field,observedAt:row.sourceFieldObservedAt?.[field]??null}));
    const modelOnlyFields=row.modeledFields.filter(field=>!row.sourceFields.includes(field));
    const strongest=[...Object.entries(categoryContributions as Record<string,number>)].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,3).map(([category,value])=>`${category} ${value>=0?"+":""}${value.toFixed(2)} SD`);
    const explanation=`${card.reason} Largest category terms: ${strongest.join(", ")||"none"}. ${sourceFields.length} sourced fields and ${modelOnlyFields.length} model-estimated fields (${modelOnlyFields.slice(0,5).join(", ")||"none"}); current disagreement remains unresolved.`;
    const role=roleNotes.filter(note=>note.fantraxId===card.fantraxId);
    const status=statuses.find(item=>item.fantraxId===card.fantraxId)??null;
    return {...card,reason:explanation,baselineCategoryRank:old?.rank??null,baselineDraftPriority:old?.draftRank??null,newCategoryRank:row.rank,newDraftPriority:status?null:row.rank,
      categoryContributions,largestCategoryAblationRankShifts,frozenPriorStrengthRankResults:priorResults,
      fieldProvenance:{basis:row.basis,sourcedFields:sourceFields,modeledFields:modelOnlyFields,fieldObservedAt:row.sourceFieldObservedAt??{}},
      evidenceQuality:{providerRank:row.providerRank,rankEvidence:providerRankEvidence,publicProjectionEvidence:providerProjectionFields,
        providerProjectionFields:[...new Set(providerProjectionFields.flatMap(source=>Object.keys(source.fields)))],modelOnlyFields,
        projectionErrors:projectionErrors.filter(error=>error.fantraxId===card.fantraxId),
        note:"Public projection evidence is partial and shown only for fields actually present in source records; missing fields remain modeled or unavailable."},
      roleStatusNotes:{role,roleEvidenceIsClearance:false,status:status?{status:status.status,observedAt:status.observedAt,sourceUrl:status.sourceUrl,reason:status.reason}:null}};
  };
  return {...cards,top20Outliers:cards.top20Outliers.map(attach),historicalOnly:cards.historicalOnly.map(attach)};
}

function exactTeamLine(rows:PlayerForecast[]) {
  const stats=rows.reduce((s,p)=>{for(const k of Object.keys(s) as (keyof StatLine)[])s[k]+=p.stats[k];return s;},{PTS:0,REB:0,AST:0,ST:0,BLK:0,"3PTM":0,FGM:0,FGA:0,FTM:0,FTA:0} satisfies StatLine);
  return {players:rows.map(p=>p.fantraxId),count:rows.length,FGM:stats.FGM,FGA:stats.FGA,FG:pct(stats.FGM,stats.FGA),FTM:stats.FTM,FTA:stats.FTA,FT:pct(stats.FTM,stats.FTA)};
}

function profileScore(row:ScoredRow,weights:Record<string,number>) {
  return CATEGORIES.reduce((s,c)=>s+(row.categoryZ[c]??0)*(weights[c]??1),0)/CATEGORIES.length;
}
function activeTen(rows:ScoredRow[],weights:Record<string,number>):ScoredRow[] {
  let best:ScoredRow[]|null=null,bestScore=-Infinity;
  const visit=(start:number,chosen:ScoredRow[])=>{
    if(chosen.length===10) {
      if(activeSlotCount(chosen)!==10)return;
      const value=chosen.reduce((sum,p)=>sum+profileScore(p,weights),0);
      const key=chosen.map(p=>p.fantraxId).sort().join("|"),bestKey=best?.map(p=>p.fantraxId).sort().join("|")??"";
      if(value>bestScore+1e-12||(Math.abs(value-bestScore)<=1e-12&&key<bestKey)){best=[...chosen];bestScore=value;}
      return;
    }
    for(let i=start;i<=rows.length-(10-chosen.length);i++)visit(i+1,[...chosen,rows[i]!]);
  };
  visit(0,[]);
  if(!best)throw new Error("A legal active-ten assignment could not be found");
  return best as ScoredRow[];
}
function legalProfileRoster(rows:ScoredRow[],weights:Record<string,number>) {
  const sorted=[...rows].sort((a,b)=>profileScore(b,weights)-profileScore(a,weights)||a.fantraxId.localeCompare(b.fantraxId));
  const team:ScoredRow[]=[];
  for(const row of sorted)if(canCompleteRoster([...team,row])){team.push(row);if(team.length===14)break;}
  if(team.length!==14||activeSlotCount(team)!==10)throw new Error("Could not construct legal deterministic 14-player scenario roster");
  return team;
}
function marginalPercentageScenarios(rows:ScoredRow[],union:Set<string>,weights:ReconciliationScenarios["profileWeights"],blocked:Set<string>) {
  return (Object.entries(weights) as [ProfileName,Record<string,number>][]).map(([profile,profileWeights])=>{
    const eligible=rows.filter(p=>!blocked.has(p.fantraxId));
    const baseRoster=legalProfileRoster(eligible,profileWeights),base=activeTen(baseRoster,profileWeights),baseLine=exactTeamLine(base),baseIds=new Set(baseRoster.map(p=>p.fantraxId));
    const candidates=eligible.filter(p=>union.has(p.fantraxId)&&!baseIds.has(p.fantraxId)).map(candidate=>{
      const removed=[...baseRoster].sort((a,b)=>profileScore(a,profileWeights)-profileScore(b,profileWeights)||b.fantraxId.localeCompare(a.fantraxId)).find(p=>canCompleteRoster([...baseRoster.filter(x=>x.fantraxId!==p.fantraxId),candidate]));
      if(!removed)return {fantraxId:candidate.fantraxId,name:candidate.name,eligibleReplacement:false,FGBefore:baseLine.FG,FGAfter:null,marginalFG:null,FTBefore:baseLine.FT,FTAfter:null,marginalFT:null};
      const replacementRoster=[...baseRoster.filter(p=>p.fantraxId!==removed.fantraxId),candidate],line=exactTeamLine(activeTen(replacementRoster,profileWeights));
      return {fantraxId:candidate.fantraxId,name:candidate.name,removedPlayerId:removed.fantraxId,eligibleReplacement:true,FGBefore:baseLine.FG,FGAfter:line.FG,marginalFG:baseLine.FG!==null&&line.FG!==null?line.FG-baseLine.FG:null,FTBefore:baseLine.FT,FTAfter:line.FT,marginalFT:baseLine.FT!==null&&line.FT!==null?line.FT-baseLine.FT:null};
    });
    return {profile,label:`Deterministic ${profile[0]!.toUpperCase()}${profile.slice(1)} active-ten scenario within a 14-player roster`,baseRoster:baseLine,reserveIds:baseRoster.filter(p=>!base.some(a=>a.fantraxId===p.fantraxId)).map(p=>p.fantraxId),candidateMarginals:candidates,qualification:"Exact summed makes/attempts for a deterministic active-ten replacement within a 14-player roster; not an actual team projection or win probability."};
  });
}

type DraftIdentity=Pick<PlayerForecast,"fantraxId"|"name"|"school"|"eligibleGroups">;
function rehearsal(order:DraftIdentity[],teamId:string,asOf:string) {
  const teamOrder=["synthetic-0","synthetic-1","synthetic-2","synthetic-3","synthetic-4",teamId,"synthetic-6","synthetic-7"];
  const rosters=new Map(teamOrder.map(id=>[id,[] as DraftIdentity[]]));
  const selected=new Set<string>(),picks:{overall:number;teamId:string;playerId:string}[]=[];
  for(let overall=1;overall<=112;overall++) {
    const picker=snakeTeam(teamOrder,overall);
    const own=rosters.get(picker)!;
    const player=order.find(p=>!selected.has(p.fantraxId)&&canCompleteRoster([...own,p]));
    if(!player)throw new Error("Synthetic rehearsal exhausted eligible player identities");
    selected.add(player.fantraxId);picks.push({overall,teamId:picker,playerId:player.fantraxId});own.push(player);
  }
  const legality=teamOrder.map(id=>{const roster=rosters.get(id)!;return {teamId:id,players:roster.length,canComplete:canCompleteRoster(roster),activeSlots:activeSlotCount(roster),legal:roster.length===14&&canCompleteRoster(roster)&&activeSlotCount(roster)===10};});
  if(selected.size!==112||legality.some(team=>!team.legal))throw new Error("Synthetic 112-pick rehearsal failed all-team roster legality");
  const own=rosters.get(teamId)!;
  return {schemaVersion:1,kind:"synthetic-112-pick-operational-rehearsal",asOf,picks,ownRoster:own.map(p=>({fantraxId:p.fantraxId,name:p.name,school:p.school,eligibleGroups:p.eligibleGroups})),rosterLegality:legality,summary:{totalPicks:picks.length,uniquePlayers:selected.size,ownPicks:own.length,activeSlots:activeSlotCount(own),reserves:own.length-activeSlotCount(own)},scope:"Operational ordering/identity/roster-feasibility rehearsal only; all eight synthetic teams had a legal 14-player roster with ten active slots; no platform behavior or forecast accuracy claim.",liveActionsExecuted:0};
}

function importCsv(order:DraftIdentity[]) {return order.map(p=>[p.name,p.school].map(csvCell).join(",")).join("\n")+"\n";}
function rankOnlyCsv(rows:{fantraxId:string|null;name:string;school:string|null;providerRank:number|null;modelRank:number|null;rank:number;rankSource:string;status:string}[]) {
  const header=["Candidate rank","Fantrax ID","Player","School","Rank source","Provider rank","Model category rank","Evidence status"];
  return [header.map(csvCell).join(","),...rows.map(r=>[r.rank,r.fantraxId,r.name,r.school,r.rankSource,r.providerRank,r.modelRank,r.status].map(csvCell).join(","))].join("\n")+"\n";
}

export type ReconciliationResult = ReturnType<typeof reconcileDraftBoard>;

/** Build immutable, review-only candidate artifacts from a frozen board and explicit evidence manifest. */
export function reconcileDraftBoard(base:DraftBoard,evidenceInput:unknown,scenarioInput:unknown,asOf:Date,baselineFileSha256:string,options:{candidateBase?:DraftBoard;priorStrengthReplay?:(multiplier:number)=>DraftBoard;baselineReproduction?:Record<string,unknown>}={}) {
  if(!Number.isFinite(asOf.getTime()))throw new Error("Invalid reconciliation as-of time");
  const evidence=ReconciliationEvidenceSchema.parse(evidenceInput),scenarios=ScenarioConfigSchema.parse(scenarioInput);
  if(evidence.baseline.sha256!==baselineFileSha256||evidence.baseline.revision!==base.revision)throw new Error("Evidence baseline SHA/revision mismatch");
  requireFreshManifest(evidence,asOf);
  if(Date.parse(base.generatedAt)>asOf.getTime())throw new Error("Frozen baseline board is after requested as-of");
  const workingBase=options.candidateBase??base;
  if(workingBase.leagueId!==base.leagueId||workingBase.teamId!==base.teamId||workingBase.season!==base.season)throw new Error("Fresh candidate board scope does not match the frozen baseline");
  const pool=applyCompletePoolEvidence(structuredClone(workingBase.rows),structuredClone(workingBase.excluded),evidence.sources,base);
  const rows:PlayerForecast[]=pool.rows,excluded=pool.excluded;
  const importConflicts=nativeImportIdentityConflicts(pool.source);
  const rowById=new Map(rows.map(p=>[p.fantraxId,p]));
  const statusById=new Map(base.statusObservations.map(s=>[s.fantraxId,s]));
  const projectionErrors:Record<string,unknown>[]=[];
  const roleReviewRows:Record<string,unknown>[]=[];
  const rankFreshness:Record<string,unknown>={};
  const rankRecords=new Map<string,{rank:number;sourceId:string;observedAt:string;provider:string}>();
  const sourceCoverage:Record<string,unknown>[]=[];
  for(const source of evidence.sources) {
    const knownFields=new Set(source.fields);
    let matched=0,unmatched=0,updated=0;
    const rankAgeCandidates:string[]=[];
    for(const record of source.records) {
      const identity=evidenceRecordIdentity(record,rows,excluded);
      if(!identity) {unmatched++;continue;}
      matched++;
      if(source.kind==="provider-rank"||source.kind==="provider-projection") {
        const rank=numberValue(record,"providerRank");
        if(rank!==undefined) {
          if(!Number.isInteger(rank)||rank<1)throw new Error(`Invalid provider rank in ${source.id}`);
          const observedAt=record.fieldObservedAt.providerRank??source.observedAt;
          const existing=rankRecords.get(identity.fantraxId);
          if(existing&&existing.rank!==rank)throw new Error(`Conflicting provider ranks for ${identity.fantraxId}`);
          rankRecords.set(identity.fantraxId,{rank,sourceId:source.id,observedAt:observedAt??source.observedAt,provider:source.provider});
          rankAgeCandidates.push(observedAt??source.observedAt);
        }
      }
      if(source.kind==="provider-projection" && rowById.has(identity.fantraxId)) {
        const row=rowById.get(identity.fantraxId)!;
        const applicable=newerProjectionFields(row,record);
        const hasProjection=Object.keys(applicable.values).some(k=>numberValue(applicable,k)!==undefined);
        if(hasProjection) {
          try {const refreshed=refreshProviderLine(row,applicable);Object.assign(row,refreshed);updated++;}
          catch(error) {row.flags=[...row.flags,"provider-projection-reconciliation-error"];row.reviewRequired=true;projectionErrors.push({sourceId:source.id,fantraxId:row.fantraxId,error:error instanceof Error?error.message:String(error),applied:false,disposition:"data-error-or-unresolved; prior candidate line retained"});}
        }
      }
      if(source.kind==="player-status"&&rowById.has(identity.fantraxId)) {
        const parsed=statusValue.safeParse(record.values.status);
        const url=source.url;
        if(parsed.success&&record.values.draftAction==="manual-review-only") {
          const observedAt=record.fieldObservedAt.status??source.observedAt;
          const status={fantraxId:identity.fantraxId,status:parsed.data,draftAction:"manual-review-only" as const,observedAt:observedAt??source.observedAt,sourceUrl:url,sourcePublishedAt:source.publishedAt??"publication date not supplied",reason:String(record.values.reason??`Observed via ${source.provider}; manual review only.`)};
          statusById.set(identity.fantraxId,status);
        }
      }
      if(source.kind==="player-status"&&(record.values.roleEvidence!==undefined||record.values.roleInterpretation!==undefined))roleReviewRows.push({sourceId:source.id,provider:source.provider,url:source.url,observedAt:source.observedAt,fantraxId:record.fantraxId??null,providerName:record.providerName??record.name??null,school:record.schoolLabel??null,roleEvidence:record.values.roleEvidence??null,interpretation:record.values.roleInterpretation??null,healthOrEligibilityClearance:false,projectionApplied:false});
    }
    if(source.kind==="provider-rank"||source.kind==="provider-projection")rankFreshness[source.id]={provider:source.provider,observedAt:source.observedAt,latestRankFieldObservedAt:rankAgeCandidates.sort().at(-1)??null,rankRecords:rankAgeCandidates.length,staleRankRecords:rankAgeCandidates.filter(t=>asOf.getTime()-Date.parse(t)>24*3_600_000).length,allRanksFresh:rankAgeCandidates.length>0&&rankAgeCandidates.every(t=>asOf.getTime()-Date.parse(t)<=24*3_600_000),scope:source.scope??null,url:source.url};
    sourceCoverage.push({sourceId:source.id,kind:source.kind,provider:source.provider,url:source.url,observedAt:source.observedAt,publishedAt:source.publishedAt??null,fields:source.fields.length?source.fields:[...knownFields],recordCount:source.records.length,matched,unmatched,updated,sourceSha256:source.sha256,artifactPath:source.artifactPath??null});
  }
  for(const [id,record] of rankRecords) if(rowById.has(id)) rowById.get(id)!.providerRank=record.rank;
  const statuses=[...statusById.values()].sort((a,b)=>a.fantraxId.localeCompare(b.fantraxId));
  const statusIds=new Set(statuses.map(s=>s.fantraxId));
  const scored=scoreRows(rows,base.reference.refFG,base.reference.refFT,base.reference.moments);
  const correctedRows=scored.map(row=>{
    const blocked=statusIds.has(row.fantraxId);
    const flags=[...row.flags];
    if(blocked&&!flags.includes("known-status-default-recommendation-block"))flags.push("known-status-default-recommendation-block");
    if(importConflicts.ids.has(row.fantraxId))flags.push("native-import-name-school-collision-review");
    return {...row,draftRank:blocked?null:row.rank,positionValue:row.categoryScore,providerRankGap:row.providerRank===null?null:row.rank-row.providerRank,
      flags,reviewRequired:flags.length>0||blocked};
  });
  const conservativeDependencyTime=[workingBase.inputs.historySource.observedAt,workingBase.inputs.provider.observedAt,...workingBase.statusObservations.map(s=>s.observedAt)].map(t=>Date.parse(t)).filter(Number.isFinite).reduce((oldest,time)=>Math.min(oldest,time),asOf.getTime());
  const correctedPayload={...structuredClone(workingBase),generatedAt:new Date(conservativeDependencyTime).toISOString(),reconciledAt:asOf.toISOString(),status:"experimental-reconciliation-candidate-review-only",strategy:"balanced",
    inputs:{...workingBase.inputs,reconciliationEvidenceHash:contentHash(evidence),baselineRevision:base.revision},statusObservations:statuses,statusCoverage:"source evidence is partial; no status record is clearance",
    reference:{...base.reference,selection:"Frozen baseline normalization retained for reproducibility; corrected board ranks equal eight-category value with no positional scarcity adjustment.",replacementPolicy:"Frozen positional proxies retained only as provenance; not applied to corrected candidate ranks."},
    counts:{...workingBase.counts,availablePool:pool.poolCount??workingBase.counts.availablePool,forecasted:correctedRows.length,excluded:excluded.length,providerSupplemented:new Set(correctedRows.filter(p=>p.sourceFields.length>0).map(p=>p.fantraxId)).size},rows:correctedRows,excluded,
    limitations:[...base.limitations.filter(note=>!note.startsWith("Fixed heuristic priors")&&!note.startsWith("Provider MIN/PTS/REB/AST")&&!note.startsWith("Draft order subtracts")&&!note.startsWith("No Fantrax rank list")),"Reconciliation candidate is review-only. The approved active board, session and Balanced strategy were not changed.","Fixed heuristic priors and weights are not fitted or calibrated. Category, normalization, minutes, prior-strength and positional scenarios are deterministic stress cases, not confidence intervals.","Verified provider fields override modeled fields where supplied and retain their original observation timestamps. Ten fresh public rows include steals, blocks and threes; missing shooting fields remain modeled. The provider-first fallback contains no statistics.","Corrected static order uses equal eight-category value without a positional replacement adjustment. The 32nd/40th/48th-player replacement scenarios are diagnostics only.","No Fantrax rank list, queue, autopick setting or live pick was changed by this reconciliation. The separately authorized October 27 import remains separate.","Sensitivity outputs are deterministic stress scenarios, not probabilities, confidence intervals, validation or an edge claim."]};
  const {revision:_old,...correctedContent}=correctedPayload as DraftBoard;
  const correctedBoard={revision:contentHash(correctedContent),...correctedContent} as DraftBoard;
  const statusRanks=rankRecords;
  const rankedCandidates:DraftIdentity[]=[...rows,...excluded];
  const forecastById=new Map(scored.map(p=>[p.fantraxId,p]));
  const rankOnlyRows=rankedCandidates.map(p=>{
    const model=forecastById.get(p.fantraxId);
    const fallbackRank=model?.providerRank??null;
    const provider=statusRanks.get(p.fantraxId)??(fallbackRank===null?undefined:{rank:fallbackRank,sourceId:"frozen-baseline-provider-supplement",observedAt:base.inputs.provider.observedAt,provider:base.inputs.provider.provider});
    const providerRank=provider?.rank??null;
    const status=provider?((asOf.getTime()-Date.parse(provider.observedAt))>24*3_600_000?"stale":"current"):(fallbackRank!==null?"frozen-stale-baseline-rank":model?"uncovered":"unmodeled-review-only");
    return {fantraxId:p.fantraxId,name:p.name,school:p.school,eligibleGroups:[...p.eligibleGroups],providerRank,modelRank:model?.rank??null,
      rankSource:provider?provider.provider:model?"model-category-fallback":"unmodeled-review-only",sourceObservedAt:provider?.observedAt??null,rankFreshness:status,
      forecastAvailable:model!==undefined,nativeImportBlocked:importConflicts.ids.has(p.fantraxId)};
  }).sort((a,b)=>{
    if(a.providerRank!==null&&b.providerRank!==null)return a.providerRank-b.providerRank||a.fantraxId.localeCompare(b.fantraxId);
    if(a.providerRank!==null)return -1;if(b.providerRank!==null)return 1;
    return (a.modelRank??Infinity)-(b.modelRank??Infinity)||a.fantraxId.localeCompare(b.fantraxId);
  }).map((r,i)=>({...r,rank:i+1,status:r.rankFreshness}));
  const knownIds=new Set([...rows,...excluded].map(p=>p.fantraxId));
  const unmatchedRankOnly=evidence.sources.flatMap(source=>source.records.flatMap(record=>{
    if(!["provider-rank","provider-projection"].includes(source.kind)||numberValue(record,"providerRank")===undefined)return [];
    const matched=evidenceRecordIdentity(record,rows,excluded);
    if(matched)return [];
    if(record.fantraxId&&knownIds.has(record.fantraxId))return [];
    return [{fantraxId:record.fantraxId??null,name:record.providerName??record.name??"Unmatched provider identity",school:record.schoolLabel??null,eligibleGroups:[],providerRank:numberValue(record,"providerRank")!,modelRank:null,rankSource:source.provider,sourceObservedAt:record.fieldObservedAt.providerRank??source.observedAt,rankFreshness:"unmatched-review-only",status:"unmatched-review-only",forecastAvailable:false,nativeImportBlocked:true}];
  })).sort((a,b)=>a.providerRank-b.providerRank);
  const mergedProviderOrder=[...rankOnlyRows.filter(r=>r.providerRank!==null),...rankOnlyRows.filter(r=>r.providerRank===null),...unmatchedRankOnly].map((r,i)=>({...r,rank:i+1}));
  const candidateById=new Map<string,DraftIdentity>(rankedCandidates.map(p=>[p.fantraxId,p]));
  const providerFirstOrder=mergedProviderOrder.filter(r=>r.fantraxId!==null&&(r.providerRank!==null||r.modelRank!==null)&&!statusIds.has(r.fantraxId)&&!importConflicts.ids.has(r.fantraxId)).map(r=>candidateById.get(r.fantraxId!)!).filter(Boolean);
  const currentPoolIds=pool.source?new Set(pool.source.records.filter(r=>r.values.available===true&&r.fantraxId).map(r=>r.fantraxId!)):undefined;
  const union=priorityUnion(base,scored,excluded,evidence.sources,currentPoolIds);
  const diagnostics=exactCategoryAndNormalizationDiagnostics(base,scored,excluded,union.ids,rankFreshness);
  const rawOutliers=outlierCards(scored,union.unresolved);
  const categoryScenarios=scenarios.replacementRankScenarios.map(scenario=>{
    const order=rankOrder(scored,scenario,statusIds),positions=new Map(order.map((p,i)=>[p.fantraxId,i+1]));
    return {label:scenario.label,rankBy:scenario.rankBy,groupRanks:scenario.groupRanks??null,rankChanges:scored.filter(p=>union.ids.has(p.fantraxId)).map(p=>({fantraxId:p.fantraxId,categoryRank:p.rank,scenarioRank:positions.get(p.fantraxId)??null,delta:positions.has(p.fantraxId)?positions.get(p.fantraxId)!-p.rank:null}))};
  });
  const minuteScenarios=scenarios.minutesCases.map(label=>({label,rankChanges:minutesScenarioRows(scored,label,base.reference.refFG,base.reference.refFT,base.reference.moments).filter(p=>union.ids.has(p.fantraxId)).map(p=>({fantraxId:p.fantraxId,rank:p.rank,score:p.score}))}));
  const priorStrengthScenarios=scenarios.priorStrengthMultipliers.map(multiplier=>{
    if(!options.priorStrengthReplay)return {multiplier,status:"requires-frozen-history-replay-context",rankChanges:[]};
    const replay=options.priorStrengthReplay(multiplier);
    if(replay.inputs.historyRevision!==base.inputs.historyRevision)throw new Error("Prior-strength replay did not use the frozen history revision");
    if(multiplier===1&&replay.revision!==base.revision)throw new Error("Current-prior replay does not reproduce the frozen baseline board revision");
    const ordered=[...replay.rows].sort((a,b)=>b.categoryScore-a.categoryScore||(a.adp??Infinity)-(b.adp??Infinity)||a.fantraxId.localeCompare(b.fantraxId));
    const categoryRanks=new Map(ordered.map((p,i)=>[p.fantraxId,i+1]));
    const baseRows=new Map(base.rows.map(p=>[p.fantraxId,p]));
    return {multiplier,status:"computed-frozen-source-replay",recipe:{priorGames:replay.recipe.priorGames,fgPseudoAttempts:replay.recipe.fgPseudoAttempts,ftPseudoAttempts:replay.recipe.ftPseudoAttempts},replayRevision:replay.revision,
      rankChanges:[...union.ids].map(fantraxId=>{const old=baseRows.get(fantraxId),next=replay.rows.find(p=>p.fantraxId===fantraxId);return {fantraxId,baselineCategoryRank:old?.rank??null,replayCategoryRank:categoryRanks.get(fantraxId)??null,categoryRankDelta:old&&categoryRanks.has(fantraxId)?categoryRanks.get(fantraxId)!-old.rank:null,baselineDraftRank:old?.draftRank??null,replayDraftRank:next?.draftRank??null};})};
  });
  const outliers=enrichOutlierCards(rawOutliers,scored,base,diagnostics,priorStrengthScenarios,roleReviewRows,statuses,evidence.sources,projectionErrors);
  const providerRankOnlyArtifact={schemaVersion:1,kind:"provider-first-rank-only-review-candidate",generatedAt:asOf.toISOString(),baselineRevision:base.revision,
    sourceOrder:"Provider-ranked matched players retain source order. Unranked forecasted players follow by corrected category rank. Unmatched provider rows and identities with neither provider rank nor forecast remain review-only and are excluded from imports and rehearsals.",
    rankFreshness,providerRankedCount:rankOnlyRows.filter(r=>r.providerRank!==null).length,modelFallbackCount:rankOnlyRows.filter(r=>r.providerRank===null&&r.modelRank!==null).length,unmodeledReviewCount:rankOnlyRows.filter(r=>r.providerRank===null&&r.modelRank===null).length,unmatchedReviewCount:unmatchedRankOnly.length,
    rows:mergedProviderOrder,statisticsIncluded:false,sourceFieldsOnly:true,limitations:["No projected or modeled statistics are included.","Stale ranks stay ordered as observed and carry a stale rank freshness flag; no current provider rank was inferred.","Unmatched identities and available-pool identities with neither provider rank nor forecast are review-only and excluded from proposed imports and rehearsals."]};
  const importEligibleProvider=providerFirstOrder;
  const correctedImportOrder=correctedRows.filter(p=>p.draftRank!==null&&!importConflicts.ids.has(p.fantraxId)).sort((a,b)=>(a.draftRank??Infinity)-(b.draftRank??Infinity));
  const correctedRehearsalOrder=correctedRows.filter(p=>p.draftRank!==null&&!importConflicts.ids.has(p.fantraxId));
  const evidenceHash=contentHash(evidence),providerRowsHash=contentHash(mergedProviderOrder);
  const correctedOrderHash=contentHash(correctedRehearsalOrder.map(p=>({fantraxId:p.fantraxId,eligibleGroups:p.eligibleGroups})));
  const providerOrderHash=contentHash(importEligibleProvider.map(p=>({fantraxId:p.fantraxId,eligibleGroups:p.eligibleGroups})));
  const correctedRehearsal={...rehearsal(correctedRehearsalOrder,base.teamId,asOf.toISOString()),candidateKind:"corrected-category-value",correctedBoardRevision:correctedBoard.revision,evidenceHash,orderHash:correctedOrderHash};
  const providerFirstRehearsal={...rehearsal(importEligibleProvider,base.teamId,asOf.toISOString()),candidateKind:"provider-first-rank-only",providerRowsHash,providerOrderHash,orderHash:providerOrderHash,evidenceHash};
  const correctionReport={schemaVersion:1,kind:"basketball-draft-reconciliation-candidate",generatedAt:asOf.toISOString(),baseline:{revision:base.revision,sha256:baselineFileSha256,path:evidence.baseline.path},evidenceHash:contentHash(evidence),scenarioConfigVersion:scenarios.version,
    activeBoardChanged:false,activeStrategyChanged:false,sessionChanged:false,modelPromoted:false,platformActionsExecuted:0,liveActionsExecuted:0,
    candidateBoards:{correctedCategoryValue:{revision:correctedBoard.revision,path:"corrected-category-board.json",rows:correctedRows.length,proposedNativeImportRows:correctedImportOrder.length,defaultRank:"equal eight-category value; no replacement-player subtraction"},providerFirst:{path:"provider-first-rank-only.json",rows:mergedProviderOrder.length,rowsHash:providerRowsHash,statisticsIncluded:false}},
    baselineReproduction:options.baselineReproduction??{status:"frozen-board-hash-verified; source-rebuild-context-not-provided"},
    coverage:{availablePool:pool.poolCount??base.counts.availablePool,availableForecastRows:rows.length,unforecastedCurrentPoolRows:excluded.filter(p=>currentPoolIds?.has(p.fantraxId)??true).length,removedFromFreshPool:pool.removed,addedToFreshPool:pool.added,unresolvedPoolRows:pool.unresolved??[],nativeImportIdentityConflicts:importConflicts.rows,sourceCoverage,rankedProviderIdentities:rankOnlyRows.filter(p=>p.providerRank!==null).length,staleProviderRanks:rankOnlyRows.filter(p=>p.rankFreshness==="stale"||p.rankFreshness==="frozen-stale-baseline-rank").length,uncoveredIdentities:rankOnlyRows.filter(p=>p.providerRank===null).length,rankOnlyForecastUnavailable:rankOnlyRows.filter(p=>p.providerRank!==null&&!p.forecastAvailable).length,unmatchedEvidenceRows:unmatchedRankOnly.length,reviewUnionSize:union.ids.size,reviewUnionUnresolved:union.unresolved.length},
    diagnostics,roleReviewRows,scenarioTables:{replacementProxies:categoryScenarios,minutes:minuteScenarios,priorStrength:priorStrengthScenarios,providerScoring:providerScoringEvidence(evidence,scored),shooting:{method:"Provider PTS and 3PTM are reconciled by proportional scaling of modeled non-three FGA/FTA while preserving sourced 3PTM; complete direct FGM/FGA/FTM/FTA lines are used only when arithmetic is exact.",directCoherentLines:rows.filter(p=>p.sourceFields.includes("FGM")&&p.sourceFields.includes("FGA")&&p.sourceFields.includes("FTM")&&p.sourceFields.includes("FTA")).map(p=>p.fantraxId),scaledLines:rows.filter(p=>p.sourceFields.includes("PTS")&&!p.sourceFields.includes("FGM")).map(p=>p.fantraxId)}},
    teamPercentageScenarios:marginalPercentageScenarios(scored,union.ids,scenarios.profileWeights,statusIds),outlierCards:{...outliers,projectionErrors},
    proposedImports:{correctedCategoryValue:{path:"fantrax-rank-import.corrected.PROPOSED.csv",count:correctedImportOrder.length},providerFirst:{path:"fantrax-rank-import.provider-first.PROPOSED.csv",count:importEligibleProvider.length},identityConflictsExcluded:importConflicts.rows,warning:"Proposed research artifacts only; ambiguous name/school matches are excluded pending manual review; not submitted to Fantrax."},
    rehearsals:{corrected:correctedRehearsal,providerFirst:providerFirstRehearsal},
    limitations:["No model evaluation, calibration, expected win probability, player availability model or draft-success validation was performed.","All alternative rank, minutes, prior-strength and roster outputs are declared deterministic stress cases, not probability estimates or claims of edge.","RotoWire's saved public rank data is points-league scoped; stale rank ordering is shown only as a research fallback and is not treated as current global ranking.","Unmatched names and source gaps remain explicit review items; no name-only identity is imported or rehearsed.","The frozen baseline and source timestamps remain intact; only new versioned candidate artifacts are written."]};
  const report={revision:contentHash(correctionReport),...correctionReport};
  const boundProviderFirstRankOnly={...providerRankOnlyArtifact,reconciliationRevision:report.revision,evidenceHash:report.evidenceHash};
  const artifacts={
    "reconciliation.json":report,
    "corrected-category-board.json":correctedBoard,
    "provider-first-rank-only.json":boundProviderFirstRankOnly,
    "provider-first-rank-only.csv":rankOnlyCsv(mergedProviderOrder.map(r=>({fantraxId:r.fantraxId,name:r.name,school:r.school,providerRank:r.providerRank,modelRank:r.modelRank,rank:r.rank,rankSource:r.rankSource,status:r.status}))),
    "reconciliation-scenarios.json":{schemaVersion:1,version:scenarios.version,categoryRankProxies:categoryScenarios,minutes:minuteScenarios,priorStrength:(report as any).scenarioTables.priorStrength,teamPercentageScenarios:(report as any).teamPercentageScenarios},
    "outlier-cards.json":outliers,
    "fantrax-rank-import.corrected.PROPOSED.csv":importCsv(correctedImportOrder),
    "corrected-category-board.csv":boardCsv(correctedBoard),
    "corrected-category-board.md":[
      "# Corrected category-value candidate",
      "",
      `Candidate reconciled ${asOf.toISOString()} using dependencies no later than ${correctedBoard.generatedAt}.`,
      "Ranks use the frozen reference normalization and equal eight-category value, with no positional replacement subtraction. Status blocks remain manual-review-only.",
      "This immutable candidate does not change the active board, session, strategy, or Fantrax list.",
      "",
      "The separate `provider-first-rank-only.json` candidate retains provider order and contains no statistics.",
      ""
    ].join("\n"),
    "fantrax-rank-import.provider-first.PROPOSED.csv":importCsv(importEligibleProvider),
    "synthetic-rehearsal.corrected.json":{...(report as any).rehearsals.corrected,reconciliationRevision:report.revision},
    "synthetic-rehearsal.provider-first.json":{...(report as any).rehearsals.providerFirst,reconciliationRevision:report.revision}
  };
  return {revision:report.revision,report,correctedBoard,providerFirstRankOnly:boundProviderFirstRankOnly,artifacts};
}

export async function saveReconciliation(out:string,result:ReconciliationResult) {
  const revisionDir=resolve(out,"revisions",result.revision);
  await mkdir(revisionDir,{recursive:true});
  for(const [name,value] of Object.entries(result.artifacts)) {
    const path=resolve(revisionDir,name);await mkdir(dirname(path),{recursive:true});
    const content=typeof value==="string"?value:JSON.stringify(value,null,2)+"\n";
    await immutableText(path,content);
  }
  return revisionDir;
}

export async function sha256File(path:string) {return createHash("sha256").update(await readFile(path)).digest("hex");}
export async function verifyEvidenceSourceFiles(evidenceInput:unknown,root=process.cwd()) {
  const evidence=ReconciliationEvidenceSchema.parse(evidenceInput),rootPath=resolve(root),verified:{sourceId:string;sha256:string;upstreamPath:string;upstreamSha256:string}[]=[];
  for(const source of evidence.sources) {
    if(!source.artifactPath)throw new Error(`Evidence source is missing its capture-wrapper path: ${source.id}`);
    const path=resolve(rootPath,source.artifactPath),pathRelative=relative(rootPath,path);
    if(pathRelative.startsWith("..")||isAbsolute(pathRelative))throw new Error(`Evidence source wrapper escapes repository root: ${source.id}`);
    const raw=await readFile(path),sha=createHash("sha256").update(raw).digest("hex");
    if(sha!==source.sha256)throw new Error(`Evidence source wrapper hash mismatch: ${source.id}`);
    const wrapper=JSON.parse(raw.toString("utf8")) as Record<string,unknown>;
    if(wrapper.id!==source.id||wrapper.kind!==source.kind||wrapper.provider!==source.provider||wrapper.url!==source.url||wrapper.observedAt!==source.observedAt||
      (wrapper.publishedAt??null)!==(source.publishedAt??null)||wrapper.scope!==source.scope||contentHash(wrapper.fields??[])!==contentHash(source.fields)||
      contentHash(wrapper.records??[])!==contentHash(source.records))throw new Error(`Evidence manifest records do not match their hashed capture wrapper: ${source.id}`);
    const upstreamPath=wrapper.upstreamArtifactPath,upstreamSha=wrapper.upstreamArtifactSha256;
    if(typeof upstreamPath!=="string"||typeof upstreamSha!=="string"||! /^[a-f0-9]{64}$/.test(upstreamSha))throw new Error(`Evidence wrapper lacks an upstream artifact hash: ${source.id}`);
    const upstream=resolve(rootPath,upstreamPath),upstreamRelative=relative(rootPath,upstream);
    if(upstreamRelative.startsWith("..")||isAbsolute(upstreamRelative))throw new Error(`Evidence upstream artifact escapes repository root: ${source.id}`);
    const actualUpstreamSha=createHash("sha256").update(await readFile(upstream)).digest("hex");
    if(actualUpstreamSha!==upstreamSha)throw new Error(`Evidence upstream artifact hash mismatch: ${source.id}`);
    verified.push({sourceId:source.id,sha256:sha,upstreamPath,upstreamSha256:upstreamSha});
  }
  return verified;
}
export async function verifyFrozenBoard(path:string,manifest:ReconciliationEvidence,board:DraftBoard) {
  const supplied=resolve(path),manifestPath=resolve(manifest.baseline.path);
  if(supplied!==manifestPath)throw new Error("Evidence manifest baseline path does not match --board");
  const rawHash=await sha256File(supplied);
  if(rawHash!==manifest.baseline.sha256)throw new Error("Frozen board raw SHA-256 mismatch");
  const {revision,...content}=board;
  if(contentHash(content)!==revision||revision!==manifest.baseline.revision)throw new Error("Frozen board revision hash mismatch");
  return rawHash;
}

export function sourceProjectionRows(evidence:ReconciliationEvidence) {
  return evidence.sources.flatMap(source=>source.kind==="provider-projection"?source.records.map(record=>({sourceId:source.id,provider:source.provider,observedAt:source.observedAt,record})):[]);
}

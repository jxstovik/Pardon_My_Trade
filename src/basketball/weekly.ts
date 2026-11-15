import { z } from "zod";
import { CATEGORIES, instant, type Category } from "./contracts.js";
import { aggregateCategories, StatLineSchema, type StatLine } from "./categories.js";
import type { DraftBoard } from "./forecast.js";
import { contentHash } from "./store.js";

const gameSchema = z.object({
  id: z.string().min(1), date: z.iso.date(), label: z.string().min(1),
  state: z.enum(["scheduled", "cancelled", "postponed"]), startAt: instant.nullable()
}).strict();
export const WeeklyInputSchema = z.object({
  schemaVersion: z.literal(1), leagueId: z.string(), teamId: z.string(), season: z.string(), boardRevision: z.string(),
  observedAt: instant, sourceUrls: z.array(z.url()).min(1), sourceKind: z.enum(["browser-transcription", "synthetic"]),
  period: z.object({number: z.number().int().positive(), firstDate: z.iso.date(), lastDate: z.iso.date(), opponentTeamId: z.string().nullable()}).strict(),
  unresolvedRules: z.array(z.string()), candidateScope: z.string().min(1), protectedIds: z.array(z.string()),
  currentActiveIds: z.array(z.string()).max(10),
  players: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), school: z.string().min(1),
    ownership: z.enum(["own", "waiver", "free-agent"]), availability: z.enum(["unknown", "available", "out"]),
    waiverLabel: z.string().nullable(), scheduleComplete: z.boolean(), games: z.array(gameSchema).nullable()
  }).strict()).min(1)
}).strict();
export type WeeklyInput = z.infer<typeof WeeklyInputSchema>;
type Row = DraftBoard["rows"][number];
export type WeeklyPlayer = {
  id: string; name: string; school: string; ownership: WeeklyInput["players"][number]["ownership"];
  eligibleGroups: Row["eligibleGroups"]; games: number; score: number; totals: StatLine;
  lowTotals: StatLine; highTotals: StatLine; flags: string[]; waiverLabel: string | null;
};
const scale = (stats: StatLine, games: number): StatLine => StatLineSchema.parse(Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v*games])));

/** Linear equal-category production surrogate. Ratio contributions use attempt volume.
 * This is not expected category wins, a points scoring system or a calibrated probability. */
function utility(stats: StatLine, board: DraftBoard): number {
  return CATEGORIES.reduce((sum, category) => {
    const sd = board.reference.moments[category].sd;
    if (!Number.isFinite(sd) || sd <= 0) throw new Error(`Invalid normalization for ${category}`);
    const amount = category === "FG%" ? stats.FGM-board.reference.refFG*stats.FGA
      : category === "FT%" ? stats.FTM-board.reference.refFT*stats.FTA : stats[category];
    return sum + amount / sd;
  }, 0) / 8;
}

/** Exact DP for this linear utility and 4G / 4F-C / 2Flex limits. No per-day streaming. */
export function optimizeWeeklyLineup(players: WeeklyPlayer[]) {
  type State = {score:number; active:{id:string;slot:string}[]};
  let states = new Map<string,State>([["0,0,0",{score:0,active:[]}]]);
  for (const player of players) {
    const next = new Map(states);
    for (const [key,state] of states) {
      const counts = key.split(",").map(Number);
      for (const [index,group,max] of [[0,"G",4],[1,"F/C",4],[2,"Flx",2]] as const) {
        if (counts[index]! >= max || (group!=="Flx" && !player.eligibleGroups.includes(group))) continue;
        const updated=[...counts]; updated[index] = updated[index]!+1;
        const newKey=updated.join(","), score=state.score+player.score;
        if (!next.has(newKey) || score > next.get(newKey)!.score) next.set(newKey,{score,active:[...state.active,{id:player.id,slot:`${group}${updated[index]}`} ]});
      }
    }
    states=next;
  }
  const best=states.get("4,4,2");
  if (!best) return null;
  const selected=new Set(best.active.map(p=>p.id));
  const activePlayers=players.filter(p=>selected.has(p.id));
  return {...best,reserveIds:players.filter(p=>!selected.has(p.id)).map(p=>p.id),
    scheduledAppearances:activePlayers.reduce((s,p)=>s+p.games,0),
    totals:aggregateCategories(activePlayers.map(p=>p.totals)),
    lowTotals:aggregateCategories(activePlayers.map(p=>p.lowTotals)), highTotals:aggregateCategories(activePlayers.map(p=>p.highTotals))};
}

export function buildWeeklyReport(board: DraftBoard, inputValue: unknown, asOf: Date) {
  const input=WeeklyInputSchema.parse(inputValue);
  const {revision,...payload}=board;
  if (contentHash(payload)!==revision || input.boardRevision!==revision) throw new Error("Weekly forecast board hash mismatch");
  if (input.leagueId!==board.leagueId || input.teamId!==board.teamId || input.season!==board.season) throw new Error("Weekly scope mismatch");
  const observed=Date.parse(input.observedAt), now=asOf.getTime();
  if (!Number.isFinite(now) || observed>now || Date.parse(board.generatedAt)>now) throw new Error("Future/invalid weekly as-of observation");
  if (input.period.firstDate>input.period.lastDate) throw new Error("Invalid weekly period");
  const ids=input.players.map(p=>p.id), own=input.players.filter(p=>p.ownership==="own");
  if (new Set(ids).size!==ids.length || own.length>14) throw new Error("Duplicate identity or illegal roster size");
  if (new Set(input.currentActiveIds).size!==input.currentActiveIds.length || input.currentActiveIds.some(id=>!own.some(p=>p.id===id))) throw new Error("Invalid current active roster");
  if (new Set(input.protectedIds).size!==input.protectedIds.length || input.protectedIds.some(id=>!own.some(p=>p.id===id))) throw new Error("Protected identity is not owned");
  const rows=new Map(board.rows.map(p=>[p.fantraxId,p]));
  const blocked=new Set(board.statusObservations.map(p=>p.fantraxId));
  const excluded:{id:string;name:string;reason:string}[]=[], ranked:WeeklyPlayer[]=[];
  for (const player of input.players) {
    const row=rows.get(player.id);
    if (!row) {excluded.push({id:player.id,name:player.name,reason:"no modeled forecast"}); continue;}
    if (row.name!==player.name || row.school!==player.school) throw new Error(`Identity crosswalk mismatch: ${player.id}`);
    if (player.games) {
      if (new Set(player.games.map(g=>g.id)).size!==player.games.length) throw new Error(`Duplicate player-game: ${player.id}`);
      if (player.games.some(g=>g.date<input.period.firstDate || g.date>input.period.lastDate)) throw new Error("Game outside displayed scoring period");
      if (player.games.some(g=>g.startAt!==null && Date.parse(g.startAt)<=now)) throw new Error("Weekly pre-lock planning cannot reuse started games");
    }
    if (!player.scheduleComplete || player.games===null) {excluded.push({id:player.id,name:player.name,reason:"schedule missing/incomplete, not zero games"});continue;}
    if (player.availability==="out" || blocked.has(player.id) || row.flags.includes("known-status-default-recommendation-block")) {excluded.push({id:player.id,name:player.name,reason:"known status block"});continue;}
    const games=player.games.filter(g=>g.state==="scheduled").length;
    const totals=scale(row.stats,games), lowTotals=scale(row.sensitivity.low,games), highTotals=scale(row.sensitivity.high,games);
    const flags=[...row.flags,"conditional-on-listed-games-and-per-game-baseline"];
    if(player.availability==="unknown") flags.push("current-health-and-role-not-cleared");
    if(player.games.some(g=>g.startAt===null)) flags.push("game-instants-and-locks-unverified");
    ranked.push({id:player.id,name:row.name,school:row.school,ownership:player.ownership,eligibleGroups:row.eligibleGroups,
      games,score:utility(totals,board),totals,lowTotals,highTotals,flags:[...new Set(flags)],waiverLabel:player.waiverLabel});
  }
  ranked.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const roster=ranked.filter(p=>p.ownership==="own");
  const blockers=[...input.unresolvedRules];
  if ((now-observed)>24*3600e3) blockers.push("roster/schedule/ownership observation older than 24 hours");
  const forecastAgeHours=(now-Date.parse(board.generatedAt))/3600e3;
  if(forecastAgeHours>24) blockers.push("oldest baseline dependency older than 24 hours; revalidate rates/roles");
  const missingOwn=excluded.filter(p=>own.some(o=>o.id===p.id));
  // Known-out owned players are legitimately benchable. Missing data is not a reason to bench them silently.
  const unknownOwn=missingOwn.filter(p=>p.reason!=="known status block");
  if(unknownOwn.length) blockers.push("owned-player forecast/schedule coverage incomplete");
  if(input.players.some(p=>p.games?.some(g=>g.startAt===null))) blockers.push("schedule lacks verified game instants");
  if(input.players.some(p=>p.availability==="unknown")) blockers.push("health/role evidence incomplete");
  const lineup=unknownOwn.length ? null : optimizeWeeklyLineup(roster);
  if(!lineup) blockers.push("no fully covered legal ten-player conditional lineup");
  const current=new Set(input.currentActiveIds);
  const currentRows=roster.filter(p=>current.has(p.id));
  const currentTotals=currentRows.length===input.currentActiveIds.length?aggregateCategories(currentRows.map(p=>p.totals)):null;
  const waiverResearch = lineup ? ranked.filter(p=>p.ownership!=="own").slice(0,20).map(candidate=>{
    let best:{dropId:string;gain:number;activeIds:string[]}|null=null;
    for (const drop of own) {
      if(input.protectedIds.includes(drop.id)) continue;
      const option=optimizeWeeklyLineup([...roster.filter(p=>p.id!==drop.id),candidate]);
      if(option && (best===null || option.score-lineup.score>best.gain)) best={dropId:drop.id,gain:option.score-lineup.score,activeIds:option.active.map(p=>p.id)};
    }
    return {addId:candidate.id,name:candidate.name,ownership:candidate.ownership,waiverLabel:candidate.waiverLabel,
      conditionalBestReplacement:best,executionEligible:false,reason:"Research only; clearance/activation, priority cost, current status and exact human approval required"};
  }).sort((a,b)=>(b.conditionalBestReplacement?.gain??-Infinity)-(a.conditionalBestReplacement?.gain??-Infinity)):[];
  const content={schemaVersion:1,kind:"basketball-weekly-conditional-research",generatedAt:asOf.toISOString(),
    leagueId:input.leagueId,teamId:input.teamId,season:input.season,period:input.period,sourceKind:input.sourceKind,
    inputHash:contentHash(input),boardRevision:revision,observedAt:input.observedAt,forecastGeneratedAt:board.generatedAt,forecastAgeHours,
    sourceUrls:input.sourceUrls,candidateScope:input.candidateScope,status:"advisory-only-no-platform-writer",
    objective:"Equal-category normalized production plus volume-weighted FG/FT impact; deterministic surrogate, not category wins/probabilities",
    blockers:[...new Set(blockers)],ranked,excluded,lineup,currentTotals,waiverResearch,
    limitations:["Historical conditional per-game baseline; no trained weekly model or opponent adjustment.","Displayed scheduled appearances are not verified legal counted starts.","Low/high totals are fixed minutes stress scenarios, not confidence intervals.","No automatic model promotion, roster change, claim or drop."],liveActionsExecuted:0};
  return {revision:contentHash(content),...content};
}
export type WeeklyReport=ReturnType<typeof buildWeeklyReport>;
export function renderWeeklyReport(report:WeeklyReport) {
  const names=new Map(report.ranked.map(p=>[p.id,p.name]));
  const lines=[`# Weekly basketball research — period ${report.period.number}`,"",`As of ${report.generatedAt}. ${report.status}.`,
    `Observed roster/schedule: ${report.observedAt}. Baseline dependency time: ${report.forecastGeneratedAt}.`,"",report.objective,"",
    "**Conditional projections; no roster change or claim was submitted.**", "", "## Owned players", "",
    "| Rank | Player | Listed games | PTS | REB | AST | ST | BLK | 3PTM |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  report.ranked.filter(p=>p.ownership==="own").forEach((p,i)=>lines.push(`| ${i+1} | ${p.name} | ${p.games} | ${[p.totals.PTS,p.totals.REB,p.totals.AST,p.totals.ST,p.totals.BLK,p.totals["3PTM"]].map(n=>n.toFixed(1)).join(" | ")} |`));
  lines.push("","## Conditional lineup","");
  if(report.lineup) {
    for(const slot of report.lineup.active)lines.push(`- ${slot.slot}: ${names.get(slot.id)}`);
    lines.push("",`Reserves: ${report.ranked.filter(p=>p.ownership==="own"&&!report.lineup!.active.some(a=>a.id===p.id)).map(p=>p.name).join(", ")}.`,
      `Listed active appearances: ${report.lineup.scheduledAppearances}. FG% ${(100*(report.lineup.totals["FG%"]??0)).toFixed(2)}%; FT% ${(100*(report.lineup.totals["FT%"]??0)).toFixed(2)}% (aggregate makes/attempts).`);
  } else lines.push("Withheld: owned coverage or legal slot completion is incomplete.");
  lines.push("","## Available-player watchlist", "",report.candidateScope,"", "| Player | Status | Listed games | Conditional replacement gain |", "| --- | --- | --- | --- |");
  for(const p of report.ranked.filter(p=>p.ownership!=="own")) {
    const option=report.waiverResearch.find(w=>w.addId===p.id)?.conditionalBestReplacement;
    lines.push(`| ${p.name} | ${p.waiverLabel??p.ownership} | ${p.games} | ${option?option.gain.toFixed(3):"not evaluated"} |`);
  }
  lines.push("","Replacement gains are changes in a unitless linear research objective, not points, wins or an instruction to drop the named replacement.","","## Gates before real lineup advice","",...report.blockers.map(s=>`- ${s}`),"","## Excluded coverage","",...report.excluded.map(p=>`- ${p.name}: ${p.reason}`),"","## Limits","",...report.limitations.map(s=>`- ${s}`));
  return lines.join("\n")+"\n";
}

import { z } from "zod";
import { instant } from "./contracts.js";
import { type DraftBoard, type PlayerForecast } from "./forecast.js";

export const DraftSessionSchema=z.object({schemaVersion:z.literal(1),leagueId:z.string(),teamId:z.string(),boardRevision:z.string().regex(/^[a-f0-9]{64}$/),
  sourceKind:z.enum(["manual-local","browser-dom","local-simulator"]),observedAt:instant,draftStart:instant,phase:z.enum(["pre-draft","live","complete"]),
  teamOrder:z.array(z.string()).length(8),rounds:z.literal(14),unavailablePlayerIds:z.array(z.string()),
  picks:z.array(z.object({overall:z.number().int().positive().max(112),teamId:z.string(),playerId:z.string()}).strict()).max(112)}).strict();
export type DraftSession=z.infer<typeof DraftSessionSchema>;
export function snakeTeam(teamOrder:string[],overall:number):string {
  if(teamOrder.length!==8||!Number.isInteger(overall)||overall<1||overall>112)throw new Error("Invalid eight-team snake pick");
  const round=Math.floor((overall-1)/8),within=(overall-1)%8;
  return teamOrder[round%2===0?within:7-within]!;
}

/** Maximum bipartite assignment to the ten active slots. Reserve capacity is checked separately. */
export function activeSlotCount(players:Pick<PlayerForecast,"fantraxId"|"eligibleGroups">[]):number {
  const slots=["G","G","G","G","F/C","F/C","F/C","F/C","Flx","Flx"],matched=Array<number>(10).fill(-1);
  const assign=(index:number,seen:Set<number>):boolean=>{
    for(let s=0;s<slots.length;s++){
      if(seen.has(s)||(slots[s]!=="Flx"&&!players[index]!.eligibleGroups.includes(slots[s] as "G"|"F/C")))continue;
      seen.add(s);if(matched[s]===-1||assign(matched[s]!,seen)){matched[s]=index;return true;}
    }return false;
  };
  return players.reduce((n,_,i)=>n+Number(assign(i,new Set())),0);
}
export function canCompleteRoster(players:Pick<PlayerForecast,"fantraxId"|"eligibleGroups">[]):boolean {
  if(new Set(players.map(p=>p.fantraxId)).size!==players.length||players.length>14)return false;
  const active=activeSlotCount(players),remaining=14-players.length;
  return players.length-active<=4&&active+remaining>=10;
}

export function recommendDraft(board:DraftBoard,input:unknown,asOf:Date,limit=8) {
  const state=DraftSessionSchema.parse(input);
  if(state.leagueId!==board.leagueId||state.teamId!==board.teamId||state.boardRevision!==board.revision)throw new Error("Draft session league/team/board scope mismatch");
  if(new Set(state.teamOrder).size!==8||!state.teamOrder.includes(state.teamId))throw new Error("Invalid/duplicate snake team order");
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("Invalid recommendation limit");
  const ageSeconds=(asOf.getTime()-Date.parse(state.observedAt))/1000;
  if(ageSeconds<0)throw new Error("Draft observation is in the future");
  if(Date.parse(state.draftStart)>asOf.getTime()&&state.phase!=="pre-draft")throw new Error("Cannot label a future scheduled draft live/complete");
  const known=new Set([...board.rows.map(p=>p.fantraxId),...board.excluded.map(p=>p.fantraxId)]),selected=new Set<string>();
  state.picks.forEach((p,i)=>{
    if(p.overall!==i+1||p.teamId!==snakeTeam(state.teamOrder,p.overall))throw new Error("Draft picks must be contiguous and follow the supplied manual snake order");
    if(!known.has(p.playerId)||selected.has(p.playerId))throw new Error("Unknown or duplicate selected player");
    selected.add(p.playerId);
  });
  if(state.phase==="pre-draft"&&state.picks.length>0)throw new Error("Pre-draft state cannot contain selections");
  if(state.phase==="complete"&&state.picks.length!==112)throw new Error("Complete draft requires all 112 selections");
  const ownIds=state.picks.filter(p=>p.teamId===state.teamId).map(p=>p.playerId);
  const owned=ownIds.map(id=>{const p=board.rows.find(p=>p.fantraxId===id)??board.excluded.find(p=>p.fantraxId===id);if(!p)throw new Error("Own pick lacks eligibility; reconcile before advice");return p;});
  if(!canCompleteRoster(owned))throw new Error("Observed own roster cannot fit the verified active/reserve slots");
  const inputAgesHours={board:(asOf.getTime()-Date.parse(board.generatedAt))/3_600_000,
    pool:(asOf.getTime()-Date.parse(board.inputs.historySource.observedAt))/3_600_000,
    provider:(asOf.getTime()-Date.parse(board.inputs.provider.observedAt))/3_600_000};
  if(Object.values(inputAgesHours).some(n=>n<0||!Number.isFinite(n)))throw new Error("Future/invalid board input observation");
  const staleInputs=inputAgesHours.board>24||inputAgesHours.pool>24||inputAgesHours.provider>24;
  const stale=state.phase==="live"&&(ageSeconds>20||staleInputs);
  const complete=state.picks.length===112||ownIds.length===14;
  const unavailable=new Set([...selected,...state.unavailablePlayerIds,...board.statusObservations.map(s=>s.fantraxId)]);
  if(state.unavailablePlayerIds.some(id=>!known.has(id)))throw new Error("Unknown unavailable player ID");
  const nextOverall=state.picks.length+1;
  const ownUpcoming=Array.from({length:Math.max(0,112-state.picks.length)},(_,i)=>nextOverall+i).filter(p=>snakeTeam(state.teamOrder,p)===state.teamId);
  const recommendations=stale||complete?[]:[...board.rows].sort((a,b)=>(a.draftRank??Infinity)-(b.draftRank??Infinity)).filter(p=>!unavailable.has(p.fantraxId)&&canCompleteRoster([...owned,p])).slice(0,limit).map(p=>({
    draftRank:p.draftRank,rank:p.rank,playerId:p.fantraxId,name:p.name,school:p.school,eligibleGroups:p.eligibleGroups,categoryScore:p.categoryScore,positionValue:p.positionValue,
    strengths:p.strengths,weaknesses:p.weaknesses,adp:p.adp,providerRank:p.providerRank,reviewRequired:p.reviewRequired,flags:p.flags,
    activeSlotsAfterPick:activeSlotCount([...owned,p]),reserveNeededAfterPick:owned.length+1-activeSlotCount([...owned,p])}));
  return {leagueId:board.leagueId,teamId:board.teamId,boardRevision:board.revision,generatedAt:asOf.toISOString(),sourceKind:state.sourceKind,
    status:complete?"complete":stale?"stale-state":state.phase==="pre-draft"?"draft-preparation":"local-live-advice",
    stateObservedAt:state.observedAt,ageSeconds,inputAgesHours,staleInputs,providerPublicationLabel:board.inputs.provider.publishedLabel,statusCoverage:board.statusCoverage,ownSelected:ownIds.length,nextOwnOverall:ownUpcoming[0]??null,
    ownTurn:!complete&&state.phase==="live"&&!stale&&snakeTeam(state.teamOrder,nextOverall)===state.teamId,turnAuthority:state.sourceKind==="manual-local"?"conditional-on-manual-team-order; not platform verified":"conditional-on-supplied-observation; independently reconcile browser phase/order/clock",
    coverage:board.counts,
    recommendations,readyForPlatformExecution:false,liveActionsExecuted:0,
    unmodeledReviewCandidates:board.excluded.filter(p=>!unavailable.has(p.fantraxId)&&p.adp!==null).sort((a,b)=>a.adp!-b.adp!).slice(0,8),
    warnings:[state.sourceKind==="manual-local"?"Manual local state is not an independently verified Fantrax feed. This command submits no pick.":"Source labels alone do not establish a verified Fantrax feed or pick capability. This command submits no pick.",
      "Roster feasibility assumes future picks with needed eligibility remain available; no opponent/survival probability is modeled.",
      "Fresh session state does not refresh the board's player pool, projections or status evidence.",
      "The 24-hour provider gate measures retrieval age, not projection publication age; inspect providerPublicationLabel separately.",
      "Review flags and external rank disagreements remain visible; the per-game category score is experimental."]};
}

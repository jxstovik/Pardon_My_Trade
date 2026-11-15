import type { AgentActionType, QueuedAction } from "../agents/types.js";
export interface PendingActionOptions { leagueId?:string; teamId?:string; scoringPeriod?:string; actionType?:AgentActionType; limit?:number; offset?:number }
/** Compact queue index only. Fetch and preview the exact payload before any approval. */
export function pendingActionPage(rows:QueuedAction[], options:PendingActionOptions, now:Date) {
 const relevant=rows.filter(row=>row.status==="pending" && Date.parse(row.expiresAt)>now.getTime()
  && (!options.leagueId || row.preconditions?.leagueExternalId===options.leagueId)
  && (!options.scoringPeriod || row.preconditions?.scoringPeriod===options.scoringPeriod)
  && (!options.teamId || (row.action.type==="propose_trade" ? row.action.fromTeamId : row.action.teamId)===options.teamId)
  && (!options.actionType || row.action.type===options.actionType))
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.actionId.localeCompare(b.actionId));
 const offset=options.offset??0, limit=Math.min(options.limit??25,50);
 const actions=relevant.slice(offset,offset+limit).map(row=>({actionId:row.actionId,type:row.action.type,status:row.status,risk:row.risk,createdAt:row.createdAt,expiresAt:row.expiresAt,payloadHash:row.payloadHash,teamId:row.action.type==="propose_trade"?row.action.fromTeamId:row.action.teamId,leagueId:row.preconditions?.leagueExternalId,scoringPeriod:row.preconditions?.scoringPeriod}));
 const hasMore=offset+actions.length<relevant.length;
 return {actions,total_count:relevant.length,returned_count:actions.length,has_more:hasMore,truncated:hasMore,next_offset:hasMore?offset+actions.length:null,filters:options,note:"Compact index excludes expired and unscoped proposals when scope filters are supplied. Fetch pmt_get_action and pmt_preview_action for exact payloads; never approve from this index. Offset paging assumes queue stability; re-read before mutation."};
}

import { z } from "zod";
import { instant } from "./contracts.js";
import { type DraftBoard } from "./forecast.js";
import { type DraftSession, snakeTeam } from "./draft.js";
import { type DraftObservation } from "./copilot-contracts.js";

export const FantraxDomCaptureSchema=z.object({
  schemaVersion:z.literal(1),pageUrl:z.url(),capturedAt:instant,
  teamNames:z.array(z.string()),phase:z.enum(["pre-draft","unknown"]),clockSeconds:z.null(),
  cells:z.array(z.object({column:z.number().int().nonnegative(),label:z.string(),text:z.string(),
    playerName:z.string().nullable(),schoolText:z.string().nullable()}).strict()),limitations:z.array(z.string())
}).strict();

/** Bootstrap only. Never infer a live clock/turn from shell cells or guessed selectors. */
export function decodeFantraxPreflight(board:DraftBoard,template:DraftSession,input:unknown,
  names:Record<string,string>,receivedAt:Date,sequence=1):DraftObservation {
  const raw=FantraxDomCaptureSchema.parse(input),url=new URL(raw.pageUrl);
  if(url.origin!=="https://www.fantrax.com"||url.pathname!==`/fantasy/league/${board.leagueId}/draft`||url.username||url.password)throw new Error("Wrong Fantrax draft-room scope");
  if(template.leagueId!==board.leagueId||template.teamId!==board.teamId||template.boardRevision!==board.revision)throw new Error("Preflight board/template scope mismatch");
  if(template.teamOrder.length!==8||raw.teamNames.length!==8||new Set(raw.teamNames).size!==8||raw.teamNames.some((name,i)=>names[template.teamOrder[i]!]!==name))throw new Error("Observed draft order does not match the confirmed team directory");
  if(raw.phase!=="pre-draft")throw new Error("Live Fantrax parser is not verified; reconcile phase/clock and selected identities first");
  if(Date.parse(raw.capturedAt)>receivedAt.getTime()||receivedAt.getTime()-Date.parse(raw.capturedAt)>20_000)throw new Error("Future/stale DOM capture; replay does not refresh observation age");
  if(raw.cells.length!==112||template.picks.length!==0)throw new Error("Pre-draft grid is incomplete or template already contains picks");
  const selected=new Set<number>();
  for(const cell of raw.cells){
    const match=cell.label.match(/^(\d+)-(\d+)$/);
    if(!match||cell.column>7||cell.playerName!==null||cell.schoolText!==null||cell.text!==cell.label)throw new Error("Unverified selected cell or unexpected grid content");
    const round=Number(match[1]),within=Number(match[2]),overall=(round-1)*8+within;
    if(round<1||round>14||within<1||within>8||selected.has(overall)||snakeTeam(template.teamOrder,overall)!==template.teamOrder[cell.column])throw new Error("Grid labels or owners conflict with snake order");
    selected.add(overall);
  }
  return {schemaVersion:1,sessionId:`fantrax-${board.leagueId}-${board.season}`,venue:"fantrax-league",
    pageUrl:raw.pageUrl,receivedAt:receivedAt.toISOString(),sequence,completeHistory:true,identityVerified:true,
    currentTeamId:null,clockSeconds:null,correction:false,
    session:{...template,sourceKind:"browser-dom",observedAt:raw.capturedAt,phase:"pre-draft",picks:[]}};
}

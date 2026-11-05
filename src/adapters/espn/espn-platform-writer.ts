import type {
  AddDropAction,
  ProposeTradeAction,
  SetRosterAction,
  WaiverClaimAction
} from "../../agents/types.js";
import type { PlatformWriter } from "../platform-writer.js";
import { mapPositionToEspnSlot, loadEspnCredentials, type EspnCredentials } from "./espn-auth.js";
import {
  buildEspnAddDropPayload,
  buildEspnRosterPayload,
  buildEspnTradePayload
} from "./espn-platform-reader.js";
import { EspnPlatformClient } from "./espn-platform-client.js";

export interface EspnPlatformWriterOptions {
  readonly credentials?: EspnCredentials;
  readonly client?: EspnPlatformClient;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

/** ESPN write adapter. It only translates the typed writer contract to POSTs. */
export class EspnPlatformWriter implements PlatformWriter {
  readonly platform = "espn";
  readonly client: EspnPlatformClient;

  constructor(options: EspnPlatformWriterOptions = {}) {
    this.client = options.client ?? new EspnPlatformClient({
      credentials: options.credentials ?? loadEspnCredentials(),
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl
    });
  }

  async setRoster(_leagueExternalId: string, action: SetRosterAction): Promise<unknown> {
    this.assertLeague(_leagueExternalId);
    const memberId=this.client.credentials.swid;
    if(!memberId||!this.client.credentials.espnS2)throw new Error("ESPN lineup change requires authenticated session credentials.");
    const fresh=await this.client.getJson<EspnLineupState>("",{view:["mSettings","mTeam","mRoster"],scope:{segment:0,readHost:true}});
    if(String(fresh.id)!==_leagueExternalId||String(fresh.seasonId)!==this.client.credentials.season)throw new Error("ESPN lineup league or season mismatch.");
    const team=fresh.teams?.find(t=>String(t.id)===action.teamId);
    const identity=(value:string)=>value.replace(/[{}]/g,"").toLowerCase();
    if(!team?.owners?.some(o=>identity(o)===identity(memberId)))throw new Error("Authenticated ESPN member does not own lineup team.");
    const body=buildEspnLineupTransaction(action,memberId,fresh.scoringPeriodId!,team.roster?.entries??[],fresh.settings?.rosterSettings?.lineupSlotCounts??{});
    if((body.items as unknown[]).length===0)return {status:"UNCHANGED"};
    return this.client.postJson("/transactions/",body,undefined,{segment:0,writeHost:true});
  }

  async addDrop(_leagueExternalId: string, action: AddDropAction): Promise<unknown> {
    this.assertLeague(_leagueExternalId);
    return this.client.postJson(
      "/transactions/",
      buildEspnAddDropPayload(action.teamId, action.addPlayerIds, action.dropPlayerIds, "freeagent")
    );
  }

  async submitWaiverClaim(_leagueExternalId: string, action: WaiverClaimAction): Promise<unknown> {
    this.assertLeague(_leagueExternalId);
    return this.client.postJson(
      "/transactions/",
      buildEspnAddDropPayload(
        action.teamId,
        [action.addPlayerId],
        action.dropPlayerId ? [action.dropPlayerId] : [],
        "waivers",
        action.faabBid
      )
    );
  }

  async proposeTrade(_leagueExternalId: string, action: ProposeTradeAction): Promise<unknown> {
    this.assertLeague(_leagueExternalId);
    return this.client.postJson(
      "/trades/",
      buildEspnTradePayload(action.fromTeamId, action.toTeamId, action.givePlayerIds, action.receivePlayerIds)
    );
  }

  private assertLeague(leagueExternalId: string): void {
    if (leagueExternalId !== this.client.credentials.leagueId) {
      throw new Error(`ESPN writer is configured for league ${this.client.credentials.leagueId}, not ${leagueExternalId}.`);
    }
  }
}

interface EspnLineupEntry { lineupSlotId:number; playerPoolEntry:{rosterLocked?:boolean;player:{id:number;eligibleSlots?:number[];locked?:boolean;lockedInLineup?:boolean;lockedForScoringPeriod?:boolean;gameStatus?:string}} }
interface EspnLineupState {id?:number;seasonId?:number;scoringPeriodId?:number;settings?:{rosterSettings?:{lineupSlotCounts?:Record<string,number>}};teams?:Array<{id:number;owners?:string[];roster?:{entries:EspnLineupEntry[]}}>}
export function buildEspnLineupTransaction(action:SetRosterAction,memberId:string,period:number,entries:EspnLineupEntry[],counts:Record<string,number>):Record<string,unknown>{
 if(!Number.isInteger(period)||period<1||!memberId||!/^\d+$/.test(action.teamId)||Number(action.teamId)<1)throw new Error("Invalid lineup context.");
 const desired=new Map<number,number>();const selectedCounts=new Map<number,number>();
 for(const assignment of action.starters){
  const id=Number(assignment.playerId);const entry=entries.find(e=>e.playerPoolEntry.player.id===id);const slot=mapPositionToEspnSlot(assignment.slot);
  if(!entry||desired.has(id)||[20,21].includes(slot)||!(entry.playerPoolEntry.player.eligibleSlots??[]).includes(slot))throw new Error("Invalid, duplicate, unowned or ineligible lineup assignment.");
  desired.set(id,slot);selectedCounts.set(slot,(selectedCounts.get(slot)??0)+1);
 }
 for(const [slot,count] of Object.entries(counts)){if(![20,21].includes(Number(slot))&&Number(count)>0&&selectedCounts.get(Number(slot))!==Number(count))throw new Error("Lineup does not fill required starter slots.");}
 for(const slot of selectedCounts.keys()){if(!counts[String(slot)]||selectedCounts.get(slot)!==counts[String(slot)])throw new Error("Invalid lineup slot capacity.");}
 const items=[];
 for(const entry of entries){const player=entry.playerPoolEntry.player;const target=desired.get(player.id)??([20,21].includes(entry.lineupSlotId)?entry.lineupSlotId:20);if(target===entry.lineupSlotId)continue;
  if(entry.playerPoolEntry.rosterLocked||player.locked||player.lockedInLineup||player.lockedForScoringPeriod||["IN_PROGRESS","FINAL"].includes(player.gameStatus??""))throw new Error("Cannot move a locked player.");
  items.push({playerId:player.id,type:"LINEUP",fromLineupSlotId:entry.lineupSlotId,toLineupSlotId:target});
 }
 return {isLeagueManager:false,teamId:Number(action.teamId),type:"ROSTER",memberId,scoringPeriodId:period,executionType:"EXECUTE",items};
}

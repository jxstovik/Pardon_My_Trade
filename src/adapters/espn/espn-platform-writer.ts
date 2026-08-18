import type {
  AddDropAction,
  ProposeTradeAction,
  SetRosterAction,
  WaiverClaimAction
} from "../../agents/types.js";
import type { PlatformWriter } from "../platform-writer.js";
import { loadEspnCredentials, type EspnCredentials } from "./espn-auth.js";
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
    const payload = buildEspnRosterPayload(action.teamId, action.starters);
    return this.client.postJson("", payload.body, payload.filter);
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

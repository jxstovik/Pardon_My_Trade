import type {
  AddDropAction,
  ProposeTradeAction,
  SetRosterAction,
  WaiverClaimAction
} from "../agents/types.js";
import type { Platform } from "../models/types.js";

/**
 * Write boundary for approved actions. Implementations must not retry a
 * request whose outcome is not known; that policy belongs to the executor.
 */
export interface PlatformWriter {
  readonly platform: Platform;
  setRoster(leagueExternalId: string, action: SetRosterAction): Promise<unknown>;
  addDrop(leagueExternalId: string, action: AddDropAction): Promise<unknown>;
  submitWaiverClaim(leagueExternalId: string, action: WaiverClaimAction): Promise<unknown>;
  proposeTrade(leagueExternalId: string, action: ProposeTradeAction): Promise<unknown>;
}

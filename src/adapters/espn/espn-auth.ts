import type { PlayerPosition } from "../../models/types.js";

export interface EspnCredentials {
  readonly leagueId: string;
  readonly season: string;
  readonly espnS2?: string;
  readonly swid?: string;
}

export function loadEspnCredentials(env: NodeJS.ProcessEnv = process.env): EspnCredentials {
  const leagueId = env.ESPN_LEAGUE_ID;
  const season = env.ESPN_SEASON ?? new Date().getFullYear().toString();
  if (!leagueId) {
    throw new Error(
      "Missing ESPN_LEAGUE_ID. Set ESPN_LEAGUE_ID (and optionally ESPN_S2, SWID, ESPN_SEASON) in your environment."
    );
  }
  return {
    leagueId,
    season,
    espnS2: env.ESPN_S2,
    swid: env.SWID
  };
}

/**
 * ESPN lineup slot ids -> canonical position. ESPN uses integer slot ids that
 * vary slightly across league configurations; this map covers the common set.
 */
export const ESPN_SLOT_TO_POSITION: Record<number, PlayerPosition> = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  13: "DST",
  14: "K",
  16: "DST",
  17: "BN",
  20: "BN",
  21: "IR",
  23: "FLEX"
};

export const POSITION_TO_ESPN_SLOT: Record<PlayerPosition, number> = {
  QB: 0,
  RB: 2,
  WR: 4,
  TE: 6,
  K: 14,
  DST: 16,
  FLEX: 23,
  SUPER_FLEX: 23,
  BN: 20,
  IR: 21,
  P: 15,
  C: 20,
  "1B": 20,
  "2B": 20,
  "3B": 20,
  SS: 20,
  OF: 20,
  UTIL: 20
};

export interface EspnSlotAssignment {
  readonly playerId: string;
  readonly slot: PlayerPosition;
}

export function mapEspnSlotToPosition(slotId: number): PlayerPosition {
  return ESPN_SLOT_TO_POSITION[slotId] ?? "BN";
}

export function mapPositionToEspnSlot(position: PlayerPosition): number {
  return POSITION_TO_ESPN_SLOT[position] ?? 20;
}

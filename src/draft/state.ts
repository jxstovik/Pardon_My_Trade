import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DraftPickEvent } from "./feed/draft-feed.js";
import type { LeagueSnapshot, Player, PlayerPosition, RosterSettings, Team } from "../models/types.js";

export interface DraftConfig {
  readonly format: "snake" | "auction";
  readonly teams: number;
  readonly myTeamId: string;
  readonly draftPosition: number;
}

export interface DraftNeed {
  readonly slot: PlayerPosition;
  readonly required: number;
  readonly filled: number;
  readonly remaining: number;
}

export interface DraftState {
  readonly config: DraftConfig;
  readonly board: readonly DraftPickEvent[];
  readonly draftedPlayerIds: readonly string[];
}

export function createDraftState(config: DraftConfig): DraftState {
  return { config, board: [], draftedPlayerIds: [] };
}

export function applyPick(state: DraftState, pick: DraftPickEvent): DraftState {
  if (state.board.some((p) => p.pickNo === pick.pickNo)) return state;
  return {
    ...state,
    board: [...state.board, pick].sort((a, b) => a.pickNo - b.pickNo),
    draftedPlayerIds: state.draftedPlayerIds.includes(pick.playerExternalId)
      ? state.draftedPlayerIds
      : [...state.draftedPlayerIds, pick.playerExternalId]
  };
}

export function totalRounds(rosterSettings: RosterSettings): number {
  const starters = rosterSettings.slots.reduce((sum, slot) => sum + slot.count, 0);
  return starters + rosterSettings.bench_count + rosterSettings.injured_reserve_count + rosterSettings.taxi_count;
}

export function nextOverallPick(state: DraftState): number {
  if (state.board.length === 0) return 1;
  return state.board.reduce((max, pick) => Math.max(max, pick.pickNo), 0) + 1;
}

/**
 * Seat (1-based) that owns a given overall pick in a snake draft.
 * Odd rounds run 1..N, even rounds run N..1.
 */
export function seatForPick(pickNo: number, teams: number): number {
  const zeroBased = pickNo - 1;
  const round = Math.floor(zeroBased / teams);
  const offset = zeroBased % teams;
  return round % 2 === 0 ? offset + 1 : teams - offset;
}

export function isMyPick(state: DraftState, pickNo: number): boolean {
  return seatForPick(pickNo, state.config.teams) === state.config.draftPosition;
}

/** How many picks (inclusive) until my seat is next on the clock. */
export function picksUntilMyNext(state: DraftState): number {
  const next = nextOverallPick(state);
  for (let pick = next; ; pick++) {
    if (isMyPick(state, pick)) return pick - next + 1;
  }
}

export function availablePlayers(snapshot: LeagueSnapshot, state: DraftState): Player[] {
  const drafted = new Set(state.draftedPlayerIds);
  return [...snapshot.players, ...snapshot.free_agents].filter((p) => !drafted.has(p.player_id));
}

export function findTeam(snapshot: LeagueSnapshot, teamId: string): Team | undefined {
  return snapshot.league.teams.find((t) => t.team_id === teamId);
}

export function rosterNeeds(state: DraftState, snapshot: LeagueSnapshot): DraftNeed[] {
  const team = findTeam(snapshot, state.config.myTeamId);
  const filledBySlot = new Map<PlayerPosition, number>();
  if (team) {
    for (const slot of team.roster.starters) {
      if (slot.player_id) {
        filledBySlot.set(slot.slot_type, (filledBySlot.get(slot.slot_type) ?? 0) + 1);
      }
    }
  }

  const needs: DraftNeed[] = [];
  for (const slot of snapshot.league.roster_settings.slots) {
    const filled = filledBySlot.get(slot.slot) ?? 0;
    needs.push({
      slot: slot.slot,
      required: slot.count,
      filled,
      remaining: Math.max(0, slot.count - filled)
    });
  }
  return needs;
}

export interface DraftStateStore {
  load(): Promise<DraftState | undefined>;
  save(state: DraftState): Promise<void>;
}

export class InMemoryDraftStateStore implements DraftStateStore {
  private state?: DraftState;
  async load(): Promise<DraftState | undefined> {
    return this.state;
  }
  async save(state: DraftState): Promise<void> {
    this.state = state;
  }
}

export class JsonDraftStateStore implements DraftStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<DraftState | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as DraftState;
    } catch {
      return undefined;
    }
  }

  async save(state: DraftState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

export function resolveDraftStateStorePath(dataDir?: string): string {
  return join(dataDir ?? process.env.PMT_DATA_DIR ?? join(process.cwd(), "data"), "draft-state.json");
}

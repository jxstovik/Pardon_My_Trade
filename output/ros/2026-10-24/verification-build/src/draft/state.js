import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export function createDraftState(config) {
    return { config, board: [], draftedPlayerIds: [] };
}
export function applyPick(state, pick) {
    if (state.board.some((p) => p.pickNo === pick.pickNo))
        return state;
    return {
        ...state,
        board: [...state.board, pick].sort((a, b) => a.pickNo - b.pickNo),
        draftedPlayerIds: state.draftedPlayerIds.includes(pick.playerExternalId)
            ? state.draftedPlayerIds
            : [...state.draftedPlayerIds, pick.playerExternalId]
    };
}
export function totalRounds(rosterSettings) {
    const starters = rosterSettings.slots.reduce((sum, slot) => sum + slot.count, 0);
    return starters + rosterSettings.bench_count + rosterSettings.injured_reserve_count + rosterSettings.taxi_count;
}
export function nextOverallPick(state) {
    if (state.board.length === 0)
        return 1;
    return state.board.reduce((max, pick) => Math.max(max, pick.pickNo), 0) + 1;
}
/**
 * Seat (1-based) that owns a given overall pick in a snake draft.
 * Odd rounds run 1..N, even rounds run N..1.
 */
export function seatForPick(pickNo, teams) {
    const zeroBased = pickNo - 1;
    const round = Math.floor(zeroBased / teams);
    const offset = zeroBased % teams;
    return round % 2 === 0 ? offset + 1 : teams - offset;
}
export function isMyPick(state, pickNo) {
    return seatForPick(pickNo, state.config.teams) === state.config.draftPosition;
}
/** How many picks (inclusive) until my seat is next on the clock. */
export function picksUntilMyNext(state) {
    const next = nextOverallPick(state);
    for (let pick = next;; pick++) {
        if (isMyPick(state, pick))
            return pick - next + 1;
    }
}
export function availablePlayers(snapshot, state) {
    const drafted = new Set(state.draftedPlayerIds);
    return [...snapshot.players, ...snapshot.free_agents].filter((p) => !drafted.has(p.player_id));
}
export function findTeam(snapshot, teamId) {
    return snapshot.league.teams.find((t) => t.team_id === teamId);
}
export function rosterNeeds(state, snapshot) {
    const team = findTeam(snapshot, state.config.myTeamId);
    const filledBySlot = new Map();
    if (team) {
        for (const slot of team.roster.starters) {
            if (slot.player_id) {
                filledBySlot.set(slot.slot_type, (filledBySlot.get(slot.slot_type) ?? 0) + 1);
            }
        }
    }
    const needs = [];
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
export class InMemoryDraftStateStore {
    state;
    async load() {
        return this.state;
    }
    async save(state) {
        this.state = state;
    }
}
export class JsonDraftStateStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        try {
            const raw = await readFile(this.filePath, "utf8");
            return JSON.parse(raw);
        }
        catch {
            return undefined;
        }
    }
    async save(state) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
    }
}
export function resolveDraftStateStorePath(dataDir) {
    return join(dataDir ?? process.env.PMT_DATA_DIR ?? join(process.cwd(), "data"), "draft-state.json");
}

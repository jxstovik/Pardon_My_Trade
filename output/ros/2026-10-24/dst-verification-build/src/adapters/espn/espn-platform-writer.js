import { loadEspnCredentials } from "./espn-auth.js";
import { buildEspnTradePayload } from "./espn-platform-reader.js";
import { mapPositionToEspnSlot } from "./espn-auth.js";
import { EspnPlatformClient } from "./espn-platform-client.js";
/** ESPN write adapter. It only translates the typed writer contract to POSTs. */
export class EspnPlatformWriter {
    platform = "espn";
    client;
    constructor(options = {}) {
        this.client = options.client ?? new EspnPlatformClient({
            credentials: options.credentials ?? loadEspnCredentials(),
            fetchImpl: options.fetchImpl,
            baseUrl: options.baseUrl
        });
    }
    async setRoster(_leagueExternalId, action) {
        this.assertLeague(_leagueExternalId);
        const memberId = this.client.credentials.swid;
        if (!memberId || !this.client.credentials.espnS2)
            throw new Error("ESPN lineup change requires authenticated session credentials.");
        const fresh = await this.client.getJson("", { view: ["mSettings", "mTeam", "mRoster"], scope: { segment: 0, readHost: true } });
        if (String(fresh.id) !== _leagueExternalId || String(fresh.seasonId) !== this.client.credentials.season)
            throw new Error("ESPN lineup league or season mismatch.");
        const team = fresh.teams?.find(t => String(t.id) === action.teamId);
        const identity = (value) => value.replace(/[{}]/g, "").toLowerCase();
        if (!team?.owners?.some(o => identity(o) === identity(memberId)))
            throw new Error("Authenticated ESPN member does not own lineup team.");
        const body = buildEspnLineupTransaction(action, memberId, fresh.scoringPeriodId, team.roster?.entries ?? [], fresh.settings?.rosterSettings?.lineupSlotCounts ?? {});
        if (body.items.length === 0)
            return { status: "UNCHANGED" };
        return this.client.postJson("/transactions/", body, undefined, { segment: 0, writeHost: true });
    }
    async addDrop(_leagueExternalId, action) {
        this.assertLeague(_leagueExternalId);
        return this.acquire(action.teamId, action.addPlayerIds, action.dropPlayerIds, "FREEAGENT");
    }
    async submitWaiverClaim(_leagueExternalId, action) {
        this.assertLeague(_leagueExternalId);
        return this.acquire(action.teamId, [action.addPlayerId], action.dropPlayerId ? [action.dropPlayerId] : [], "WAIVER", action.faabBid);
    }
    async acquire(teamId, adds, drops, type, bid) {
        const memberId = this.client.credentials.swid;
        if (!memberId || !this.client.credentials.espnS2)
            throw new Error("ESPN acquisition requires authenticated session credentials.");
        const fresh = await this.client.getJson("", { view: ["mSettings", "mTeam"], scope: { segment: 0, readHost: true } });
        if (String(fresh.id) !== this.client.credentials.leagueId || String(fresh.seasonId) !== this.client.credentials.season)
            throw new Error("ESPN acquisition league or season mismatch.");
        const team = fresh.teams?.find((team) => String(team.id) === teamId);
        const identity = (value) => value.replace(/[{}]/g, "").toLowerCase();
        if (!team?.owners?.some((owner) => identity(owner) === identity(memberId)))
            throw new Error("Authenticated ESPN member does not own the requested team.");
        if (!Number.isInteger(fresh.scoringPeriodId) || fresh.scoringPeriodId < 1)
            throw new Error("ESPN acquisition requires a fresh scoring period.");
        const body = buildEspnAcquisitionPayload(teamId, memberId, fresh.scoringPeriodId, adds, drops, type, bid);
        return this.client.postJson("/transactions/", body, undefined, { segment: 0, writeHost: true });
    }
    async proposeTrade(_leagueExternalId, action) {
        this.assertLeague(_leagueExternalId);
        return this.client.postJson("/trades/", buildEspnTradePayload(action.fromTeamId, action.toTeamId, action.givePlayerIds, action.receivePlayerIds));
    }
    assertLeague(leagueExternalId) {
        if (leagueExternalId !== this.client.credentials.leagueId) {
            throw new Error(`ESPN writer is configured for league ${this.client.credentials.leagueId}, not ${leagueExternalId}.`);
        }
    }
}
/** Wire contract for a manager-owned acquisition; queue authorization is enforced by ActionExecutor. */
export function buildEspnAcquisitionPayload(teamId, memberId, scoringPeriodId, adds, drops, type, bid) {
    if (!/^\d+$/.test(teamId) || Number(teamId) < 1 || !memberId || !Number.isInteger(scoringPeriodId) || scoringPeriodId < 1)
        throw new Error("Invalid ESPN acquisition context.");
    if (adds.length !== 1 || drops.length > 1 || [...adds, ...drops].some((id) => !Number.isSafeInteger(Number(id)) || !/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/.test(id)) || new Set([...adds, ...drops]).size !== adds.length + drops.length)
        throw new Error("ESPN acquisition requires one add and at most one distinct drop.");
    if (bid !== undefined && (!Number.isFinite(bid) || bid < 0))
        throw new Error("Invalid waiver bid.");
    return {
        isLeagueManager: false, teamId: Number(teamId), type, memberId, scoringPeriodId, executionType: "EXECUTE",
        items: [...adds.map((id) => ({ playerId: Number(id), type: "ADD", toTeamId: Number(teamId) })), ...drops.map((id) => ({ playerId: Number(id), type: "DROP", fromTeamId: Number(teamId) }))],
        ...(type === "WAIVER" ? { bidAmount: bid ?? null } : {})
    };
}
export function buildEspnLineupTransaction(action, memberId, period, entries, counts) {
    if (!Number.isInteger(period) || period < 1 || !memberId || !/^\d+$/.test(action.teamId) || Number(action.teamId) < 1)
        throw new Error("Invalid lineup context.");
    const desired = new Map();
    const selectedCounts = new Map();
    for (const assignment of action.starters) {
        const id = Number(assignment.playerId);
        const entry = entries.find(e => e.playerPoolEntry.player.id === id);
        const slot = mapPositionToEspnSlot(assignment.slot);
        if (!entry || desired.has(id) || [20, 21].includes(slot) || !(entry.playerPoolEntry.player.eligibleSlots ?? []).includes(slot))
            throw new Error("Invalid, duplicate, unowned or ineligible lineup assignment.");
        desired.set(id, slot);
        selectedCounts.set(slot, (selectedCounts.get(slot) ?? 0) + 1);
    }
    for (const [slot, count] of Object.entries(counts)) {
        if (![20, 21].includes(Number(slot)) && Number(count) > 0 && selectedCounts.get(Number(slot)) !== Number(count))
            throw new Error("Lineup does not fill required starter slots.");
    }
    for (const slot of selectedCounts.keys()) {
        if (!counts[String(slot)] || selectedCounts.get(slot) !== counts[String(slot)])
            throw new Error("Invalid lineup slot capacity.");
    }
    const items = [];
    for (const entry of entries) {
        const player = entry.playerPoolEntry.player;
        const target = desired.get(player.id) ?? ([20, 21].includes(entry.lineupSlotId) ? entry.lineupSlotId : 20);
        if (target === entry.lineupSlotId)
            continue;
        if (entry.playerPoolEntry.rosterLocked || player.locked || player.lockedInLineup || player.lockedForScoringPeriod || ["IN_PROGRESS", "FINAL"].includes(player.gameStatus ?? ""))
            throw new Error("Cannot move a locked player.");
        items.push({ playerId: player.id, type: "LINEUP", fromLineupSlotId: entry.lineupSlotId, toLineupSlotId: target });
    }
    return { isLeagueManager: false, teamId: Number(action.teamId), type: "ROSTER", memberId, scoringPeriodId: period, executionType: "EXECUTE", items };
}

import { scoreProjectionPoints } from "../rules/rule-engine.js";
import { DEFAULT_DO_NOT_DROP_RANK_LIMIT, buildDoNotDropList } from "./do-not-drop.js";
const DEFAULT_LINEUP_THRESHOLD = 0.5;
const DEFAULT_WAVIER_THRESHOLD = 1.0;
export class DefaultDecisionEngine {
    ruleEngine;
    lineupThreshold;
    waiverThreshold;
    doNotDropRankLimit;
    constructor(ruleEngine, options = {}) {
        this.ruleEngine = ruleEngine;
        this.lineupThreshold = options.lineupUpgradeThreshold ?? DEFAULT_LINEUP_THRESHOLD;
        this.waiverThreshold = options.waiverUpgradeThreshold ?? DEFAULT_WAVIER_THRESHOLD;
        this.doNotDropRankLimit = options.doNotDropRankLimit ?? DEFAULT_DO_NOT_DROP_RANK_LIMIT;
    }
    generateLineupCandidates(league, team, players, projections) {
        const projectionByPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));
        const playerById = new Map(players.map((player) => [player.player_id, player]));
        const roster = team.roster;
        const candidates = [];
        for (const benchSlot of roster.bench) {
            if (!benchSlot.player_id)
                continue;
            const benchPlayer = playerById.get(benchSlot.player_id);
            if (!benchPlayer)
                continue;
            const benchProjection = projectionByPlayer.get(benchSlot.player_id);
            const benchPositions = this.positionsOf(benchPlayer);
            const benchPoints = benchProjection ? scoreProjectionPoints(league.scoring_settings, benchProjection, benchPositions) : 0;
            for (const starterSlot of roster.starters) {
                if (!starterSlot.player_id)
                    continue;
                if (!starterSlot.allowed_positions.some((position) => benchPositions.includes(position)))
                    continue;
                const starterPlayer = playerById.get(starterSlot.player_id);
                if (!starterPlayer)
                    continue;
                const starterProjection = projectionByPlayer.get(starterSlot.player_id);
                const starterPositions = this.positionsOf(starterPlayer);
                const starterPoints = starterProjection ? scoreProjectionPoints(league.scoring_settings, starterProjection, starterPositions) : 0;
                const delta = Math.round((benchPoints - starterPoints) * 100) / 100;
                if (delta <= this.lineupThreshold)
                    continue;
                const proposedStarters = roster.starters.map((slot) => slot.slot_id === starterSlot.slot_id
                    ? { ...slot, player_id: benchSlot.player_id }
                    : slot);
                const swap = {
                    fromSlotId: benchSlot.slot_id,
                    toSlotId: starterSlot.slot_id,
                    playerInId: benchSlot.player_id,
                    playerOutId: starterSlot.player_id,
                    projectedDelta: delta
                };
                candidates.push({
                    candidateId: `lineup-${team.team_id}-${benchSlot.player_id}-${starterSlot.player_id}`,
                    teamId: team.team_id,
                    proposedStarters,
                    projectedPoints: Math.round((starterPoints + delta) * 100) / 100,
                    swaps: [swap],
                    confidence: 0.6,
                    rationale: `Start ${benchSlot.player_id} over ${starterSlot.player_id} for an estimated +${delta} points.`
                });
            }
        }
        return candidates.sort((a, b) => b.projectedPoints - a.projectedPoints);
    }
    generateWaiverCandidates(league, team, freeAgents, players, projections) {
        const projectionByPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));
        const roster = team.roster;
        const candidates = [];
        const rosterSize = roster.starters.length + roster.bench.length + roster.injured_reserve.length;
        const capacity = this.slotCapacity(league);
        const isFull = rosterSize >= capacity;
        const doNotDrop = this.doNotDropPlayerIds(league, team, players, projectionByPlayer);
        const weakest = this.weakestRosteredPlayer(league, team, players, projectionByPlayer, doNotDrop);
        for (const fa of freeAgents) {
            const faProjection = projectionByPlayer.get(fa.player_id);
            const faPositions = this.positionsOf(fa);
            const faPoints = faProjection ? scoreProjectionPoints(league.scoring_settings, faProjection, faPositions) : 0;
            const evaluation = this.ruleEngine.validateWaiverRecommendation(league, roster, fa, weakest?.player);
            if (!evaluation.valid)
                continue;
            const delta = weakest ? Math.round((faPoints - weakest.points) * 100) / 100 : faPoints;
            if (delta <= this.waiverThreshold)
                continue;
            candidates.push({
                candidateId: `waiver-${team.team_id}-${fa.player_id}`,
                teamId: team.team_id,
                addPlayerId: fa.player_id,
                dropPlayerId: isFull ? weakest?.player.player_id : undefined,
                projectedDelta: delta,
                bidGuidance: league.waiver_settings.type === "faab" ? Math.min(league.waiver_settings.budget ?? 0, Math.round(delta * 5)) : undefined,
                confidence: 0.55,
                rationale: isFull
                    ? `Add ${fa.player_id} (+${delta} pts) and drop ${weakest?.player.player_id}.`
                    : `Add ${fa.player_id} (+${delta} pts) to an open roster spot.`
            });
        }
        return candidates.sort((a, b) => b.projectedDelta - a.projectedDelta);
    }
    generateDropCandidates(league, team, players, projections) {
        const projectionByPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));
        const playerById = new Map(players.map((player) => [player.player_id, player]));
        const doNotDrop = this.doNotDropPlayerIds(league, team, players, projectionByPlayer);
        const candidates = [];
        for (const slot of [...team.roster.bench, ...team.roster.starters]) {
            if (!slot.player_id || doNotDrop.has(slot.player_id))
                continue;
            const player = playerById.get(slot.player_id);
            if (!player)
                continue;
            if (player.status === "bye") {
                candidates.push({
                    candidateId: `drop-${team.team_id}-${player.player_id}`,
                    teamId: team.team_id,
                    dropPlayerId: player.player_id,
                    reason: `${player.player_id} is on a bye week.`,
                    confidence: 0.5
                });
                continue;
            }
            if (player.status === "injured_reserve" || player.injury_status === "out") {
                candidates.push({
                    candidateId: `drop-${team.team_id}-${player.player_id}`,
                    teamId: team.team_id,
                    dropPlayerId: player.player_id,
                    reason: `${player.player_id} is out with an injury.`,
                    confidence: 0.45
                });
            }
        }
        return candidates;
    }
    generateTradeCandidates(snapshot, team, projections) {
        const league = snapshot.league;
        const projectionByPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));
        const playerById = new Map([...snapshot.players, ...snapshot.free_agents].map((player) => [player.player_id, player]));
        const candidates = [];
        const partnerTeams = league.teams.filter((other) => other.team_id !== team.team_id);
        const weakestStarter = this.weakestStarter(league, team, playerById, projectionByPlayer);
        if (!weakestStarter)
            return candidates;
        for (const partner of partnerTeams) {
            for (const slot of partner.roster.starters) {
                if (!slot.player_id)
                    continue;
                const partnerPlayer = playerById.get(slot.player_id);
                if (!partnerPlayer)
                    continue;
                const targetPositions = this.positionsOf(partnerPlayer);
                if (!weakestStarter.positions.some((position) => targetPositions.includes(position)))
                    continue;
                const targetProjection = projectionByPlayer.get(partnerPlayer.player_id);
                const targetPoints = targetProjection ? scoreProjectionPoints(league.scoring_settings, targetProjection, targetPositions) : 0;
                const delta = Math.round((targetPoints - weakestStarter.points) * 100) / 100;
                if (delta <= this.waiverThreshold)
                    continue;
                candidates.push({
                    candidateId: `trade-${team.team_id}-${partner.team_id}-${partnerPlayer.player_id}`,
                    teamId: team.team_id,
                    partnerTeamId: partner.team_id,
                    incomingPlayerId: partnerPlayer.player_id,
                    outgoingPlayerId: weakestStarter.playerId,
                    projectedDelta: delta,
                    confidence: 0.4,
                    rationale: `Target ${partnerPlayer.player_id} (+${delta} pts) from ${partner.name} in exchange for ${weakestStarter.playerId}.`
                });
            }
        }
        return candidates.sort((a, b) => b.projectedDelta - a.projectedDelta);
    }
    generateWeeklyReportInputs(snapshot, team) {
        const league = snapshot.league;
        const playerPositions = this.buildPlayerPositions(snapshot);
        const currentProjectedPoints = this.ruleEngine.calculateProjectedScore(league.scoring_settings, snapshot.projections, team.roster, playerPositions);
        const lineupCandidates = this.generateLineupCandidates(league, team, [...snapshot.players, ...snapshot.free_agents], snapshot.projections);
        const waiverCandidates = this.generateWaiverCandidates(league, team, snapshot.free_agents, [...snapshot.players, ...snapshot.free_agents], snapshot.projections);
        const dropCandidates = this.generateDropCandidates(league, team, [...snapshot.players, ...snapshot.free_agents], snapshot.projections);
        const tradeCandidates = this.generateTradeCandidates(snapshot, team, snapshot.projections);
        const notes = [];
        if (team.standings.wins === 0 && team.standings.losses === 0) {
            notes.push("Season has not started; recommendations are preseason projections.");
        }
        if (snapshot.news.length > 0) {
            notes.push(`${snapshot.news.length} news item(s) may affect lineup decisions.`);
        }
        return {
            leagueId: league.league_id,
            teamId: team.team_id,
            currentProjectedPoints,
            lineupCandidates,
            waiverCandidates,
            dropCandidates,
            tradeCandidates,
            notes
        };
    }
    doNotDropPlayerIds(league, team, players, projectionByPlayer) {
        const rosterPlayerIds = [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve]
            .flatMap((slot) => slot.player_id ? [slot.player_id] : []);
        const rankingValues = players.flatMap((player) => {
            const projection = projectionByPlayer.get(player.player_id);
            return projection
                ? [{ playerId: player.player_id, value: scoreProjectionPoints(league.scoring_settings, projection, this.positionsOf(player)) }]
                : [];
        });
        return buildDoNotDropList(rosterPlayerIds, rankingValues, this.doNotDropRankLimit);
    }
    weakestRosteredPlayer(league, team, players, projectionByPlayer, doNotDrop) {
        const playerById = new Map(players.map((player) => [player.player_id, player]));
        let weakest;
        for (const slot of [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve]) {
            if (!slot.player_id || doNotDrop.has(slot.player_id))
                continue;
            const player = playerById.get(slot.player_id);
            if (!player)
                continue;
            const projection = projectionByPlayer.get(player.player_id);
            const points = projection ? scoreProjectionPoints(league.scoring_settings, projection, this.positionsOf(player)) : 0;
            if (!weakest || points < weakest.points) {
                weakest = { player, points };
            }
        }
        return weakest;
    }
    weakestStarter(league, team, playerById, projectionByPlayer) {
        let weakest;
        for (const slot of team.roster.starters) {
            if (!slot.player_id)
                continue;
            const player = playerById.get(slot.player_id);
            if (!player)
                continue;
            const projection = projectionByPlayer.get(player.player_id);
            const points = projection ? scoreProjectionPoints(league.scoring_settings, projection, this.positionsOf(player)) : 0;
            if (!weakest || points < weakest.points) {
                weakest = { playerId: player.player_id, points, positions: this.positionsOf(player) };
            }
        }
        return weakest;
    }
    positionsOf(player) {
        return player.eligibility.eligible_slots.length > 0 ? player.eligibility.eligible_slots : player.positions;
    }
    buildPlayerPositions(snapshot) {
        const map = new Map();
        for (const player of [...snapshot.players, ...snapshot.free_agents]) {
            map.set(player.player_id, this.positionsOf(player));
        }
        return map;
    }
    slotCapacity(league) {
        const starters = league.roster_settings.slots.reduce((sum, slot) => sum + slot.count, 0);
        return starters + league.roster_settings.bench_count + league.roster_settings.injured_reserve_count + league.roster_settings.taxi_count;
    }
}

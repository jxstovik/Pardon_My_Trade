import { evaluateTrade, DEFAULT_SCARCITY } from "../../probabilistic/model-engine.js";
function groupByPosition(players) {
    const groups = new Map();
    for (const player of players) {
        const list = groups.get(player.position) ?? [];
        list.push(player);
        groups.set(player.position, list);
    }
    for (const list of groups.values())
        list.sort((a, b) => b.mu - a.mu);
    return groups;
}
function toValued(models, slots) {
    return slots
        .map((slot) => {
        const model = models.get(slot.playerId);
        return { playerId: slot.playerId, position: slot.slot, mu: model?.mu ?? 0 };
    })
        .filter((p) => p.position !== "BN" && p.position !== "IR");
}
/**
 * Propose +EV trades to opponent teams that have positional surplus. A trade is
 * suggested when the opponent can spare a player (they have depth) that we can
 * use, and we can spare a player they would want, with positive net value.
 */
export function proposeTrades(teamId, rosterSlots, opponents, models, options = {}) {
    const netThreshold = options.netThreshold ?? 0;
    const maxPerOpponent = options.maxPerOpponent ?? 1;
    const ourPlayers = toValued(models, rosterSlots);
    const ourGroups = groupByPosition(ourPlayers);
    const trades = [];
    for (const opponent of opponents) {
        const theirValued = opponent.players.map((p) => ({
            playerId: p.playerId,
            position: p.position,
            mu: models.get(p.playerId)?.mu ?? 0
        }));
        const theirGroups = groupByPosition(theirValued);
        let count = 0;
        for (const [position, players] of theirGroups) {
            if (count >= maxPerOpponent)
                break;
            // Their spare player is the lowest-rated at a position where they have depth.
            if (players.length < 2)
                continue;
            const receive = players[players.length - 1];
            // We want a position where we have depth to give away.
            const ours = ourGroups.get(position);
            if (!ours || ours.length < 2)
                continue;
            const give = ours[ours.length - 1];
            if (give.mu >= receive.mu)
                continue;
            const evaluation = evaluateTrade([models.get(give.playerId)], [models.get(receive.playerId)], DEFAULT_SCARCITY);
            if (evaluation.netValue <= netThreshold)
                continue;
            trades.push({
                type: "propose_trade",
                fromTeamId: teamId,
                toTeamId: opponent.teamId,
                givePlayerIds: [give.playerId],
                receivePlayerIds: [receive.playerId]
            });
            count += 1;
        }
    }
    return trades;
}

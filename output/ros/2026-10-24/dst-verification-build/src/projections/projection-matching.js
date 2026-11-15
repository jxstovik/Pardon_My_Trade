import { sameScoringPeriod } from "../models/scoring-period.js";
export function normalizeName(name) {
    return name
        .toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}
function buildLookup(players) {
    const byName = new Map();
    for (const player of players) {
        const key = normalizeName(player.full_name);
        const list = byName.get(key) ?? [];
        list.push(player);
        byName.set(key, list);
    }
    return byName;
}
export function matchProjectionsToRoster(candidates, players, scoringPeriod, source) {
    const lookup = buildLookup(players);
    const byId = new Map();
    for (const player of players) {
        for (const id of [player.player_id, player.external_id, player.external_ids.espn])
            if (id)
                byId.set(id, player);
    }
    const matched = [];
    for (const candidate of candidates) {
        if (candidate.scoring_period && !sameScoringPeriod(candidate.scoring_period, scoringPeriod))
            continue;
        const candidates2 = lookup.get(normalizeName(candidate.name)) ?? [];
        const player = (candidate.player_id ? byId.get(candidate.player_id) : undefined)
            ?? resolveNameMatch(candidate, candidates2);
        if (!player)
            continue;
        const observedAt = candidate.observed_at ?? new Date().toISOString();
        matched.push({
            schema_version: "1.0.0",
            created_at: observedAt,
            updated_at: observedAt,
            source_system: source,
            source_record_id: `${source}-${player.player_id}`,
            projection_id: `${source}-${player.player_id}-${scoringPeriod}`,
            player_id: player.player_id,
            source,
            scoring_period: scoringPeriod,
            projected_stats: candidate.projected_stats,
            projected_points: candidate.projected_points,
            floor: candidate.floor,
            ceiling: candidate.ceiling,
            confidence: candidate.confidence
        });
    }
    return matched;
}
function resolveNameMatch(candidate, matches) {
    if (matches.length === 1)
        return matches[0];
    if (matches.length < 2 || !candidate.team)
        return undefined;
    const teamMatches = matches.filter((player) => teamMatchesCandidate(candidate, player));
    return teamMatches.length === 1 ? teamMatches[0] : undefined;
}
function teamMatchesCandidate(candidate, player) {
    return !!player.team && player.team.toUpperCase() === candidate.team.toUpperCase();
}

export interface PlayerRankingValue {
  readonly playerId: string;
  readonly value: number;
}

/**
 * Protect high-ranking rostered players from add/drop recommendations. Ranking
 * inputs should use the best current league-wide player value available.
 */
export const DEFAULT_DO_NOT_DROP_RANK_LIMIT = 100;

export function buildDoNotDropList(
  rosterPlayerIds: readonly string[],
  rankingValues: readonly PlayerRankingValue[],
  rankLimit = DEFAULT_DO_NOT_DROP_RANK_LIMIT
): Set<string> {
  const limit = Number.isInteger(rankLimit) && rankLimit > 0
    ? rankLimit
    : DEFAULT_DO_NOT_DROP_RANK_LIMIT;
  const bestValueByPlayer = new Map<string, number>();

  for (const ranking of rankingValues) {
    if (!Number.isFinite(ranking.value) || ranking.value <= 0) continue;
    const current = bestValueByPlayer.get(ranking.playerId);
    if (current === undefined || ranking.value > current) {
      bestValueByPlayer.set(ranking.playerId, ranking.value);
    }
  }

  const ranked = [...bestValueByPlayer.entries()]
    .map(([playerId, value]) => ({ playerId, value }))
    .sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));
  const rankedIds = new Set(ranked.map(({ playerId }) => playerId));
  const topRankedIds = new Set(ranked.slice(0, limit).map(({ playerId }) => playerId));
  const doNotDrop = new Set<string>();

  for (const playerId of rosterPlayerIds) {
    // Missing or unusable ranking data is not evidence that a rostered player
    // is expendable, so fail closed and protect that player.
    if (!rankedIds.has(playerId) || topRankedIds.has(playerId)) {
      doNotDrop.add(playerId);
    }
  }

  return doNotDrop;
}

import { CATEGORIES, PROFILE_NAMES, type Category, type ProfileName } from "./contracts.js";
import { aggregateCategories, type CategoryTotals, type StatLine } from "./categories.js";
import { DraftSessionSchema, activeSlotCount, snakeTeam, type DraftSession } from "./draft.js";
import type { DraftBoard } from "./forecast.js";

const SEARCH_LIMIT = 24;
const WORKING_POOL_LIMIT = 160;
const OPPONENT_POOL_LIMIT = 112;
const STALE_LIVE_SECONDS = 20;
const STALE_INPUT_HOURS = 24;
const PROFILE_WEIGHTS: Record<ProfileName, Record<Category, number>> = {
  balanced: { PTS: 1, REB: 1, AST: 1, ST: 1, BLK: 1, "3PTM": 1, "FG%": 1, "FT%": 1 },
  guards: { PTS: 0.9, REB: 0.78, AST: 1.3, ST: 1.05, BLK: 0.78, "3PTM": 1.3, "FG%": 0.83, "FT%": 1.28 },
  bigs: { PTS: 0.92, REB: 1.32, AST: 0.78, ST: 0.82, BLK: 1.32, "3PTM": 0.72, "FG%": 1.3, "FT%": 0.82 }
};

type ForecastRow = DraftBoard["rows"][number];
type KnownPlayer = ForecastRow | DraftBoard["excluded"][number];
type Member = {
  playerId: string;
  name: string;
  school: string;
  eligibleGroups: ("G" | "F/C")[];
  forecast: ForecastRow | null;
  source: "observed" | "heuristic-completion" | "candidate";
};
type Slot = { name: string; group: "G" | "F/C" | "Flx" };
const ACTIVE_SLOTS: Slot[] = [
  ...Array.from({ length: 4 }, (_, i) => ({ name: `G${i + 1}`, group: "G" as const })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `F/C${i + 1}`, group: "F/C" as const })),
  ...Array.from({ length: 2 }, (_, i) => ({ name: `Flx${i + 1}`, group: "Flx" as const }))
];

type Lineup = {
  active: { member: Member; slot: string }[];
  reserve: Member[];
  openActiveSlots: string[];
};
type Exposure = { made: number; attempts: number; rate: number | null };
type Evaluation = {
  score: number;
  categoryZ: Record<Category, number>;
  totals: CategoryTotals;
  fgExposure: Exposure;
  ftExposure: Exposure;
  activePlayers: number;
  forecastedActivePlayers: number;
  unforecastedActivePlayers: number;
  minutesStressCases: {
    low: { score: number; categoryZ: Record<Category, number>; fgExposure: Exposure; ftExposure: Exposure };
    high: { score: number; categoryZ: Record<Category, number>; fgExposure: Exposure; ftExposure: Exposure };
  };
};

function makeMember(row: KnownPlayer, source: Member["source"]): Member {
  return {
    playerId: row.fantraxId,
    name: row.name,
    school: row.school,
    eligibleGroups: [...row.eligibleGroups],
    forecast: "stats" in row ? row : null,
    source
  };
}

function isEligibleForSlot(member: Member, slot: Slot): boolean {
  return slot.group === "Flx" || member.eligibleGroups.includes(slot.group);
}

type RosterContext = {
  length: number;
  gOnly: number;
  fcOnly: number;
  gEligible: number;
  fcEligible: number;
  usedIds: Set<string>;
  categorySums: Record<Category, number>;
  forecastedCount: number;
};

function rosterContext(members: Member[]): RosterContext {
  const categorySums = Object.fromEntries(CATEGORIES.map(c => [c, 0])) as Record<Category, number>;
  let forecastedCount = 0;
  let gOnly = 0;
  let fcOnly = 0;
  let gEligible = 0;
  let fcEligible = 0;
  for (const member of members) {
    if (member.eligibleGroups.includes("G") && !member.eligibleGroups.includes("F/C")) gOnly++;
    if (member.eligibleGroups.includes("F/C") && !member.eligibleGroups.includes("G")) fcOnly++;
    if (member.eligibleGroups.includes("G")) gEligible++;
    if (member.eligibleGroups.includes("F/C")) fcEligible++;
    if (member.forecast) {
      forecastedCount++;
      for (const category of CATEGORIES) categorySums[category] += member.forecast.categoryZ[category];
    }
  }
  return { length: members.length, gOnly, fcOnly, gEligible, fcEligible, usedIds: new Set(members.map(p => p.playerId)), categorySums, forecastedCount };
}

/** Exact for the two-group G/F-C league rule, and constant-time inside 2,209-player scans. */
function canAddAndFinish(context: RosterContext, row: ForecastRow): boolean {
  if (context.length >= 14 || context.usedIds.has(row.fantraxId)) return false;
  const gOnly = context.gOnly + Number(row.eligibleGroups.includes("G") && !row.eligibleGroups.includes("F/C"));
  const fcOnly = context.fcOnly + Number(row.eligibleGroups.includes("F/C") && !row.eligibleGroups.includes("G"));
  const length = context.length + 1;
  const active = Math.min(10, length - Math.max(0, gOnly - 6) - Math.max(0, fcOnly - 6));
  return length - active <= 4 && active + (14 - length) >= 10;
}

function canFinishRoster(members: Member[]): boolean {
  if (members.length > 14 || new Set(members.map(p => p.playerId)).size !== members.length) return false;
  const context = rosterContext(members);
  const forcedBench = Math.max(0, context.gOnly - 6) + Math.max(0, context.fcOnly - 6);
  const active = Math.min(10, members.length - forcedBench);
  return members.length - active <= 4 && active + (14 - members.length) >= 10;
}

function evaluateStats(lines: StatLine[], board: DraftBoard) {
  const totals = aggregateCategories(lines);
  const count = lines.length;
  const categoryZ = Object.fromEntries(CATEGORIES.map(category => {
    let total: number;
    if (category === "FG%") total = lines.reduce((sum, line) => sum + line.FGM - board.reference.refFG * line.FGA, 0);
    else if (category === "FT%") total = lines.reduce((sum, line) => sum + line.FTM - board.reference.refFT * line.FTA, 0);
    else total = lines.reduce((sum, line) => sum + line[category], 0);
    const moments = board.reference.moments[category];
    return [category, (total - count * moments.mean) / (Math.sqrt(Math.max(1, count)) * moments.sd)];
  })) as Record<Category, number>;
  const score = CATEGORIES.reduce((sum, category) => sum + categoryZ[category], 0) / CATEGORIES.length;
  return {
    score,
    categoryZ,
    totals,
    fgExposure: { made: totals.FGM, attempts: totals.FGA, rate: totals["FG%"] },
    ftExposure: { made: totals.FTM, attempts: totals.FTA, rate: totals["FT%"] }
  };
}

function sharedUtility(member: Member, board: DraftBoard): number {
  if (!member.forecast) return 0;
  const stats = member.forecast.stats;
  return CATEGORIES.reduce((sum, category) => {
    const contribution = category === "FG%" ? stats.FGM - board.reference.refFG * stats.FGA
      : category === "FT%" ? stats.FTM - board.reference.refFT * stats.FTA
        : stats[category];
    return sum + contribution / board.reference.moments[category].sd;
  }, 0);
}

function assignActiveSlots(active: Member[]): { member: Member; slot: string }[] | null {
  // Fewest-eligible-first keeps the matching search small and deterministic.
  const ordered = active.map((member, index) => ({ member, index }))
    .sort((a, b) => a.member.eligibleGroups.length - b.member.eligibleGroups.length
      || a.member.playerId.localeCompare(b.member.playerId));
  const placements = new Map<number, number>();
  const occupied = new Set<number>();
  const visit = (cursor: number): boolean => {
    if (cursor === ordered.length) return true;
    const { member, index } = ordered[cursor]!;
    for (let slot = 0; slot < ACTIVE_SLOTS.length; slot++) {
      if (occupied.has(slot) || !isEligibleForSlot(member, ACTIVE_SLOTS[slot]!)) continue;
      occupied.add(slot);
      placements.set(index, slot);
      if (visit(cursor + 1)) return true;
      occupied.delete(slot);
      placements.delete(index);
    }
    return false;
  };
  if (!visit(0)) return null;
  return active.map((member, index) => ({ member, slot: ACTIVE_SLOTS[placements.get(index)!]!.name }))
    .sort((a, b) => ACTIVE_SLOTS.findIndex(s => s.name === a.slot) - ACTIVE_SLOTS.findIndex(s => s.name === b.slot));
}

/**
 * Maximize the common team metric over legal active subsets using a bounded
 * exact dynamic program. For fixed forecast coverage, the shared score is a
 * linear sum of player contributions plus a count-only reference adjustment.
 * The draft roster construction itself remains a separate heuristic.
 */
function fitLineup(members: Member[], board: DraftBoard): Lineup {
  const targetActive = activeSlotCount(members.map(member => ({ fantraxId: member.playerId, eligibleGroups: member.eligibleGroups })));
  type State = {
    g: number;
    fc: number;
    flex: number;
    forecastCount: number;
    utility: number;
    selected: Member[];
    key: string;
  };
  const stateKey = (state: State) => `${state.g}|${state.fc}|${state.flex}|${state.forecastCount}`;
  const insert = (states: Map<string, State>, candidate: State) => {
    const key = stateKey(candidate);
    const previous = states.get(key);
    if (!previous || candidate.utility > previous.utility + 1e-12
      || (Math.abs(candidate.utility - previous.utility) <= 1e-12 && candidate.key < previous.key)) {
      states.set(key, candidate);
    }
  };
  let states = new Map<string, State>([["0|0|0|0", { g: 0, fc: 0, flex: 0, forecastCount: 0, utility: 0, selected: [], key: "" }]]);
  const playerUtility = members.map(member => sharedUtility(member, board));
  for (let index = 0; index < members.length; index++) {
    const member = members[index]!;
    const remaining = members.length - index - 1;
    const next = new Map<string, State>();
    for (const state of states.values()) {
      const activeCount = state.g + state.fc + state.flex;
      // Leave this player on reserve if the remaining roster can still fill all active slots.
      if (activeCount + remaining >= targetActive) insert(next, state);
      if (activeCount >= targetActive) continue;
      const forecastCount = state.forecastCount + Number(member.forecast !== null);
      const selected = [...state.selected, member];
      const key = [...(state.key ? state.key.split("\u0000") : []), member.playerId].sort().join("\u0000");
      const utility = state.utility + playerUtility[index]!;
      if (state.g < 4 && member.eligibleGroups.includes("G")) {
        const candidate = { ...state, g: state.g + 1, forecastCount, utility, selected, key };
        if (activeCount + 1 + remaining >= targetActive) insert(next, candidate);
      }
      if (state.fc < 4 && member.eligibleGroups.includes("F/C")) {
        const candidate = { ...state, fc: state.fc + 1, forecastCount, utility, selected, key };
        if (activeCount + 1 + remaining >= targetActive) insert(next, candidate);
      }
      if (state.flex < 2) {
        const candidate = { ...state, flex: state.flex + 1, forecastCount, utility, selected, key };
        if (activeCount + 1 + remaining >= targetActive) insert(next, candidate);
      }
    }
    states = next;
  }
  const meanAdjustment = CATEGORIES.reduce((sum, category) => sum + board.reference.moments[category].mean / board.reference.moments[category].sd, 0);
  let best: State | null = null;
  let bestScore = -Infinity;
  for (const state of states.values()) {
    if (state.g + state.fc + state.flex !== targetActive) continue;
    const score = state.forecastCount === 0
      ? 0
      : (state.utility - state.forecastCount * meanAdjustment) / (CATEGORIES.length * Math.sqrt(state.forecastCount));
    if (!best || score > bestScore + 1e-12
      || (Math.abs(score - bestScore) <= 1e-12 && state.forecastCount > best.forecastCount)
      || (Math.abs(score - bestScore) <= 1e-12 && state.forecastCount === best.forecastCount && state.key < best.key)) {
      best = state;
      bestScore = score;
    }
  }
  if (!best) throw new Error("Observed roster has no legal active assignment");
  const active = assignActiveSlots(best.selected);
  if (!active) throw new Error("Dynamic program selected an illegal active assignment");
  const activeIds = new Set(active.map(({ member }) => member.playerId));
  const usedSlots = new Set(active.map(({ slot }) => slot));
  return {
    active,
    reserve: members.filter(member => !activeIds.has(member.playerId)),
    openActiveSlots: ACTIVE_SLOTS.filter(slot => !usedSlots.has(slot.name)).map(slot => slot.name)
  };
}

function evaluateRoster(members: Member[], board: DraftBoard): Evaluation {
  const lineup = fitLineup(members, board);
  const forecasted = lineup.active.map(p => p.member.forecast).filter((p): p is ForecastRow => p !== null);
  const scored = evaluateStats(forecasted.map(p => p.stats), board);
  const low = evaluateStats(forecasted.map(p => p.sensitivity.low), board);
  const high = evaluateStats(forecasted.map(p => p.sensitivity.high), board);
  return {
    ...scored,
    activePlayers: lineup.active.length,
    forecastedActivePlayers: forecasted.length,
    unforecastedActivePlayers: lineup.active.length - forecasted.length,
    minutesStressCases: {
      low: { score: low.score, categoryZ: low.categoryZ, fgExposure: low.fgExposure, ftExposure: low.ftExposure },
      high: { score: high.score, categoryZ: high.categoryZ, fgExposure: high.fgExposure, ftExposure: high.ftExposure }
    }
  };
}

function memberCategoryZ(member: Member): Record<Category, number> | null {
  return member.forecast?.categoryZ ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type ConstructionFactors = { category: Record<Category, number>; gSlot: number; fcSlot: number };

function constructionFactors(context: RosterContext, profile: ProfileName): ConstructionFactors {
  const weights = PROFILE_WEIGHTS[profile];
  const weightSum = CATEGORIES.reduce((sum, category) => sum + weights[category], 0);
  const category = Object.fromEntries(CATEGORIES.map(c => {
    const need = clamp(-context.categorySums[c] / Math.sqrt(context.forecastedCount + 1), -1.4, 1.4);
    return [c, weights[c] * (1 + 0.22 * need) / weightSum];
  })) as Record<Category, number>;
  return {
    category,
    gSlot: 0.08 * clamp((3 - context.gOnly) / 3, -1, 1),
    fcSlot: 0.08 * clamp((3 - context.fcOnly) / 3, -1, 1)
  };
}

function constructionValueWithFactors(member: Member, factors: ConstructionFactors): number {
  const vector = memberCategoryZ(member);
  if (!vector) return -Infinity;
  let slotFit = 0;
  if (member.eligibleGroups.length === 1) {
    const group = member.eligibleGroups[0]!;
    slotFit = group === "G" ? factors.gSlot : factors.fcSlot;
  }
  return CATEGORIES.reduce((sum, category) => sum + factors.category[category] * vector[category], 0) + slotFit;
}

function constructionValueWithContext(member: Member, context: RosterContext, profile: ProfileName): number {
  return constructionValueWithFactors(member, constructionFactors(context, profile));
}

function constructionValue(member: Member, roster: Member[], profile: ProfileName): number {
  return constructionValueWithContext(member, rosterContext(roster), profile);
}

function searchCandidates(available: ForecastRow[], roster: Member[], profile: ProfileName): ForecastRow[] {
  const context = rosterContext(roster);
  const factors = constructionFactors(context, profile);
  const ranked = available.map(row => ({ row, value: constructionValueWithFactors(makeMember(row, "candidate"), factors) }))
    .sort((a, b) => b.value - a.value || b.row.categoryScore - a.row.categoryScore || (a.row.adp ?? Infinity) - (b.row.adp ?? Infinity) || a.row.fantraxId.localeCompare(b.row.fantraxId));
  const selected = new Map<string, ForecastRow>();
  const add = (rows: typeof ranked) => rows.forEach(item => selected.set(item.row.fantraxId, item.row));
  add(ranked.slice(0, 12));
  add(ranked.filter(p => p.row.eligibleGroups.length === 1 && p.row.eligibleGroups.includes("G")).slice(0, 6));
  add(ranked.filter(p => p.row.eligibleGroups.length === 1 && p.row.eligibleGroups.includes("F/C")).slice(0, 6));
  for (const item of ranked) {
    if (selected.size >= SEARCH_LIMIT) break;
    selected.set(item.row.fantraxId, item.row);
  }
  const valueById = new Map(ranked.map(item => [item.row.fantraxId, item.value]));
  return [...selected.values()].slice(0, SEARCH_LIMIT).sort((a, b) => valueById.get(b.fantraxId)! - valueById.get(a.fantraxId)!
    || b.categoryScore - a.categoryScore || (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId));
}

function buildWorkingPool(available: ForecastRow[], roster: Member[], profile: ProfileName): ForecastRow[] {
  const context = rosterContext(roster);
  const factors = constructionFactors(context, profile);
  const ranked = available.map(row => ({ row, value: constructionValueWithFactors(makeMember(row, "candidate"), factors) }))
    .sort((a, b) => b.value - a.value || b.row.categoryScore - a.row.categoryScore
      || (a.row.adp ?? Infinity) - (b.row.adp ?? Infinity) || a.row.fantraxId.localeCompare(b.row.fantraxId));
  const selected = new Map<string, ForecastRow>();
  const add = (rows: ForecastRow[], count: number) => {
    for (const row of rows.slice(0, count)) {
      if (selected.size >= WORKING_POOL_LIMIT) break;
      selected.set(row.fantraxId, row);
    }
  };
  const byValue = ranked.map(item => item.row);
  add(byValue, 48);
  add(byValue.filter(row => row.eligibleGroups.length === 1 && row.eligibleGroups.includes("G")), 12);
  add(byValue.filter(row => row.eligibleGroups.length === 1 && row.eligibleGroups.includes("F/C")), 12);
  add(byValue.filter(row => row.eligibleGroups.length === 2), 12);
  add([...available].sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 16);
  add([...available].sort((a, b) => b.categoryScore - a.categoryScore || a.fantraxId.localeCompare(b.fantraxId)), 16);
  add([...available].filter(row => row.draftRank !== null)
    .sort((a, b) => (a.draftRank ?? Infinity) - (b.draftRank ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 12);
  add([...available].filter(row => row.providerRank !== null)
    .sort((a, b) => (a.providerRank ?? Infinity) - (b.providerRank ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 12);
  const valueById = new Map(ranked.map(item => [item.row.fantraxId, item.value]));
  return [...selected.values()].sort((a, b) => valueById.get(b.fantraxId)! - valueById.get(a.fantraxId)!
    || (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId));
}

function buildOpponentPool(available: ForecastRow[]): ForecastRow[] {
  const selected = new Map<string, ForecastRow>();
  const add = (rows: ForecastRow[], count: number) => {
    for (const row of rows.slice(0, count)) {
      if (selected.size >= OPPONENT_POOL_LIMIT) break;
      selected.set(row.fantraxId, row);
    }
  };
  add([...available].sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 48);
  add([...available].sort((a, b) => b.categoryScore - a.categoryScore || (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 20);
  add([...available].filter(row => row.draftRank !== null)
    .sort((a, b) => (a.draftRank ?? Infinity) - (b.draftRank ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 20);
  add(available.filter(row => row.eligibleGroups.length === 1 && row.eligibleGroups.includes("G"))
    .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 8);
  add(available.filter(row => row.eligibleGroups.length === 1 && row.eligibleGroups.includes("F/C"))
    .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 8);
  add(available.filter(row => row.eligibleGroups.length === 2)
    .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId)), 8);
  return [...selected.values()];
}

function mergePools(...pools: ForecastRow[][]): ForecastRow[] {
  const rows = new Map<string, ForecastRow>();
  for (const pool of pools) for (const row of pool) rows.set(row.fantraxId, row);
  return [...rows.values()];
}

function bestCandidate(available: ForecastRow[], roster: Member[], profile: ProfileName, allowed?: Set<string>): ForecastRow | null {
  let best: ForecastRow | null = null;
  let bestValue = -Infinity;
  const context = rosterContext(roster);
  const factors = constructionFactors(context, profile);
  for (const row of available) {
    if (allowed && !allowed.has(row.fantraxId)) continue;
    if (!canAddAndFinish(context, row)) continue;
    const value = constructionValueWithFactors(makeMember(row, "candidate"), factors);
    if (value > bestValue + 1e-12 || (Math.abs(value - bestValue) <= 1e-12 && row.fantraxId.localeCompare(best?.fantraxId ?? "~") < 0)) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

function completeRoster(
  initial: Member[],
  pool: ForecastRow[],
  profile: ProfileName,
  limit = 14
): { members: Member[]; completion: Member[] } {
  const members = [...initial];
  const completion: Member[] = [];
  while (members.length < Math.min(limit, 14)) {
    const next = bestCandidate(pool, members, profile);
    if (!next) break;
    const member = makeMember(next, "heuristic-completion");
    members.push(member);
    completion.push(member);
  }
  return { members, completion };
}

function playerSummary(member: Member) {
  return {
    playerId: member.playerId,
    name: member.name,
    school: member.school,
    eligibleGroups: [...member.eligibleGroups],
    forecasted: member.forecast !== null,
    source: member.source,
    adp: member.forecast?.adp ?? null,
    providerRank: member.forecast?.providerRank ?? null,
    categoryRank: member.forecast?.rank ?? null,
    draftRank: member.forecast?.draftRank ?? null,
    categoryScore: member.forecast?.categoryScore ?? null,
    positionValue: member.forecast?.positionValue ?? null,
    minutes: member.forecast?.minutes ?? null,
    stats: member.forecast ? { ...member.forecast.stats } : null,
    categoryZ: member.forecast ? { ...member.forecast.categoryZ } : null,
    sensitivity: member.forecast ? { lowMinutes: member.forecast.scenarioMinutes.low, highMinutes: member.forecast.scenarioMinutes.high } : null,
    basis: member.forecast?.basis ?? null,
    reviewRequired: member.forecast?.reviewRequired ?? true,
    flags: member.forecast ? [...member.forecast.flags] : ["selected-player-has-no-current-forecast"]
  };
}

function lineupOutput(members: Member[], board: DraftBoard) {
  const lineup = fitLineup(members, board);
  return {
    players: members.map(playerSummary),
    active: lineup.active.map(p => ({ ...playerSummary(p.member), slot: p.slot })),
    reserve: lineup.reserve.map(playerSummary),
    openActiveSlots: lineup.openActiveSlots,
    openReserveSlots: Math.max(0, 4 - lineup.reserve.length),
    legalRoster: members.length <= 14 && members.length - lineup.active.length <= 4
      && activeSlotCount(members.map(p => ({ fantraxId: p.playerId, eligibleGroups: p.eligibleGroups }))) === lineup.active.length,
    evaluation: evaluateRoster(members, board)
  };
}

function displayRun(groups: string[]): { group: string | null; count: number } {
  if (!groups.length) return { group: null, count: 0 };
  const group = groups[groups.length - 1]!;
  let count = 0;
  for (let i = groups.length - 1; i >= 0 && groups[i] === group; i--) count++;
  return { group: count >= 2 ? group : null, count };
}

function playerGroup(member: Member | undefined): string {
  if (!member) return "unknown";
  if (member.eligibleGroups.length === 2) return "dual";
  return member.eligibleGroups[0] ?? "unknown";
}

function opponentScore(row: ForecastRow, context: RosterContext, scenario: "adp-reference" | "guard-demand" | "big-demand"): number {
  const adp = row.adp ?? 500;
  const base = -adp * 0.01 + row.categoryScore * 0.04;
  if (scenario === "adp-reference") return base;
  const group = scenario === "guard-demand" ? "G" : "F/C";
  const ownedCount = group === "G" ? context.gEligible : context.fcEligible;
  const demand = clamp((4 - ownedCount) / 4, 0, 1);
  const onlyGroup = row.eligibleGroups.length === 1 && row.eligibleGroups[0] === group;
  const eligible = row.eligibleGroups.includes(group);
  return base + (eligible ? 0.24 * demand : 0) + (onlyGroup ? 0.08 : 0);
}

function simulateOpponentInterval(
  state: DraftSession,
  initialAvailable: ForecastRow[],
  initialRoster: Map<string, Member[]>,
  fromOverall: number,
  untilOverall: number,
  scenario: "adp-reference" | "guard-demand" | "big-demand"
): { picks: { overall: number; teamId: string; playerId: string; name: string; eligibleGroups: string[] }[]; remaining: ForecastRow[]; rosters: Map<string, Member[]> } {
  const remaining = [...initialAvailable];
  const rosters = new Map([...initialRoster].map(([id, players]) => [id, [...players]]));
  const picks: { overall: number; teamId: string; playerId: string; name: string; eligibleGroups: string[] }[] = [];
  for (let overall = fromOverall + 1; overall < untilOverall; overall++) {
    const teamId = snakeTeam(state.teamOrder, overall);
    if (teamId === state.teamId) continue;
    const roster = rosters.get(teamId) ?? [];
    if (roster.length >= 14) continue;
    const context = rosterContext(roster);
    let best: ForecastRow | null = null;
    let bestIndex = -1;
    let score = -Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const row = remaining[index]!;
      if (!canAddAndFinish(context, row)) continue;
      const value = opponentScore(row, context, scenario);
      if (value > score + 1e-12 || (Math.abs(value - score) <= 1e-12 && row.fantraxId.localeCompare(best?.fantraxId ?? "~") < 0)) {
        best = row;
        bestIndex = index;
        score = value;
      }
    }
    if (!best) continue;
    const member = makeMember(best, "heuristic-completion");
    remaining.splice(bestIndex, 1);
    rosters.set(teamId, [...roster, member]);
    picks.push({ overall, teamId, playerId: best.fantraxId, name: best.name, eligibleGroups: [...best.eligibleGroups] });
  }
  return { picks, remaining, rosters };
}

function playerFromPick(id: string, byId: Map<string, KnownPlayer>): Member | null {
  const player = byId.get(id);
  return player ? makeMember(player, "observed") : null;
}

function initialOpponentRosters(state: DraftSession, byId: Map<string, KnownPlayer>): Map<string, Member[]> {
  const rosters = new Map(state.teamOrder.map(id => [id, [] as Member[]]));
  for (const pick of state.picks) {
    const member = playerFromPick(pick.playerId, byId);
    if (member) rosters.get(pick.teamId)!.push(member);
  }
  return rosters;
}

function observedTrends(state: DraftSession, board: DraftBoard, byId: Map<string, KnownPlayer>, opponentRosters: Map<string, Member[]>, asOf: Date) {
  const recent = state.picks.slice(-6).map(pick => {
    const member = playerFromPick(pick.playerId, byId);
    return { overall: pick.overall, teamId: pick.teamId, playerId: pick.playerId, name: member?.name ?? pick.playerId, group: playerGroup(member ?? undefined), forecasted: member?.forecast !== null && member?.forecast !== undefined };
  });
  const recentGroups = recent.map(p => p.group);
  const categoryTeams = [...opponentRosters].filter(([teamId]) => teamId !== state.teamId).map(([teamId, players]) => {
    const forecasted = players.filter(p => p.forecast !== null);
    const totals = aggregateCategories(forecasted.map(p => p.forecast!.stats));
    const active = activeSlotCount(players.map(p => ({ fantraxId: p.playerId, eligibleGroups: p.eligibleGroups })));
    return {
      teamId,
      observedPicks: players.length,
      remainingRosterSpots: Math.max(0, 14 - players.length),
      projectedActiveFilled: active,
      observedGEligible: players.filter(p => p.eligibleGroups.includes("G")).length,
      observedFCEligible: players.filter(p => p.eligibleGroups.includes("F/C")).length,
      categoryExposure: { PTS: totals.PTS, REB: totals.REB, AST: totals.AST, ST: totals.ST, BLK: totals.BLK, "3PTM": totals["3PTM"], FG: { made: totals.FGM, attempts: totals.FGA, rate: totals["FG%"] }, FT: { made: totals.FTM, attempts: totals.FTA, rate: totals["FT%"] } },
      categoryCoverage: { forecasted: forecasted.length, unforecasted: players.length - forecasted.length }
    };
  });
  return {
    recentPicks: recent,
    lastSixGroupCounts: Object.fromEntries(["G", "F/C", "dual", "unknown"].map(group => [group, recentGroups.filter(g => g === group).length])),
    currentRun: displayRun(recentGroups),
    teams: categoryTeams,
    note: "Observed selections only. Category exposure is per-game conditional on playing and partial when a selected player lacks a forecast.",
    forecastCoverage: { selectedWithForecast: state.picks.filter(p => byId.get(p.playerId) && "stats" in byId.get(p.playerId)!).length, selectedWithoutForecast: state.picks.filter(p => !byId.get(p.playerId) || !("stats" in byId.get(p.playerId)!)).length },
    sourceAgeHours: {
      state: Math.max(0, (asOf.getTime() - Date.parse(state.observedAt)) / 3_600_000),
      board: Math.max(0, (asOf.getTime() - Date.parse(board.generatedAt)) / 3_600_000)
    }
  };
}

function buildNextPickScenarios(
  state: DraftSession,
  board: DraftBoard,
  firstOverall: number | null,
  secondOverall: number | null,
  owned: Member[],
  rankedStarts: ForecastRow[],
  profileWorkingPool: ForecastRow[],
  opponentPool: ForecastRow[],
  opponentRosters: Map<string, Member[]>,
  profile: ProfileName
) {
  if (firstOverall === null || secondOverall === null) return [];
  const cases: { scenario: "adp-reference" | "guard-demand" | "big-demand"; label: string }[] = [
    { scenario: "adp-reference", label: "ADP reference; ADP is a market ordering, not a survival probability." },
    { scenario: "guard-demand", label: "Deterministic guard-demand stress case based on observed rosters." },
    { scenario: "big-demand", label: "Deterministic F/C-demand stress case based on observed rosters." }
  ];
  return cases.map(({ scenario, label }) => {
    const scenarioPool = mergePools(opponentPool, profileWorkingPool, rankedStarts);
    const beforeFirst = simulateOpponentInterval(state, scenarioPool, opponentRosters, state.picks.length, firstOverall, scenario);
    const stillAvailable = new Set(beforeFirst.remaining.map(row => row.fantraxId));
    let bestPair: { first: ForecastRow; second: ForecastRow | null; value: number; opponentPicks: ReturnType<typeof simulateOpponentInterval>["picks"]; remaining: ForecastRow[] } | null = null;
    for (const first of rankedStarts) {
      if (!stillAvailable.has(first.fantraxId)) continue;
      const firstMember = makeMember(first, "candidate");
      const afterFirst = [...owned, firstMember];
      if (!canFinishRoster(afterFirst)) continue;
      const beforeOpponents = beforeFirst.remaining.filter(row => row.fantraxId !== first.fantraxId);
      const opponents = simulateOpponentInterval(state, beforeOpponents, beforeFirst.rosters, firstOverall, secondOverall, scenario);
      const second = bestCandidate(opponents.remaining, afterFirst, profile);
      const value = constructionValue(firstMember, owned, profile) + (second ? constructionValue(makeMember(second, "candidate"), afterFirst, profile) : -1000);
      if (!bestPair || value > bestPair.value + 1e-12 || (Math.abs(value - bestPair.value) <= 1e-12 && first.fantraxId.localeCompare(bestPair.first.fantraxId) < 0)) {
        bestPair = { first, second, value, opponentPicks: opponents.picks, remaining: opponents.remaining };
      }
    }
    if (!bestPair) return { scenario, label, firstOwnOverall: firstOverall, secondOwnOverall: secondOverall, beforeFirstOwnPick: beforeFirst.picks, opponentPicks: [], bestPair: null, waitCase: null };
    const pairMembers = [...owned, makeMember(bestPair.first, "candidate")];
    if (bestPair.second) pairMembers.push(makeMember(bestPair.second, "candidate"));
    const projected = completeRoster(pairMembers, bestPair.remaining, profile);
    const alternative = rankedStarts.find(p => p.fantraxId !== bestPair!.first.fantraxId && stillAvailable.has(p.fantraxId)) ?? null;
    let waitCase: Record<string, unknown> | null = null;
    if (alternative) {
      const altMembers = [...owned, makeMember(alternative, "candidate")];
      const afterAlternative = beforeFirst.remaining.filter(row => row.fantraxId !== alternative.fantraxId);
      const waitSimulation = simulateOpponentInterval(state, afterAlternative, beforeFirst.rosters, firstOverall, secondOverall, scenario);
      const targetStillAvailable = waitSimulation.remaining.some(row => row.fantraxId === bestPair!.first.fantraxId);
      const nextAfterWait = bestCandidate(waitSimulation.remaining, altMembers, profile);
      const waitMembers = [...altMembers, ...(nextAfterWait ? [makeMember(nextAfterWait, "candidate")] : [])];
      const waitProjected = completeRoster(waitMembers, waitSimulation.remaining, profile);
      const removedBy = waitSimulation.picks.find(p => p.playerId === bestPair!.first.fantraxId) ?? null;
      waitCase = {
        firstInstead: playerSummary(makeMember(alternative, "candidate")),
        target: playerSummary(makeMember(bestPair.first, "candidate")),
        targetStillAvailableAtSecondPick: targetStillAvailable,
        removedBy: removedBy ? { overall: removedBy.overall, teamId: removedBy.teamId } : null,
        secondPickIfWaited: nextAfterWait ? playerSummary(makeMember(nextAfterWait, "candidate")) : null,
        projectedEvaluation: evaluateRoster(waitProjected.members, board)
      };
    }
    return {
      scenario,
      label,
      firstOwnOverall: firstOverall,
      secondOwnOverall: secondOverall,
      beforeFirstOwnPick: beforeFirst.picks,
      opponentPicks: bestPair.opponentPicks,
      searchBound: {
        firstCandidates: Math.min(SEARCH_LIMIT, rankedStarts.length),
        boundedScenarioPool: scenarioPool.length,
        opponentPoolLimit: OPPONENT_POOL_LIMIT,
        secondPick: "best legal remaining forecast by profile construction heuristic"
      },
      bestPair: {
        first: playerSummary(makeMember(bestPair.first, "candidate")),
        second: bestPair.second ? playerSummary(makeMember(bestPair.second, "candidate")) : null,
        constructionValue: bestPair.value,
        projectedEvaluation: evaluateRoster(projected.members, board)
      },
      waitCase
    };
  });
}

function recommendationScenarioExposure(candidateId: string, scenarios: ReturnType<typeof buildNextPickScenarios>) {
  return scenarios.map((scenario: any) => {
    const pick = scenario.opponentPicks?.find((p: { playerId: string }) => p.playerId === candidateId);
    const beforeFirst = scenario.beforeFirstOwnPick?.find((p: {playerId:string}) => p.playerId === candidateId);
    return {
      scenario: scenario.scenario,
      targetSelectedBeforeFirstOwnPick: Boolean(beforeFirst),
      targetSelectedByOpponentBeforeNextOwnPick: Boolean(pick),
      selectedAtOverall: pick?.overall ?? null,
      selectedByTeamId: pick?.teamId ?? null,
      scenarioBestPairFirst: scenario.bestPair?.first?.playerId === candidateId
    };
  });
}

export type AdaptiveAdviceOptions = { limit?: number; selectedProfile?: ProfileName };

/** Deterministic draft construction scenarios. This is an advisory heuristic, not a trained model or optimizer. */
export function buildAdaptiveAdvice(board: DraftBoard, input: DraftSession, asOf: Date, options: AdaptiveAdviceOptions = {}) {
  const state = DraftSessionSchema.parse(input);
  const limit = options.limit ?? 8;
  const selectedProfile = options.selectedProfile ?? "balanced";
  if (!PROFILE_NAMES.includes(selectedProfile)) throw new Error("Unsupported selected profile");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid recommendation limit");
  if (state.leagueId !== board.leagueId || state.teamId !== board.teamId || state.boardRevision !== board.revision) throw new Error("Draft session league/team/board scope mismatch");
  if (new Set(state.teamOrder).size !== 8 || !state.teamOrder.includes(state.teamId)) throw new Error("Invalid/duplicate snake team order");
  if (!Number.isFinite(asOf.getTime())) throw new Error("Invalid advice timestamp");
  const known = new Map<string, KnownPlayer>();
  for (const row of [...board.rows, ...board.excluded]) {
    if (known.has(row.fantraxId)) throw new Error("Duplicate player identity in forecast board");
    known.set(row.fantraxId, row);
  }
  const selectedIds = new Set<string>();
  state.picks.forEach((pick, i) => {
    if (pick.overall !== i + 1 || pick.teamId !== snakeTeam(state.teamOrder, pick.overall)) throw new Error("Draft picks must be contiguous and follow the supplied manual snake order");
    if (!known.has(pick.playerId) || selectedIds.has(pick.playerId)) throw new Error("Unknown or duplicate selected player");
    selectedIds.add(pick.playerId);
  });
  if (state.phase === "pre-draft" && state.picks.length > 0) throw new Error("Pre-draft state cannot contain selections");
  if (state.phase === "complete" && state.picks.length !== 112) throw new Error("Complete draft requires all 112 selections");
  if (state.unavailablePlayerIds.some(id => !known.has(id))) throw new Error("Unknown unavailable player ID");

  const ownIds = state.picks.filter(p => p.teamId === state.teamId).map(p => p.playerId);
  const owned = ownIds.map(id => makeMember(known.get(id)!, "observed"));
  if (!canFinishRoster(owned)) throw new Error("Observed own roster cannot fit the verified active/reserve slots");
  const inputAgesHours = {
    board: (asOf.getTime() - Date.parse(board.generatedAt)) / 3_600_000,
    pool: (asOf.getTime() - Date.parse(board.inputs.historySource.observedAt)) / 3_600_000,
    provider: (asOf.getTime() - Date.parse(board.inputs.provider.observedAt)) / 3_600_000
  };
  if (Object.values(inputAgesHours).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Future/invalid board input observation");
  const stateAgeSeconds = (asOf.getTime() - Date.parse(state.observedAt)) / 1000;
  if (!Number.isFinite(stateAgeSeconds) || stateAgeSeconds < 0) throw new Error("Draft observation is in the future");
  if (Date.parse(state.draftStart) > asOf.getTime() && state.phase !== "pre-draft") throw new Error("Cannot label a future scheduled draft live/complete");
  const staleInputs = Object.values(inputAgesHours).some(n => n > STALE_INPUT_HOURS);
  const staleState = state.phase === "live" && (stateAgeSeconds > STALE_LIVE_SECONDS || staleInputs);
  const complete = state.picks.length === 112 || ownIds.length === 14;
  const status = complete ? "complete" : staleState ? "stale-state" : state.phase === "pre-draft" ? "draft-preparation" : "local-live-advice";
  const statusIds = new Set(board.statusObservations.map(p => p.fantraxId));
  const unavailableIds = new Set([...selectedIds, ...state.unavailablePlayerIds, ...statusIds]);
  const available = board.rows.filter(row => !unavailableIds.has(row.fantraxId));
  const opponentPool = buildOpponentPool(available);
  const opponentRosters = initialOpponentRosters(state, known);
  const nextOwn = Array.from({ length: Math.max(0, 112 - state.picks.length) }, (_, i) => state.picks.length + i + 1)
    .filter(overall => snakeTeam(state.teamOrder, overall) === state.teamId);
  const nextOwnOverall = nextOwn[0] ?? null;
  const secondOwnOverall = nextOwn[1] ?? null;
  const ownTurn = !complete && state.phase === "live" && !staleState && snakeTeam(state.teamOrder, state.picks.length + 1) === state.teamId;
  const profiles = {} as Record<ProfileName, any>;
  const scenarioLists = {} as Record<ProfileName, any[]>;
  const warnings: string[] = [
    "All construction weights and opportunity scenarios are fixed experimental heuristics, not trained or calibrated values.",
    "The shared score is an equal-weight eight-category comparison. Active-lineup selection maximizes this metric within each constructed roster; bounded roster construction is not globally optimized, and this is not a category-win or draft-success probability.",
    "Projected completions use a deterministic bounded working pool assembled from profile value, eligibility-group, ADP, provider-rank and category leaders; the full available forecast count remains visible, but omitted candidates are not searched for completions.",
    "Opponent opportunity scenarios use a separate deterministic bounded pool and are stress cases, not calibrated survival forecasts.",
    "Low/high minutes cases are deterministic stress tests from the saved forecast recipe, not confidence intervals.",
    "Player forecasts are conditional on playing; lineup schedules, games played, activation timing and weekly starts are not modeled.",
    "This advice does not submit or queue a pick. Live actions executed: 0."
  ];
  if (!board.excluded.length) warnings.push("No separate excluded-player review lane was present in this forecast board.");
  if (board.excluded.length) warnings.push(`${board.excluded.length} player identities have no forecast; excluded players are never used for completion and absence is not clearance.`);
  if (statusIds.size) warnings.push(`${statusIds.size} known status observations block those players from new recommendations; owned selections remain visible.`);
  if (ownIds.some(id => !("stats" in known.get(id)!))) warnings.push("At least one observed own selection has no forecast; its eligibility is retained, while its statistics are omitted from category totals.");
  if (staleInputs) warnings.push("One or more forecast inputs are older than 24 hours; live advice is stale until refreshed.");
  if (state.phase === "live" && stateAgeSeconds > STALE_LIVE_SECONDS) warnings.push("The observed draft state is older than the 20-second live advice threshold.");
  if (state.sourceKind === "manual-local") warnings.push("The draft state is manual local input, not an independently verified platform feed.");

  for (const profile of PROFILE_NAMES) {
    const profileWorkingPool = buildWorkingPool(available, owned, profile);
    const recommendationCandidates = searchCandidates(available, owned, profile);
    const baseline = completeRoster(owned, profileWorkingPool, profile);
    const baselineEvaluation = evaluateRoster(baseline.members, board);
    const ownedContext = rosterContext(owned);
    const bounded = recommendationCandidates.filter(row => canAddAndFinish(ownedContext, row));
    scenarioLists[profile] = staleState || complete ? [] : buildNextPickScenarios(
      state, board, nextOwnOverall, secondOwnOverall, owned, recommendationCandidates, profileWorkingPool, opponentPool, opponentRosters, profile
    );
    const recommendationRows = staleState || complete ? [] : bounded.slice(0, SEARCH_LIMIT).map(row => {
      const withCandidate = completeRoster([...owned, makeMember(row, "candidate")], profileWorkingPool, profile);
      const projected = evaluateRoster(withCandidate.members, board);
      const candidateLineup = fitLineup([...owned, makeMember(row, "candidate")], board);
      const categoryDelta = Object.fromEntries(CATEGORIES.map(c => [c, projected.categoryZ[c] - baselineEvaluation.categoryZ[c]])) as Record<Category, number>;
      return {
        player: playerSummary(makeMember(row, "candidate")),
        constructionValue: constructionValue(makeMember(row, "candidate"), owned, profile),
        marginalSharedScore: projected.score - baselineEvaluation.score,
        marginalCategoryZ: categoryDelta,
        projectedEvaluation: projected,
        activeSlotsAfterPick: 10 - candidateLineup.openActiveSlots.length,
        reserveSpotsUsedAfterPick: [...owned, makeMember(row, "candidate")].length - candidateLineup.active.length,
        legalAfterPick: canFinishRoster([...owned, makeMember(row, "candidate")]),
        scenarioExposure: recommendationScenarioExposure(row.fantraxId, scenarioLists[profile]),
        nextMeaningfulReplacement: null as null | { playerId: string; name: string; sharedScoreGap: number }
      };
    }).sort((a, b) => b.constructionValue - a.constructionValue || b.marginalSharedScore - a.marginalSharedScore || a.player.playerId.localeCompare(b.player.playerId)).slice(0, limit);
    for (let i = 0; i < recommendationRows.length; i++) {
      const next = recommendationRows[i + 1];
      if (next) recommendationRows[i]!.nextMeaningfulReplacement = {
        playerId: next.player.playerId,
        name: next.player.name,
        sharedScoreGap: recommendationRows[i]!.projectedEvaluation.score - next.projectedEvaluation.score
      };
    }
    const path = lineupOutput(baseline.members, board);
    const assumedFuture = baseline.completion.map(playerSummary);
    profiles[profile] = {
      profile,
      rationale: profile === "balanced"
        ? "Equal construction weights with roster-category balancing; the common evaluation remains equal across all eight categories."
        : profile === "guards"
          ? "Construction preference gives extra weight to AST, 3PTM and FT% while retaining every category; shared evaluation is unchanged."
          : "Construction preference gives extra weight to REB, BLK and FG% while retaining every category; shared evaluation is unchanged. F/C eligibility is not a center-only label.",
      construction: assumedFuture,
      recommendations: recommendationRows,
      projectedRoster: path,
      nextPickScenarios: scenarioLists[profile],
      searchBounds: {
        recommendationCandidates: Math.min(SEARCH_LIMIT, recommendationCandidates.length),
        constructionWorkingPool: profileWorkingPool.length,
        opponentScenarioPool: opponentPool.length,
        totalAvailableForecasted: available.length
      },
      baselineMarginalReference: { score: baselineEvaluation.score, categoryZ: baselineEvaluation.categoryZ }
    };
  }

  const scores = PROFILE_NAMES.map(profile => ({ profile, score: profiles[profile].projectedRoster.evaluation.score }));
  const bestProfile = [...scores].sort((a, b) => b.score - a.score || PROFILE_NAMES.indexOf(a.profile) - PROFILE_NAMES.indexOf(b.profile))[0]!;
  const balancedScore = profiles.balanced.projectedRoster.evaluation.score;
  const suggestedProfile = bestProfile.profile !== "balanced" && bestProfile.score - balancedScore > 0.15 ? bestProfile.profile : "balanced";
  const recentTrends = observedTrends(state, board, known, opponentRosters, asOf);
  if (!nextOwnOverall) warnings.push("No future own selection remains in the supplied 112-pick session.");
  if (nextOwnOverall !== null && secondOwnOverall === null) warnings.push("Only one own selection remains; the bounded next-pick comparison has no second own turn.");
  if (nextOwnOverall !== null && secondOwnOverall !== null && state.picks.length) warnings.push("Opponent next-pick cases are deterministic ADP, guard-demand and F/C-demand stress scenarios; they are not survival probabilities.");

  const result = {
    schemaVersion: 1 as const,
    leagueId: board.leagueId,
    teamId: board.teamId,
    boardRevision: board.revision,
    generatedAt: asOf.toISOString(),
    status,
    stateObservedAt: state.observedAt,
    ageSeconds: stateAgeSeconds,
    inputAgesHours,
    ownSelected: ownIds.length,
    nextOwnOverall,
    secondOwnOverall,
    ownTurn,
    selectedProfile,
    suggestedProfile,
    ownRoster: lineupOutput(owned, board),
    profiles,
    trends: {
      ...recentTrends,
      nextOwnPicks: { firstOverall: nextOwnOverall, secondOverall: secondOwnOverall },
      scenarios: scenarioLists[selectedProfile]
    },
    evaluation: {
      method: "equal-weight-eight-category-reference-z-on-best-legal-active-ten",
      categoryWeights: Object.fromEntries(CATEGORIES.map(category => [category, 1])),
      percentageMethod: "sum FGM / sum FGA and sum FTM / sum FTA over forecasted active players; never average player percentages",
      totalsScope: "forecasted active players only; unforecasted active players are counted in coverage, not assigned invented statistics",
      exposureIsConditionalOnPlaying: true,
      categoryCount: 8,
      profileComparisons: Object.fromEntries(PROFILE_NAMES.map(profile => [profile, profiles[profile].projectedRoster.evaluation]))
    },
    coverage: { ...board.counts, availableForecasted: available.length, unmodeledAvailable: board.excluded.filter(p => !unavailableIds.has(p.fantraxId)).length, statusBlocked: statusIds.size },
    readyForPlatformExecution: false as const,
    liveActionsExecuted: 0 as const,
    warnings
  };
  return result;
}

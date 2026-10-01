import { createHash } from "node:crypto";
import { join } from "node:path";
import type { LeagueSnapshot, Player, PlayerPosition } from "../models/types.js";
import { buildPriorsFromSnapshot, MODEL_POSITIONS, primaryModelPosition } from "../agents/snapshot-integration.js";
import { optimizeLineup } from "../agents/skills/lineup-optimizer.js";
import type { RosterSlotInput } from "../agents/types.js";
import { createModel, type ModelPosition, type PlayerModel } from "../probabilistic/bayesian-model.js";
import { JsonModelStore } from "../probabilistic/model-store.js";
import { getCurrentScoringPeriod } from "../seasons/nfl-calendar.js";

export interface RosterAnalyticsOptions {
  readonly period?: string;
  readonly samples?: number;
  readonly seed?: number;
  readonly dataDir?: string;
}

export interface Distribution {
  readonly samples: number;
  readonly mean: number;
  readonly median: number;
  readonly stdDev: number;
  readonly p10: number;
  readonly p90: number;
  readonly histogram: ReadonlyArray<{ readonly lower: number; readonly upper: number; readonly count: number }>;
}

export interface PlayerAnalytics {
  readonly playerId: string;
  readonly name: string;
  readonly position: PlayerPosition;
  readonly projectionCoverage: "projected" | "learned" | "uncovered";
  readonly distribution: Distribution | null;
}

export interface LineupAnalytics {
  readonly distribution: Distribution;
  readonly playerStarterProbability: Readonly<Record<string, number>>;
  readonly starters: ReadonlyArray<string>;
}

export interface LineupSetAnalytics {
  readonly current: LineupAnalytics;
  readonly optimized: LineupAnalytics;
}

export interface RosterAnalyticsResult {
  readonly metadata: {
    readonly snapshotId: string;
    readonly teamId: string;
    readonly period: string;
    readonly asOf: string;
    readonly modelVersion: string;
    readonly assumptions: ReadonlyArray<string>;
  };
  readonly roster: { readonly current: Distribution | null; readonly optimized: Distribution };
  readonly players: Readonly<Record<string, PlayerAnalytics>>;
  readonly lineups: LineupSetAnalytics;
  readonly freeAgents: {
    readonly coverage: { readonly total: number; readonly covered: number; readonly uncovered: number };
    readonly players: ReadonlyArray<PlayerAnalytics>;
    readonly blockers: ReadonlyArray<string>;
  };
}

export interface FreeAgentScenarioInput extends RosterAnalyticsOptions {
  readonly addPlayerId: string;
  readonly dropPlayerId?: string;
}

export interface FreeAgentScenarioResult {
  readonly metadata: RosterAnalyticsResult["metadata"];
  readonly baseline: Pick<RosterAnalyticsResult, "roster" | "lineups">;
  readonly scenario: Pick<RosterAnalyticsResult, "roster" | "lineups">;
  readonly delta: {
    readonly distribution: Distribution;
    readonly mean: number;
    readonly probabilityImproves: number;
  };
}

const DEFAULT_SAMPLES = 10_000;
const MODEL_VERSION = "bayesian-ewma-v1";
const ASSUMPTIONS = [
  "Player outcomes are modeled as independent normal distributions.",
  "Learned PlayerModels are used when available; otherwise matching scoring-period projections supply cold-start means and uncertainty.",
  "Optimized lineups are chosen from expected points and held fixed across samples; locked starters remain in their assigned slots.",
  "Free-agent scenarios model a hypothetical acquisition; waiver priority, FAAB cost, and transaction acceptance are not modeled.",
  "Players marked out, on bye, or injured reserve receive a zero-point outcome for the requested period."
] as const;

export async function buildRosterAnalytics(
  snapshot: LeagueSnapshot,
  teamId: string,
  options: RosterAnalyticsOptions = {}
): Promise<RosterAnalyticsResult> {
  const context = await buildContext(snapshot, teamId, options);
  const { draws, roster, faModels, currentStarterIds, optimizedLineup } = context;
  const playerAnalytics: Record<string, PlayerAnalytics> = {};
  for (const [playerId, name] of context.playerNames) {
    const model = context.playerModels.get(playerId);
    playerAnalytics[playerId] = {
      playerId,
      name,
      position: context.playerPositions.get(playerId) ?? "BN",
      projectionCoverage: context.coverage.get(playerId) ?? "uncovered",
      distribution: model ? summarize(draws.map((draw) => draw.get(playerId)!)) : null
    };
  }

  const rosterTotals = draws.map((draw) => sumPlayers(draw, roster.map((entry) => entry.playerId)));
  const currentTotals = draws.map((draw) => sumPlayers(draw, currentStarterIds));
  assertCompleteLineup(optimizedLineup, context.starterCounts, roster, teamId);
  const optimizedStarterIds = optimizedLineup.map((starter) => starter.playerId);
  const optimizedTotals = draws.map((draw) => sumPlayers(draw, optimizedStarterIds));
  const optimizedStarterCounts = new Map(optimizedStarterIds.map((id) => [id, draws.length]));

  const current = lineupAnalytics(currentTotals, currentStarterIds, new Map(currentStarterIds.map((id) => [id, draws.length])));
  const optimized = lineupAnalytics(optimizedTotals, optimizedStarterIds, optimizedStarterCounts, draws.length);
  const freeAgentPlayers = [...faModels.entries()].map(([playerId, model]) => ({
    playerId,
    name: context.playerNames.get(playerId) ?? playerId,
    position: context.playerPositions.get(playerId) ?? model.position,
    projectionCoverage: context.coverage.get(playerId) ?? "uncovered",
    distribution: summarize(draws.map((draw) => draw.get(playerId)!))
  } satisfies PlayerAnalytics));
  const uncoveredFreeAgents = snapshot.free_agents.length - freeAgentPlayers.length;

  return {
    metadata: context.metadata,
    roster: { current: roster.length === context.allRosterCount ? summarize(rosterTotals) : null, optimized: summarize(optimizedTotals) },
    players: playerAnalytics,
    lineups: { current, optimized },
    freeAgents: {
      coverage: { total: snapshot.free_agents.length, covered: freeAgentPlayers.length, uncovered: Math.max(0, uncoveredFreeAgents) },
      players: freeAgentPlayers,
      blockers: uncoveredFreeAgents > 0 ? [`${uncoveredFreeAgents} free agent(s) have no matching scoring-period projection or learned model and were excluded.`] : []
    }
  };
}

/** Evaluate an add/drop against the same seeded player outcomes as the baseline. */
export async function simulateFreeAgentScenario(
  snapshot: LeagueSnapshot,
  teamId: string,
  input: FreeAgentScenarioInput
): Promise<FreeAgentScenarioResult> {
  const context = await buildContext(snapshot, teamId, input);
  const fa = snapshot.free_agents.find((player) => player.player_id === input.addPlayerId);
  if (!fa) throw new Error(`Free agent ${input.addPlayerId} is not available in snapshot ${snapshot.snapshot_id}.`);
  const model = context.playerModels.get(fa.player_id);
  if (!model) throw new Error(`Free agent ${fa.player_id} is uncovered for scoring period ${context.metadata.period}; supply a matching projection or learned model.`);
  const dropId = input.dropPlayerId;
  const drop = dropId ? context.fullRoster.find((entry) => entry.playerId === dropId) : undefined;
  if (dropId && !drop) throw new Error(`Drop player ${dropId} is not on team ${teamId}'s active roster.`);
  if (drop?.locked) throw new Error(`Drop player ${dropId} is locked and cannot be removed in a free-agent scenario.`);
  const activeCapacity = context.starterCounts.reduce((sum, entry) => sum + entry.count, 0) + snapshot.league.roster_settings.bench_count;
  if (!dropId && context.fullRoster.length >= activeCapacity) {
    throw new Error(`Team ${teamId} has no active-roster capacity to add ${fa.player_id} without a drop.`);
  }

  const scenarioRoster = context.roster.filter((entry) => entry.playerId !== dropId);
  const addedPlayer = rosterEntryFor(fa, false);
  scenarioRoster.push(addedPlayer);
  const pairedDelta: number[] = [];
  const baselineRosterTotals: number[] = [];
  const scenarioRosterTotals: number[] = [];
  const baselineCurrentTotals: number[] = [];
  const scenarioCurrentTotals: number[] = [];
  const baselineOptimalTotals: number[] = [];
  const scenarioOptimalTotals: number[] = [];
  const baselineOptimalCounts = new Map<string, number>();
  const scenarioOptimalCounts = new Map<string, number>();
  const scenarioCurrentIds = context.currentStarterIds.filter((id) => id !== dropId);
  if (drop && context.currentStarterIds.includes(drop.playerId) &&
    addedPlayer.eligiblePositions?.some((position) => canPlay(position, drop.currentSlot ?? drop.slot))) {
    scenarioCurrentIds.push(fa.player_id);
  }

  const baselineExpected = optimizeLineup(context.roster, context.starterCounts, context.playerModels);
  const scenarioExpected = optimizeLineup(scenarioRoster, context.starterCounts, context.playerModels);
  assertCompleteLineup(scenarioExpected.starters, context.starterCounts, scenarioRoster, teamId);
  const baselineStarterIds = baselineExpected.starters.map((starter) => starter.playerId);
  const scenarioStarterIds = scenarioExpected.starters.map((starter) => starter.playerId);
  for (const draw of context.draws) {
    const baselineRoster = sumPlayers(draw, context.roster.map((entry) => entry.playerId));
    const newRoster = sumPlayers(draw, scenarioRoster.map((entry) => entry.playerId));
    baselineRosterTotals.push(baselineRoster);
    scenarioRosterTotals.push(newRoster);
    const baseLineupPoints = sumPlayers(draw, baselineStarterIds);
    const newLineupPoints = sumPlayers(draw, scenarioStarterIds);
    pairedDelta.push(newLineupPoints - baseLineupPoints);
    baselineCurrentTotals.push(sumPlayers(draw, context.currentStarterIds));
    scenarioCurrentTotals.push(sumPlayers(draw, scenarioCurrentIds));
    baselineOptimalTotals.push(baseLineupPoints);
    scenarioOptimalTotals.push(newLineupPoints);
    for (const starterId of baselineStarterIds) baselineOptimalCounts.set(starterId, context.draws.length);
    for (const starterId of scenarioStarterIds) scenarioOptimalCounts.set(starterId, context.draws.length);
  }

  const baseLineup = lineupAnalytics(baselineOptimalTotals, [...baselineOptimalCounts.keys()], baselineOptimalCounts, context.draws.length);
  const nextLineup = lineupAnalytics(scenarioOptimalTotals, [...scenarioOptimalCounts.keys()], scenarioOptimalCounts, context.draws.length);
  const mean = pairedDelta.reduce((sum, value) => sum + value, 0) / pairedDelta.length;
  return {
    metadata: context.metadata,
    baseline: {
      roster: { current: context.roster.length === context.allRosterCount ? summarize(baselineRosterTotals) : null, optimized: summarize(baselineOptimalTotals) },
      lineups: { current: lineupAnalytics(baselineCurrentTotals, context.currentStarterIds, new Map(context.currentStarterIds.map((id) => [id, context.draws.length]))), optimized: baseLineup }
    },
    scenario: {
      roster: { current: scenarioRoster.length === context.allRosterCount + (dropId ? 0 : 1) ? summarize(scenarioRosterTotals) : null, optimized: summarize(scenarioOptimalTotals) },
      lineups: {
        current: lineupAnalytics(scenarioCurrentTotals, scenarioCurrentIds, new Map(scenarioCurrentIds.map((id) => [id, context.draws.length]))),
        optimized: nextLineup
      }
    },
    delta: {
      distribution: summarize(pairedDelta),
      mean,
      probabilityImproves: pairedDelta.filter((value) => value > 0).length / pairedDelta.length
    }
  };
}

interface AnalyticsContext {
  readonly metadata: RosterAnalyticsResult["metadata"];
  readonly roster: RosterSlotInput[];
  readonly fullRoster: RosterSlotInput[];
  readonly starterCounts: Array<{ slot: PlayerPosition; count: number }>;
  readonly currentStarterIds: string[];
  readonly optimizedLineup: RosterSlotInput[];
  readonly playerModels: Map<string, PlayerModel>;
  readonly playerNames: Map<string, string>;
  readonly playerPositions: Map<string, PlayerPosition>;
  readonly coverage: Map<string, PlayerAnalytics["projectionCoverage"]>;
  readonly draws: Map<string, number>[];
  readonly faModels: Map<string, PlayerModel>;
  readonly allRosterCount: number;
}

async function buildContext(snapshot: LeagueSnapshot, teamId: string, options: RosterAnalyticsOptions): Promise<AnalyticsContext> {
  const team = snapshot.league.teams.find((candidate) => candidate.team_id === teamId);
  if (!team) throw new Error(`Team ${teamId} is not present in snapshot ${snapshot.snapshot_id}.`);
  const period = options.period ?? (snapshot.league.platform === "fixture"
    ? snapshot.league.schedule.find((matchup) => matchup.team_id === teamId)?.scoring_period
    : getCurrentScoringPeriod(new Date(), snapshot.league.season)) ?? `${snapshot.league.season}-ROS`;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  if (!Number.isInteger(samples) || samples < 1 || samples > 100_000) throw new Error("samples must be an integer from 1 through 100000.");
  const players = new Map([...snapshot.players, ...snapshot.free_agents].map((player) => [player.player_id, player]));
  const storeDir = options.dataDir ?? process.env.PMT_DATA_DIR ?? "data";
  const activeRoster = [...team.roster.starters, ...team.roster.bench].filter((slot) => !!slot.player_id);
  const fullRoster: RosterSlotInput[] = activeRoster.map((slot) => {
    const player = players.get(slot.player_id!);
    if (!player) throw new Error(`Roster player ${slot.player_id} is missing from snapshot player data.`);
    return rosterEntryFor(player, slot.locked, slot.slot_type);
  });
  const starterCounts = snapshot.league.roster_settings.slots.filter(({ slot }) => slot !== "BN" && slot !== "IR").map(({ slot, count }) => ({ slot, count }));
  const currentStarterIds = team.roster.starters.flatMap((slot) => slot.player_id ? [slot.player_id] : []);
  const projectionByPlayer = selectedProjections(snapshot, period);
  const repo = new (await import("../knowledge/sqlite-knowledge-repository.js")).SqliteKnowledgeRepository({ filePath: join(storeDir, "pmt.sqlite") });
  try {
    for (const projection of await repo.getProjections(period, snapshot.league.external_id)) {
      if (!players.has(projection.player_id)) continue;
      const existing = projectionByPlayer.get(projection.player_id);
      if (!existing || projection.confidence > existing.confidence ||
        (projection.confidence === existing.confidence && projection.updated_at > existing.updated_at)) projectionByPlayer.set(projection.player_id, projection);
    }
  } catch {
    // A read-only snapshot remains a complete input; the local projection store is optional.
  } finally {
    repo.close();
  }
  const analyticsSnapshot = { ...snapshot, projections: [...projectionByPlayer.values()] };
  const playerModels = await resolveRuntimeModels(analyticsSnapshot, storeDir, period);
  const coverage = new Map<string, PlayerAnalytics["projectionCoverage"]>();
  const playerNames = new Map<string, string>();
  const playerPositions = new Map<string, PlayerPosition>();
  const savedModels = await new JsonModelStore(join(storeDir, "models.json")).list();
  const savedByPlayer = new Map(savedModels.map((model) => [model.playerId, model]));
  for (const player of [...snapshot.players, ...snapshot.free_agents]) {
    const position = primaryModelPosition(player.positions);
    const saved = savedByPlayer.get(player.player_id);
    const learned = saved && saved.position === position && saved.weeksObserved > 0 && saved.mu >= 0 && saved.sigma > 0;
    let model = playerModels.get(player.player_id);
    if (!position) continue;
    const projection = projectionByPlayer.get(player.player_id);
    if (model && ["out", "bye", "injured_reserve"].includes(player.status)) {
      model = { ...model, mu: 0, sigma: 0 };
      playerModels.set(player.player_id, model);
    }
    playerNames.set(player.player_id, player.full_name);
    playerPositions.set(player.player_id, position ?? player.positions[0] ?? "BN");
    coverage.set(player.player_id, learned && model ? "learned" : projection && model ? "projected" : "uncovered");
  }
  for (const player of [...snapshot.players, ...snapshot.free_agents]) if (!coverage.has(player.player_id)) coverage.set(player.player_id, "uncovered");
  for (const player of [...snapshot.players, ...snapshot.free_agents]) {
    if (!playerNames.has(player.player_id)) playerNames.set(player.player_id, player.full_name);
    if (!playerPositions.has(player.player_id)) playerPositions.set(player.player_id, player.positions[0] ?? "BN");
  }
  for (const slot of team.roster.starters) {
    if (!slot.player_id) continue;
    if (!playerModels.has(slot.player_id)) {
      throw new Error(`Required starter ${slot.player_id} is uncovered for scoring period ${period}; supply a matching projection or learned model. Zero imputation is disabled.`);
    }
  }
  const faModels = new Map(snapshot.free_agents.flatMap((player) => {
    const model = playerModels.get(player.player_id);
    return model ? [[player.player_id, model] as const] : [];
  }));
  const priorsForRoster = new Map(fullRoster.map((slot) => [slot.playerId, playerModels.get(slot.playerId)]));
  const modeledRoster = fullRoster.filter((slot) => priorsForRoster.get(slot.playerId));
  const optimizedLineup = optimizeLineup(modeledRoster, starterCounts, playerModels).starters;
  assertCompleteLineup(optimizedLineup, starterCounts, modeledRoster, teamId);
  const seed = options.seed ?? defaultSeed(snapshot.snapshot_id, teamId, period);
  const rng = seededRandom(seed);
  const draws: Map<string, number>[] = [];
  for (let index = 0; index < samples; index += 1) {
    const draw = new Map<string, number>();
    for (const [playerId, model] of playerModels) draw.set(playerId, normalSample(rng, model.mu, model.sigma));
    draws.push(draw);
  }
  const asOf = [...snapshot.players, ...snapshot.free_agents, ...projectionByPlayer.values()]
    .map((record) => record.updated_at)
    .sort()
    .at(-1) ?? snapshot.league.import_metadata.imported_at;
  const hasLearned = [...playerModels.keys()].some((id) => savedByPlayer.get(id)?.weeksObserved);
  return {
    metadata: {
      snapshotId: snapshot.snapshot_id,
      teamId,
      period,
      asOf,
      modelVersion: hasLearned ? `${MODEL_VERSION}+persisted-models` : MODEL_VERSION,
      assumptions: [...ASSUMPTIONS, ...(hasLearned ? ["Persisted learned PlayerModels from the configured data directory are consumed when their player and position match."] : ["No persisted learned PlayerModels were available; this is a cold start."])]
    },
    roster: modeledRoster,
    fullRoster,
    allRosterCount: activeRoster.length,
    starterCounts,
    currentStarterIds,
    optimizedLineup,
    playerModels,
    playerNames,
    playerPositions,
    coverage,
    draws,
    faModels
  };
}

function rosterEntryFor(player: Player, locked = false, assignedSlot?: PlayerPosition): RosterSlotInput {
  const eligiblePositions = player.eligibility.eligible_slots?.length
    ? player.eligibility.eligible_slots.filter((position) => MODEL_POSITIONS.has(position as ModelPosition))
    : player.positions.filter((position) => MODEL_POSITIONS.has(position as ModelPosition));
  const position = primaryModelPosition(eligiblePositions) ?? primaryModelPosition(player.positions) ?? "BN";
  return {
    playerId: player.player_id,
    slot: assignedSlot && assignedSlot !== "BN" && assignedSlot !== "IR" ? assignedSlot : position,
    ...(assignedSlot ? { currentSlot: assignedSlot } : {}),
    eligiblePositions,
    ...(locked ? { locked: true } : {})
  };
}

function selectedProjections(snapshot: LeagueSnapshot, period: string) {
  const selected = new Map<string, LeagueSnapshot["projections"][number]>();
  for (const projection of snapshot.projections) {
    if (projection.scoring_period !== period) continue;
    const current = selected.get(projection.player_id);
    if (!current || projection.confidence > current.confidence ||
      (projection.confidence === current.confidence && projection.updated_at > current.updated_at)) selected.set(projection.player_id, projection);
  }
  return selected;
}

/** Resolve current weekly projection priors with persisted learned state. */
export async function resolveRuntimeModels(
  snapshot: LeagueSnapshot,
  dataDir = process.env.PMT_DATA_DIR ?? "data",
  period?: string
): Promise<Map<string, PlayerModel>> {
  const selectedPeriod = period ?? `${snapshot.league.season}-ROS`;
  const projections = selectedProjections(snapshot, selectedPeriod);
  const projectedSnapshot = { ...snapshot, projections: [...projections.values()] };
  const priors = buildPriorsFromSnapshot(projectedSnapshot);
  const priorByPlayer = new Map(priors.map((prior) => [prior.playerId, prior]));
  const saved = await new JsonModelStore(join(dataDir, "models.json")).list();
  const savedByPlayer = new Map(saved.map((model) => [model.playerId, model]));
  const resolved = new Map<string, PlayerModel>();
  for (const player of [...snapshot.players, ...snapshot.free_agents]) {
    const position = primaryModelPosition(player.positions);
    const previous = savedByPlayer.get(player.player_id);
    const prior = priorByPlayer.get(player.player_id);
    const projection = projections.get(player.player_id);
    if (!projection) continue;
    if (previous && previous.position === position && previous.weeksObserved > 0 && previous.mu >= 0 && previous.sigma > 0) {
      // Keep learned uncertainty and recurrence state, while anchoring the mean
      // to a source projection for the requested scoring period.
      resolved.set(player.player_id, { ...previous, historyMean: prior?.historyMean ?? projection.projected_points, mu: prior?.historyMean ?? projection.projected_points });
      continue;
    }
    if (!prior) continue;
    const model = createModel(prior);
    const sigma = Math.max(1, (projection.ceiling - projection.floor) / 2.563);
    resolved.set(player.player_id, { ...model, sigma });
  }
  return resolved;
}

function assertCompleteLineup(
  starters: ReadonlyArray<RosterSlotInput>,
  counts: ReadonlyArray<{ slot: PlayerPosition; count: number }>,
  roster: ReadonlyArray<RosterSlotInput>,
  teamId: string
): void {
  for (const required of counts) {
    const filled = starters.filter((starter) => starter.slot === required.slot).length;
    if (filled < required.count) {
      const able = roster.filter((candidate) => candidate.eligiblePositions?.some((position) => canPlay(position, required.slot))).length;
      throw new Error(`Cannot cover required ${required.slot} starters for team ${teamId}: need ${required.count}, can fill ${filled} (eligible roster players: ${able}).`);
    }
  }
}

function canPlay(position: PlayerPosition, slot: PlayerPosition): boolean {
  if (position === slot) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  return false;
}

function sampledPointModels(models: Map<string, PlayerModel>, draw: Map<string, number>): Map<string, PlayerModel> {
  return new Map([...models].map(([playerId, model]) => [playerId, { ...model, mu: draw.get(playerId) ?? model.mu }]));
}

function sumPlayers(draw: Map<string, number>, ids: ReadonlyArray<string>): number {
  return ids.reduce((sum, id) => sum + (draw.get(id) ?? 0), 0);
}

function lineupAnalytics(values: number[], starters: ReadonlyArray<string>, counts: Map<string, number>, totalSamples = values.length): LineupAnalytics {
  return {
    distribution: summarize(values),
    starters: [...starters],
    playerStarterProbability: Object.fromEntries([...counts].map(([id, count]) => [id, count / totalSamples]))
  };
}

function summarize(values: ReadonlyArray<number>): Distribution {
  if (!values.length) return { samples: 0, mean: 0, median: 0, stdDev: 0, p10: 0, p90: 0, histogram: [] };
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    samples: values.length,
    mean,
    median: quantile(sorted, 0.5),
    stdDev: Math.sqrt(variance),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    histogram: buildHistogram(sorted)
  };
}

function buildHistogram(sorted: ReadonlyArray<number>): Array<{ lower: number; upper: number; count: number }> {
  if (!sorted.length) return [];
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (min === max) return [{ lower: min, upper: max, count: sorted.length }];
  const bucketCount = Math.min(30, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    lower: min + width * index,
    upper: index === bucketCount - 1 ? max : min + width * (index + 1),
    count: 0
  }));
  for (const value of sorted) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    buckets[index]!.count += 1;
  }
  return buckets;
}

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const fraction = index - low;
  return sorted[low]! * (1 - fraction) + sorted[Math.min(low + 1, sorted.length - 1)]! * fraction;
}

function defaultSeed(snapshotId: string, teamId: string, period: string): number {
  return createHash("sha256").update(`${snapshotId}:${teamId}:${period}`).digest().readUInt32LE(0);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random: () => number, mean: number, sigma: number): number {
  const u1 = Math.max(Number.MIN_VALUE, random());
  const u2 = random();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeRepository } from "./knowledge/repository.js";
import { SqliteKnowledgeRepository } from "./knowledge/sqlite-knowledge-repository.js";
import type { LeagueSnapshot, Projection } from "./models/types.js";
import { buildProjectionSources } from "./projections/projection-source-registry.js";
import { matchProjectionsToRoster } from "./projections/projection-matching.js";
import { getCurrentScoringPeriod } from "./seasons/nfl-calendar.js";
import { buildPriorsFromSnapshot } from "./agents/snapshot-integration.js";
import { buildModelsForOrchestrator } from "./agents/ff-orchestrator.js";
import { JsonModelStore } from "./probabilistic/model-store.js";
import type { ProjectionCandidate, ProjectionSource } from "./projections/projection-source.js";

export interface SeasonRefreshOptions {
  readonly repository?: KnowledgeRepository;
  readonly dataDir?: string;
  readonly sources?: string;
  readonly season?: string;
  readonly week?: number;
  /** Bypass the 1h projection fetch cache. */
  readonly force?: boolean;
}

export interface SeasonRefreshSummary {
  readonly snapshotId: string;
  readonly season: string;
  readonly scoringPeriod: string;
  readonly sources: Record<string, number>;
  /** Sources that were unavailable and skipped, keyed by source name. */
  readonly skipped: Record<string, string>;
  readonly projectionsStored: number;
  readonly playersUpdated: number;
  readonly modelsRebuilt: number;
  readonly errors: string[];
}

/**
 * Refresh projections for an already-imported league WITHOUT re-importing it:
 * pull every configured source, match candidates to the roster, persist the
 * matched projections (the snapshot row itself stays immutable), then rebuild
 * the Bayesian model priors so the orchestrator sees fresh numbers.
 */
export async function runSeasonRefresh(options: SeasonRefreshOptions = {}): Promise<SeasonRefreshSummary> {
  const dataDir = options.dataDir ?? process.env.PMT_DATA_DIR ?? "data";
  const repository = options.repository ?? (await (async () => {
    await mkdir(dataDir, { recursive: true });
    return new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
  })());

  const pointer = await loadLastSnapshotPointer(dataDir);
  const snapshot = await repository.getLeagueSnapshot(pointer.snapshot_id);
  if (!snapshot) {
    throw new Error("Imported snapshot not found in the store. Run `pmt import-espn <leagueId>` first.");
  }

  const season = options.season ?? snapshot.league.season;
  const scoringPeriod = options.week
    ? `${season}-W${options.week}`
    : getCurrentScoringPeriod(new Date(), season);

  const sources = buildProjectionSources({
    sources: options.sources ?? process.env.PMT_PROJECTION_SOURCES,
    season,
    dataDir,
    force: options.force
  });
  const rosterPlayers = [...snapshot.players, ...snapshot.free_agents];

  const stored: Projection[] = [];
  const sourceBreakdown: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const candidates = await source.fetchProjections("football", season, scoringPeriod);
      if (source.lastSkipReason) {
        skipped[source.name] = source.lastSkipReason;
        continue;
      }
      const matched = matchProjectionsToRoster(candidates, rosterPlayers, scoringPeriod, source.name);
      stored.push(...matched);
      sourceBreakdown[source.name] = matched.length;
    } catch (cause) {
      errors.push(`${source.name}: ${(cause as Error).message}`);
    }
  }

  await repository.upsertProjections(stored, snapshot.league.league_id);

  // Re-read so the snapshot carries the freshly stored projections, then
  // rebuild priors/models from them.
  const refreshed = await repository.getLeagueSnapshot(pointer.snapshot_id);
  const priors = buildPriorsFromSnapshot(refreshed ?? snapshot);
  const models = buildModelsForOrchestrator(priors, []);
  const modelStore = new JsonModelStore(join(dataDir, "models.json"));
  await modelStore.saveAll([...models.values()]);

  const playerIds = new Set(stored.map((p) => p.player_id));

  return {
    snapshotId: pointer.snapshot_id,
    season,
    scoringPeriod,
    sources: sourceBreakdown,
    skipped,
    projectionsStored: stored.length,
    playersUpdated: playerIds.size,
    modelsRebuilt: models.size,
    errors
  };
}

/**
 * Persist the candidates from a single source (e.g. an ad-hoc `pmt projections`
 * pull) into the store, matched to the imported roster.
 */
export async function persistCandidates(
  repository: KnowledgeRepository,
  snapshot: LeagueSnapshot,
  source: ProjectionSource,
  candidates: ProjectionCandidate[],
  scoringPeriod: string,
  dataDir: string
): Promise<number> {
  const rosterPlayers = [...snapshot.players, ...snapshot.free_agents];
  const matched = matchProjectionsToRoster(candidates, rosterPlayers, scoringPeriod, source.name);
  await repository.upsertProjections(matched, snapshot.league.league_id);
  const modelStore = new JsonModelStore(join(dataDir, "models.json"));
  const priors = buildPriorsFromSnapshot(snapshot);
  const models = buildModelsForOrchestrator(priors, []);
  await modelStore.saveAll([...models.values()]);
  return matched.length;
}

export async function loadLastSnapshotPointer(dataDir: string): Promise<{ snapshot_id: string; league_id: string }> {
  try {
    const raw = await readFile(join(dataDir, "last-snapshot.json"), "utf8");
    return JSON.parse(raw) as { snapshot_id: string; league_id: string };
  } catch {
    throw new Error("No imported snapshot pointer found at data/last-snapshot.json. Run `pmt import-espn <leagueId>` first.");
  }
}

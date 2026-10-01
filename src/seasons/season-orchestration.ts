import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { SqliteKnowledgeRepository } from "../knowledge/sqlite-knowledge-repository.js";
import { ActionQueue } from "../agents/action-queue.js";
import { SqliteActionQueueStore } from "../agents/sqlite-action-queue-store.js";
import { buildOrchestratorInputFromSnapshot, buildPriorsFromSnapshot, buildSnapshotEnqueueOptions, mergeProjections } from "../agents/snapshot-integration.js";
import { buildModelsForOrchestrator, runOrchestrator } from "../agents/ff-orchestrator.js";
import { loadLastSnapshotPointer } from "../season-refresh.js";
import type { AddDropAction, ProposeTradeAction, QueuedAction, RosterSlotInput } from "../agents/types.js";
import { resolveRuntimeModels } from "../application/roster-analytics.js";
import { getCurrentScoringPeriod } from "./nfl-calendar.js";

export interface SeasonOrchestrationOptions {
  readonly repository?: KnowledgeRepository;
  readonly dataDir?: string;
  readonly teamId?: string;
  readonly queue?: ActionQueue;
  /**
   * Always false in the scheduled loop: every proposal waits for
   * `pmt action-approve`. Exposed only so tests can exercise the other path.
   */
  readonly autoApproveLowRisk?: boolean;
}

export interface SeasonOrchestrationSummary {
  readonly teamId: string;
  readonly leagueId: string;
  readonly starters: ReadonlyArray<RosterSlotInput>;
  readonly lineupExpectedPoints: number;
  readonly waiverCandidates: ReadonlyArray<AddDropAction>;
  readonly tradeCandidates: ReadonlyArray<ProposeTradeAction>;
  readonly queued: ReadonlyArray<QueuedAction>;
}

/**
 * Run the FF_Orchestrator against the latest imported snapshot (which already
 * carries the projections persisted by `season-refresh`). High-risk moves land
 * in the human-approval queue; nothing is executed here.
 */
export async function runSeasonOrchestration(
  options: SeasonOrchestrationOptions = {}
): Promise<SeasonOrchestrationSummary> {
  const dataDir = options.dataDir ?? process.env.PMT_DATA_DIR ?? "data";
  const repository = options.repository ?? (await (async () => {
    await mkdir(dataDir, { recursive: true });
    return new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.sqlite") });
  })());

  const pointer = await loadLastSnapshotPointer(dataDir);
  let snapshot = await repository.getLeagueSnapshot(pointer.snapshot_id);
  if (!snapshot) {
    throw new Error("Imported snapshot not found in the store. Run `pmt import-espn <leagueId>` first.");
  }

  const teamId = options.teamId ?? process.env.PMT_TEAM_ID ?? process.env.ESPN_TEAM_ID;
  if (!teamId) {
    throw new Error("Team ID is required; set PMT_TEAM_ID or pass teamId explicitly.");
  }

  const period = getCurrentScoringPeriod(new Date(), snapshot.league.season);
  snapshot = mergeProjections(snapshot, await repository.getProjections(period));
  const priors = buildPriorsFromSnapshot(snapshot);
  const models = await resolveRuntimeModels(snapshot, dataDir, period);
  const team = snapshot.league.teams.find((candidate) => candidate.team_id === teamId);
  for (const slot of team?.roster.starters ?? []) {
    if (slot.player_id && !models.has(slot.player_id)) {
      throw new Error(`Required starter ${slot.player_id} is uncovered for scoring period ${period}; supply a matching projection or learned model.`);
    }
  }
  const queue = options.queue ?? new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
  const input = buildOrchestratorInputFromSnapshot(snapshot, teamId, models);

  const result = await runOrchestrator({
    input,
    priors,
    models,
    enqueueOptions: buildSnapshotEnqueueOptions(snapshot, period),
    queue,
    autoApproveLowRisk: options.autoApproveLowRisk ?? false
  });

  return {
    teamId: result.teamId,
    leagueId: snapshot.league.league_id,
    starters: result.lineup,
    lineupExpectedPoints: result.lineupExpectedPoints,
    waiverCandidates: result.waiverCandidates,
    tradeCandidates: result.tradeCandidates,
    queued: result.queued
  };
}

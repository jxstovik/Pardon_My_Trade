import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { SqliteKnowledgeRepository } from "../knowledge/sqlite-knowledge-repository.js";
import { ActionQueue, JsonActionQueueStore } from "../agents/action-queue.js";
import { buildOrchestratorInputFromSnapshot, buildPriorsFromSnapshot } from "../agents/snapshot-integration.js";
import { buildModelsForOrchestrator, runOrchestrator } from "../agents/ff-orchestrator.js";
import { loadLastSnapshotPointer } from "../season-refresh.js";
import type { AddDropAction, ProposeTradeAction, QueuedAction, RosterSlotInput } from "../agents/types.js";

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
    return new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.db") });
  })());

  const pointer = await loadLastSnapshotPointer(dataDir);
  const snapshot = await repository.getLeagueSnapshot(pointer.snapshot_id);
  if (!snapshot) {
    throw new Error("Imported snapshot not found in the store. Run `pmt import-espn <leagueId>` first.");
  }

  const teamId = options.teamId ?? process.env.ESPN_TEAM_ID ?? snapshot.league.teams[0]?.team_id;
  if (!teamId) {
    throw new Error("Snapshot has no teams; cannot run the orchestrator.");
  }

  const priors = buildPriorsFromSnapshot(snapshot);
  const models = buildModelsForOrchestrator(priors, []);
  const queue = options.queue ?? new ActionQueue(new JsonActionQueueStore(join(dataDir, "action-queue.json")));
  const input = buildOrchestratorInputFromSnapshot(snapshot, teamId, models);

  const result = await runOrchestrator({
    input,
    priors,
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

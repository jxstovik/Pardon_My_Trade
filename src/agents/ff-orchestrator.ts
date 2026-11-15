import type { PlayerModel, ModelPrior, Observation } from "../probabilistic/bayesian-model.js";
import { buildModels, applyObservations } from "../probabilistic/model-engine.js";
import { optimizeLineup } from "./skills/lineup-optimizer.js";
import { scanWaivers } from "./skills/waiver-scanner.js";
import { proposeTrades } from "./skills/trade-proposer.js";
import { routeActions } from "./skills/execute-or-queue.js";
import type { ActionQueue } from "./action-queue.js";
import type { ActionEnqueueOptions, OrchestratorInput, OrchestratorResult, QueuedAction, AgentAction, WaiverClaimAction } from "./types.js";

export interface OrchestratorContext {
  /** Live acquisition classification; unavailable states must not become add/drop proposals. */
  readonly acquisitionStatus?: (playerId: string) => Promise<string | undefined>;
  readonly input: OrchestratorInput;
  readonly priors: ReadonlyArray<ModelPrior>;
  readonly observations?: ReadonlyArray<Observation>;
  /** Optional persisted learned state keyed by player ID. */
  readonly models?: ReadonlyMap<string, PlayerModel>;
  readonly enqueueOptions?: ActionEnqueueOptions;
  readonly queue: ActionQueue;
  readonly autoApproveLowRisk?: boolean;
  /** Maximum overall value rank protected from add/drop recommendations. */
  readonly doNotDropRankLimit?: number;
}

export function buildModelsForOrchestrator(
  priors: ReadonlyArray<ModelPrior>,
  observations: ReadonlyArray<Observation> = []
): Map<string, PlayerModel> {
  const models = buildModels(priors);
  return applyObservations(models, observations);
}

/**
 * Plan §1 `FF_Orchestrator`: fetch state -> build prob models -> evaluate
 * lineup -> waiver scan -> trade proposer -> execute or queue. Produces a
 * recommended lineup plus high-risk actions routed to the human-approval queue.
 */
export async function runOrchestrator(context: OrchestratorContext): Promise<OrchestratorResult> {
  const { input, queue, autoApproveLowRisk = false } = context;
  const models = context.models ? new Map(context.models) : buildModelsForOrchestrator(context.priors, context.observations);

  const lineup = optimizeLineup(input.rosterSlots, input.starterCounts, models);
  const setRoster: AgentAction = {
    type: "set_roster",
    teamId: input.teamId,
    starters: lineup.starters
  };

  const waiverCandidates = scanWaivers(input.freeAgents, input.rosterSlots, models, {
    doNotDropRankLimit: context.doNotDropRankLimit
  }).map((candidate) => ({
    ...candidate,
    teamId: input.teamId
  }));

  const waiverClaims: WaiverClaimAction[] = [];
  const immediateCandidates: typeof waiverCandidates = [];
  for (const candidate of waiverCandidates) {
    const status = context.acquisitionStatus ? await context.acquisitionStatus(candidate.addPlayerIds[0]) : "FREEAGENT";
    if (status === "WAIVERS") {
      waiverClaims.push({ type: "waiver_claim", teamId: input.teamId, addPlayerId: candidate.addPlayerIds[0], dropPlayerId: candidate.dropPlayerIds[0], priority: waiverClaims.length + 1 });
    } else if (status === "FREEAGENT") immediateCandidates.push(candidate);
  }

  const tradeCandidates = proposeTrades(
    input.teamId,
    input.rosterSlots,
    input.opponents ?? [],
    models
  );

  const routed = await routeActions(
    [
      { action: setRoster, rationale: "Optimal expected-points lineup for the scoring period." },
      ...immediateCandidates.map((c) => ({
        action: c as AgentAction,
        rationale: `Add ${c.addPlayerIds[0]} over ${c.dropPlayerIds[0]} by projected value.`
      })),
      ...waiverClaims.map(action => ({ action: action as AgentAction, rationale: `Waiver preference ${action.priority}: add ${action.addPlayerId}; conditional drop ${action.dropPlayerId}. Ranked by PMT position-adjusted projected value; individual approval required.` })),
      ...tradeCandidates.map((t) => ({
        action: t as AgentAction,
        rationale: `Propose +EV trade: give ${t.givePlayerIds.join(",")} for ${t.receivePlayerIds.join(",")}.`
      }))
    ],
    queue,
    autoApproveLowRisk,
    context.enqueueOptions
  );

  const queued: QueuedAction[] = routed.queued;
  const executed: AgentAction[] = routed.executed;

  return {
    teamId: input.teamId,
    lineup: lineup.starters,
    lineupExpectedPoints: lineup.expectedPoints,
    waiverCandidates: immediateCandidates,
    waiverClaims,
    tradeCandidates,
    queued,
    executed,
    executedAt: new Date().toISOString()
  };
}

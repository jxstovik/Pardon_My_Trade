import type { PlayerModel, ModelPrior, Observation } from "../probabilistic/bayesian-model.js";
import { buildModels, applyObservations } from "../probabilistic/model-engine.js";
import { optimizeLineup } from "./skills/lineup-optimizer.js";
import { scanWaivers } from "./skills/waiver-scanner.js";
import { proposeTrades } from "./skills/trade-proposer.js";
import { routeActions } from "./skills/execute-or-queue.js";
import type { ActionQueue } from "./action-queue.js";
import type { OrchestratorInput, OrchestratorResult, QueuedAction, AgentAction } from "./types.js";

export interface OrchestratorContext {
  readonly input: OrchestratorInput;
  readonly priors: ReadonlyArray<ModelPrior>;
  readonly observations?: ReadonlyArray<Observation>;
  readonly queue: ActionQueue;
  readonly autoApproveLowRisk?: boolean;
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
  const models = buildModelsForOrchestrator(context.priors, context.observations);

  const lineup = optimizeLineup(input.rosterSlots, input.starterCounts, models);
  const setRoster: AgentAction = {
    type: "set_roster",
    teamId: input.teamId,
    starters: lineup.starters
  };

  const waiverCandidates = scanWaivers(input.freeAgents, input.rosterSlots, models).map((candidate) => ({
    ...candidate,
    teamId: input.teamId
  }));

  const tradeCandidates = proposeTrades(
    input.teamId,
    input.rosterSlots,
    input.opponents ?? [],
    models
  );

  const routed = await routeActions(
    [
      { action: setRoster, rationale: "Optimal expected-points lineup for the scoring period." },
      ...waiverCandidates.map((c) => ({
        action: c as AgentAction,
        rationale: `Add ${c.addPlayerIds[0]} over ${c.dropPlayerIds[0]} by projected value.`
      })),
      ...tradeCandidates.map((t) => ({
        action: t as AgentAction,
        rationale: `Propose +EV trade: give ${t.givePlayerIds.join(",")} for ${t.receivePlayerIds.join(",")}.`
      }))
    ],
    queue,
    autoApproveLowRisk
  );

  const queued: QueuedAction[] = routed.queued;
  const executed: AgentAction[] = routed.executed;

  return {
    teamId: input.teamId,
    lineup: lineup.starters,
    lineupExpectedPoints: lineup.expectedPoints,
    waiverCandidates,
    tradeCandidates,
    queued,
    executed,
    executedAt: new Date().toISOString()
  };
}

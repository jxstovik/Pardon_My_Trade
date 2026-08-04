import type { ActionQueue } from "../action-queue.js";
import { classifyRisk } from "../action-queue.js";
import type { AgentAction, QueuedAction } from "../types.js";

export interface RoutedAction {
  readonly action: AgentAction;
  readonly rationale: string;
}

export interface RoutedResult {
  readonly queued: QueuedAction[];
  readonly executed: AgentAction[];
}

/**
 * Plan §3 `execute_or_queue`: low-risk actions (set roster) apply automatically
 * when auto-approval is enabled; everything else (add/drop, trades) is queued
 * for human approval via Discord/calendar (plan §1, §8).
 */
export async function routeActions(
  actions: ReadonlyArray<RoutedAction>,
  queue: ActionQueue,
  autoApproveLowRisk: boolean
): Promise<RoutedResult> {
  const queued: QueuedAction[] = [];
  const executed: AgentAction[] = [];

  for (const { action, rationale } of actions) {
    const risk = classifyRisk(action);
    if (risk === "low" && autoApproveLowRisk) {
      executed.push(action);
      continue;
    }
    queued.push(await queue.enqueue(action, risk, rationale));
  }
  return { queued, executed };
}

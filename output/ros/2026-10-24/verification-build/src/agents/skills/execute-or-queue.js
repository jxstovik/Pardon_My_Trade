import { classifyRisk } from "../action-queue.js";
/**
 * Plan §3 `execute_or_queue`: low-risk actions (set roster) apply automatically
 * when auto-approval is enabled; everything else (add/drop, trades) is queued
 * for human approval via Discord/calendar (plan §1, §8).
 */
export async function routeActions(actions, queue, autoApproveLowRisk, enqueueOptions) {
    const queued = [];
    const executed = [];
    for (const { action, rationale } of actions) {
        const risk = classifyRisk(action);
        if (risk === "low" && autoApproveLowRisk) {
            executed.push(action);
            continue;
        }
        queued.push(await queue.enqueue(action, risk, rationale, enqueueOptions ?? {}));
    }
    return { queued, executed };
}

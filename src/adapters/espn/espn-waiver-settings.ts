import type { WaiverSettings } from "../../models/types.js";

/** ESPN acquisitionSettings is authoritative; do not infer FAB from a default budget. */
export function parseEspnWaiverSettings(raw?: Record<string, unknown>, legacy?: Record<string, unknown>): WaiverSettings {
  if (!raw) {
    if (legacy?.type === "FA") return { type: "none" };
    // Legacy fixtures predate acquisitionSettings. Live preparation requires raw settings.
    return { type: "rolling" };
  }
  const acquisition = String(raw.acquisitionType ?? "");
  let type: WaiverSettings["type"];
  if (acquisition === "NONE" || acquisition === "FREEAGENT") type = "none";
  else if (raw.isUsingAcquisitionBudget === true) type = "faab";
  else if (acquisition === "WAIVERS_TRADITIONAL") type = "rolling";
  else throw new Error(`Unsupported ESPN acquisition system: ${acquisition}`);
  return {
    type, acquisition_type: acquisition,
    ...(type === "faab" && typeof raw.minimumBid === "number" ? { minimum_bid: raw.minimumBid } : {}),
    ...(type === "faab" && typeof raw.acquisitionBudget === "number" ? { budget: raw.acquisitionBudget } : {}),
    ...(typeof raw.waiverOrderReset === "boolean" ? { priority_reset: raw.waiverOrderReset ? "weekly_inverse_standings" as const : "never" as const } : {}),
    ...(typeof raw.waiverHours === "number" ? { waiver_hours: raw.waiverHours } : {}),
    ...(Array.isArray(raw.waiverProcessDays) && raw.waiverProcessDays.every(day => typeof day === "string") ? { process_days: raw.waiverProcessDays as string[] } : {}),
    ...(typeof raw.waiverProcessHour === "number" ? { process_hour: raw.waiverProcessHour } : {})
  };
}

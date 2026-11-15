import { z } from "zod";
import { DraftSessionSchema, type DraftSession } from "./draft.js";
import { instant } from "./contracts.js";

/** Browser evidence is explicit; a timestamp or source label alone never authorizes a write. */
export const DraftObservationSchema=z.object({
  schemaVersion:z.literal(1),sessionId:z.string().min(1).max(160),
  venue:z.enum(["local-mock","fantrax-mock","fantrax-league"]),
  pageUrl:z.url(),receivedAt:instant,sequence:z.number().int().positive(),
  completeHistory:z.boolean(),identityVerified:z.boolean(),
  currentTeamId:z.string().nullable(),clockSeconds:z.number().finite().nonnegative().max(86400).nullable(),
  correction:z.boolean().default(false),session:DraftSessionSchema
}).strict();
export type DraftObservation=z.infer<typeof DraftObservationSchema>;
export interface CopilotState {
  revision:string;
  observation:DraftObservation;
  session:DraftSession;
  status:"ready"|"blocked"|"stale";
  paused:boolean;
  issues:string[];
}
export interface MockPickIntent {
  sessionId:string;
  stateRevision:string;
  overall:number;
  playerId:string;
  teamId:string;
  slot:"G"|"F/C"|"Flx"|"Res";
  expiresAt:string;
}

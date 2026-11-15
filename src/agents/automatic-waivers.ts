import {optimizeLineup} from "./skills/lineup-optimizer.js";
import type {PlayerModel} from "../probabilistic/bayesian-model.js";
import {createLineupProbabilityEvaluator, validDistribution, type HorizonPlayer, type HandcuffScenario, type StackCorrelation, type LineupProbability, type ProbabilitySummary} from "./waiver-lineup-probability.js";
export type { HorizonPlayer } from "./waiver-lineup-probability.js";
import type { RosterSlotInput, WaiverClaimAction } from "./types.js";
import type { PlayerPosition } from "../models/types.js";
import { buildDoNotDropList } from "../decisions/do-not-drop.js";
import { DEFAULT_SCARCITY } from "../probabilistic/model-engine.js";

export interface AutomaticWaiverPolicy {
  enabled: boolean; leagueId: string; teamId: string; season: number;
  model: string; reasoningEffort: string; nearTermWeeks: number;
  suggestedNearTermLineupGain: number; suggestedSeasonLineupGain: number;
  simulations: number;
  maxClaims: number; protectTopRank: number; maxArtifactAgeHours: number;
  authority: string;
}
export interface TrainingManifest {
  season: number; targetWeek: number; cutoffWeek: number; builtAt: string; modelVersion: string;
  validation: Record<string, {final_training_rows?: number; final_training_end?: number}>;
  completedOutcomeCoverage: {cutoffWeek: number; gameIds?: string[]; completedGames: number; maxObservedWeek: number};
}
export function assertFreshWaiverTraining(manifest: TrainingManifest, week: number, gameIds: string[], at: Date, policy: AutomaticWaiverPolicy) {
  const efforts = ["medium", "high", "xhigh", "max", "ultra"];
  if (!["gpt-6.1-sol", "gpt-6-astra"].includes(policy.model) || !efforts.includes(policy.reasoningEffort)) throw new Error("Automatic waiver policy requires Sol 6.1 medium or an explicitly supported stronger model.");
  const age = at.getTime() - Date.parse(manifest.builtAt);
  if (!policy.enabled || policy.leagueId !== "98806880" || policy.teamId !== "7" || policy.season !== 2026) throw new Error("Automatic waiver authority/scope unavailable.");
  if (manifest.season !== policy.season || manifest.targetWeek !== week || manifest.cutoffWeek !== week - 1 || !manifest.modelVersion || !Number.isFinite(age) || age < 0 || age > policy.maxArtifactAgeHours * 3600000) throw new Error("Metamodel training is stale or targets a different week.");
  const coverage = manifest.completedOutcomeCoverage;
  if (!gameIds.length || new Set(gameIds).size !== gameIds.length || coverage?.cutoffWeek !== week - 1 || coverage.maxObservedWeek !== week - 1 || coverage.completedGames !== gameIds.length || !coverage.gameIds || coverage.gameIds.length !== gameIds.length || new Set(coverage.gameIds).size !== gameIds.length || gameIds.some(id => !coverage.gameIds!.includes(id))) throw new Error("Training does not prove every completed published game was included.");
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"]) {
    const fit = manifest.validation?.[pos];
    if (!fit || !Number.isInteger(fit.final_training_rows) || fit.final_training_rows! < 1 || fit.final_training_end !== policy.season) throw new Error(`Missing current-season fitted model: ${pos}`);
  }
}

export interface AutomaticWaiverInput {
  policy: AutomaticWaiverPolicy; targetWeek: number; seasonEndWeek?: number; roster: RosterSlotInput[];
  starterCounts: Array<{slot: PlayerPosition; count: number}>; forecasts: HorizonPlayer[];
  /** Only currently confirmed WAIVERS and healthy, legal, unowned candidates. */
  waiverPlayerIds: string[];
  protectedPlayerIds?: string[];
  /** User permits replacing a redundant TE only if another owned TE dominates
   * its current-week and remaining-season model value. Never overrides locks
   * or explicit missing-data/injury protections. */
  allowRedundantTightEndReplacement?: boolean;
  handcuffs?: HandcuffScenario[]; correlations?: StackCorrelation[]; opponentRoster?: RosterSlotInput[];
}
export interface AutomaticWaiverChoice {
  action: WaiverClaimAction; nearTermGain: number; seasonGain: number;
  weeklyGains: Array<{week: number; gain: number}>;
  probability: LineupProbability; strategy: "lineup_upgrade" | "rb_handcuff" | "qb_wr_stack" | "stream_defense" | "stream_kicker";
  suggestions: {nearTermMet: boolean; seasonMet: boolean};
  rationale: string;
}

/** Greedy marginal legal-lineup gains, recalculated after each selected acquisition. */
export function selectAutomaticWaivers(input: AutomaticWaiverInput): AutomaticWaiverChoice[] {
  const {policy, targetWeek, starterCounts} = input;
  if (!Number.isInteger(targetWeek) || targetWeek < 2 || targetWeek > 18 || !starterCounts.length || starterCounts.some(s => !Number.isInteger(s.count) || s.count < 1)) throw new Error("Invalid waiver horizon/lineup slots.");
  if (!Number.isInteger(policy.maxClaims) || policy.maxClaims < 1 || policy.maxClaims > 5 || !Number.isFinite(policy.suggestedNearTermLineupGain) || !Number.isFinite(policy.suggestedSeasonLineupGain) || policy.protectTopRank < 100 || policy.nearTermWeeks !== 3) throw new Error("Invalid automatic waiver policy.");
  const forecasts = new Map(input.forecasts.map(p => [p.playerId, p]));
  if (forecasts.size !== input.forecasts.length) throw new Error("Duplicate forecast player identities.");
  const seasonEndWeek = input.seasonEndWeek ?? 18;
  if (!Number.isInteger(seasonEndWeek) || seasonEndWeek < targetWeek || seasonEndWeek > 18) throw new Error("Invalid fantasy season end week.");
  const weeks = Array.from({length:seasonEndWeek+1-targetWeek}, (_,i)=>targetWeek+i);
  for (const p of input.forecasts) {
    if (p.weeks.length !== weeks.length || new Set(p.weeks.map(w=>w.week)).size !== weeks.length || p.weeks.some(w=>!weeks.includes(w.week) || !validDistribution(w))) throw new Error(`Incomplete season horizon: ${p.playerId}`);
  }
  if (new Set(input.roster.map(p=>p.playerId)).size !== input.roster.length || input.roster.some(p=>!forecasts.has(p.playerId))) throw new Error("Owned roster forecast coverage missing or duplicated.");
  const protectedIds = buildDoNotDropList(input.roster.map(p=>p.playerId), input.forecasts.map(p=>({playerId:p.playerId,value:p.weeks.reduce((sum,w)=>sum+w.mean,0) * (DEFAULT_SCARCITY[p.position as keyof typeof DEFAULT_SCARCITY] ?? 1)})), policy.protectTopRank);
  for (const id of input.protectedPlayerIds ?? []) protectedIds.add(id);
  if(input.allowRedundantTightEndReplacement){
    const tightEnds=input.roster.filter(p=>forecasts.get(p.playerId)?.position==="TE");
    const value=(id:string)=>forecasts.get(id)!.weeks.reduce((n,w)=>n+w.mean,0);
    for(const p of tightEnds){
      if(p.locked||(input.protectedPlayerIds??[]).includes(p.playerId))continue;
      const own=forecasts.get(p.playerId)!;
      if(tightEnds.some(other=>other.playerId!==p.playerId&&forecasts.get(other.playerId)!.weeks[0]!.mean>=own.weeks[0]!.mean&&value(other.playerId)>value(p.playerId)))protectedIds.delete(p.playerId);
    }
  }
  const legal=(roster:RosterSlotInput[])=>optimizeLineup(roster,starterCounts,new Map(roster.map(p=>[p.playerId,{mu:forecasts.get(p.playerId)!.weeks[0]!.mean} as PlayerModel]))).starters.length===starterCounts.reduce((sum,s)=>sum+s.count,0);
  if(!legal(input.roster))throw new Error("Incomplete legal lineup prevents automatic evaluation.");
  const probability = createLineupProbabilityEvaluator({forecasts:input.forecasts,weeks,starterCounts,nearTermWeeks:policy.nearTermWeeks,simulations:policy.simulations,handcuffs:input.handcuffs,correlations:input.correlations,opponentRoster:input.opponentRoster});
  const supported = (p:ProbabilitySummary)=>p.expectedGain>1e-8&&p.favorableMarginLowerBound>0;
  function strategyFor(p:LineupProbability,position:PlayerPosition):AutomaticWaiverChoice["strategy"]|undefined {
    if(position==="DST"||position==="K")return supported(p.nextWeek)&&p.probabilityAddedPlayerStartsNextWeek>0?(position==="DST"?"stream_defense":"stream_kicker"):undefined;
    if(!p.probabilityAddedPlayerStarts)return undefined;
    if(p.handcuffLeaders.length&&(supported(p.nearTerm)||supported(p.season)))return "rb_handcuff";
    if(p.stackQbIds.length&&p.probabilityAddedPlayerStartsNextWeek>0&&(p.matchupWinGainLowerBound??0)>0)return "qb_wr_stack";
    return supported(p.nearTerm)||supported(p.season)?"lineup_upgrade":undefined;
  }
  let current = [...input.roster];
  const chosen: AutomaticWaiverChoice[] = [];
  const usedAdds = new Set<string>();
  for (let index=0; index<policy.maxClaims; index++) {
    const alternatives: AutomaticWaiverChoice[] = [];
    for (const addId of input.waiverPlayerIds) {
      const add = forecasts.get(addId);
      if (!add || usedAdds.has(addId) || current.some(p=>p.playerId===addId)) continue;
      // Disjoint conditional drops: every subset of claims must remain roster-legal.
      for (const drop of current.filter(p=>!p.locked && !usedAdds.has(p.playerId))) {
        const specialist=add.position==="DST"||add.position==="K";
        const dropPosition=forecasts.get(drop.playerId)!.position;
        // Explicit streaming policy: rotate that starting specialist slot, never sacrifice offense for a second specialist.
        if(specialist&&(dropPosition!==add.position||(input.protectedPlayerIds??[]).includes(drop.playerId)))continue;
        if(!specialist&&protectedIds.has(drop.playerId))continue;
        const next = current.filter(p=>p.playerId!==drop.playerId).concat({playerId:addId,slot:add.position,eligiblePositions:[add.position]});
        if(!legal(next))continue;
        const measured=probability(current,next,addId);
        const strategy=strategyFor(measured,add.position);
        if(!strategy)continue;
        if(chosen.length) {
          const standalone=input.roster.filter(p=>p.playerId!==drop.playerId).concat({playerId:addId,slot:add.position,eligiblePositions:[add.position]});
          if(!strategyFor(probability(input.roster,standalone,addId),add.position))continue;
        }
        const nearTermGain=measured.nearTerm.expectedGain,seasonGain=measured.season.expectedGain;
        alternatives.push({action:{type:"waiver_claim",teamId:policy.teamId,addPlayerId:addId,dropPlayerId:drop.playerId,priority:index+1},nearTermGain,seasonGain,weeklyGains:measured.weeklyGains,probability:measured,strategy,
          suggestions:{nearTermMet:nearTermGain>=policy.suggestedNearTermLineupGain,seasonMet:seasonGain>=policy.suggestedSeasonLineupGain},
          rationale:`${strategy}: pregame-selected lineup, P(improve)/P(worsen) next week ${measured.nextWeek.improves.toFixed(3)}/${measured.nextWeek.worsens.toFixed(3)}, next three ${measured.nearTerm.improves.toFixed(3)}/${measured.nearTerm.worsens.toFixed(3)}; expected gains ${nearTermGain.toFixed(2)} near / ${seasonGain.toFixed(2)} season. Six/twenty point suggestions do not gate a claim.`});
      }
    }
    const objective=(c:AutomaticWaiverChoice)=>c.strategy.startsWith("stream_")?c.probability.nextWeek:c.probability.nearTerm.expectedGain>0?c.probability.nearTerm:c.probability.season;
    alternatives.sort((a,b)=>(objective(b).improves-objective(b).worsens)-(objective(a).improves-objective(a).worsens) || (b.probability.matchupWinProbabilityChange??0)-(a.probability.matchupWinProbabilityChange??0) || objective(b).expectedGain-objective(a).expectedGain || Number(b.suggestions.nearTermMet)+Number(b.suggestions.seasonMet)-Number(a.suggestions.nearTermMet)-Number(a.suggestions.seasonMet) || a.action.addPlayerId.localeCompare(b.action.addPlayerId) || a.action.dropPlayerId!.localeCompare(b.action.dropPlayerId!));
    if (!alternatives.length) break;
    const best=alternatives[0]!;chosen.push(best);usedAdds.add(best.action.addPlayerId);
    const add=forecasts.get(best.action.addPlayerId)!;
    current=current.filter(p=>p.playerId!==best.action.dropPlayerId).concat({playerId:add.playerId,slot:add.position,eligiblePositions:[add.position]});
  }
  return chosen;
}

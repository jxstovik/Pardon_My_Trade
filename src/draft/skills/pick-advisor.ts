import { createDefaultConfig } from "../../config/app-config.js";
import type { Evidence, LeagueSnapshot, Recommendation, RiskLevel } from "../../models/types.js";
import type { DraftNeed, DraftState } from "../state.js";
import { nextOverallPick, picksUntilMyNext, rosterNeeds } from "../state.js";
import type { ValuationModel } from "../valuation/valuation.js";
import { applySurvival, rankBestAvailable } from "../valuation/valuation.js";

export interface PickAdvice {
  readonly recommendation: Recommendation;
  readonly bestAvailable: ValuationModel[];
  readonly needs: DraftNeed[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildPickAdvice(
  state: DraftState,
  snapshot: LeagueSnapshot,
  valuation: ReadonlyMap<string, ValuationModel>,
  options?: { limit?: number; useProjections?: boolean }
): PickAdvice {
  const limit = options?.limit ?? 10;
  const excludeIds = state.draftedPlayerIds;
  const ranked = rankBestAvailable(valuation.values(), excludeIds, limit);
  const needs = rosterNeeds(state, snapshot);

  const config = createDefaultConfig();
  const generatedAt = new Date().toISOString();
  const expiration = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const pickNo = nextOverallPick(state);
  const untilNext = picksUntilMyNext(state);
  const top = ranked[0] as ValuationModel | undefined;
  const topNeed = needs.find((need) => need.remaining > 0);

  const reasoning: string[] = [];
  let prose: string;

  if (top) {
    const points = round(top.expectedPoints, 1);
    prose = topNeed
      ? `Take ${top.playerName} (${top.position}) — projected ${points} pts; your biggest gap is ${topNeed.slot}.`
      : `Take ${top.playerName} (${top.position}) — projected ${points} pts; every starting slot is already covered.`;
    reasoning.push(
      `${top.playerName} leads the board with value ${round(top.value, 2)} and ${points} projected points.`
    );
    reasoning.push(
      topNeed
        ? `Your next roster need is ${topNeed.slot} (${topNeed.remaining} of ${topNeed.required} starting slots open).`
        : "No starting slot is unfilled, so this pick is pure value accumulation."
    );
    const survival = round(applySurvival([top], untilNext)[0].survival, 2);
    reasoning.push(
      `${top.playerName} has a ${survival} chance of surviving the ${untilNext} pick(s) until you are back on the clock.`
    );
  } else {
    prose = `No available players remain in the valuation model at pick ${pickNo}.`;
    reasoning.push("The valuation model returned no undrafted players.");
    reasoning.push(
      topNeed ? `Your next roster need is ${topNeed.slot}.` : "No starting slot is unfilled."
    );
    reasoning.push(`You are back on the clock in ${untilNext} pick(s).`);
  }

  const topThree = ranked.slice(0, 3);
  const evidence: Evidence[] = [
    {
      evidence_id: `ev-draft-pick-${state.config.myTeamId}-${pickNo}`,
      source: "probabilistic-engine",
      source_type: "valuation",
      observed_at: generatedAt,
      claim:
        topThree.length > 0
          ? `Top available: ${topThree
              .map((m) => `${m.playerName} (${m.position}) value ${round(m.value, 2)}, ${round(m.expectedPoints, 1)} pts`)
              .join("; ")}`
          : "No available players in the valuation model.",
      value: topThree.map((m) => ({
        player_id: m.playerId,
        value: round(m.value, 2),
        expected_points: round(m.expectedPoints, 1)
      })),
      confidence: 0.7
    }
  ];

  const recommendation: Recommendation = {
    schema_version: "1.0.0",
    created_at: generatedAt,
    updated_at: generatedAt,
    source_system: `draft-pick-advisor@${config.configVersion}`,
    recommendation_id: `draft-pick-${state.config.myTeamId}-${pickNo}`,
    league_id: snapshot.league.league_id,
    team_id: state.config.myTeamId,
    type: "draft_pick",
    title: `Best available at pick ${pickNo}`,
    recommendation: prose,
    reasoning,
    evidence,
    confidence: 0.7,
    risk: { level: "low" as RiskLevel, factors: ["advisory only — you make the pick"] },
    expected_benefit: {
      metric: "expected_points",
      value: top?.expectedPoints ?? 0,
      range: [top?.probabilities[8] ?? 0, top?.probabilities[18] ?? 0]
    },
    assumptions: ["projections used as pre-season priors", "snake draft order assumed"],
    alternatives: ranked.slice(1, 3).map((m) => m.playerName),
    generated_at: generatedAt,
    expiration,
    status: "ready"
  };

  return { recommendation, bestAvailable: ranked, needs };
}

export function buildDraftChatContext(
  snapshot: LeagueSnapshot,
  state: DraftState,
  bestAvailable: readonly ValuationModel[],
  needs: readonly DraftNeed[]
): string {
  const lines: string[] = [];
  lines.push(`League: ${snapshot.league.name} (${snapshot.league.season}, ${state.config.teams} teams)`);
  lines.push(`My team: ${state.config.myTeamId} — draft seat ${state.config.draftPosition}`);
  lines.push(`Next overall pick: ${nextOverallPick(state)}`);
  lines.push(`Picks until my next selection: ${picksUntilMyNext(state)}`);
  lines.push(`Picks recorded so far: ${state.board.length}`);

  lines.push("Best available (name | position | projected points | value | tier):");
  if (bestAvailable.length === 0) {
    lines.push("- none");
  } else {
    for (const model of bestAvailable.slice(0, 5)) {
      lines.push(
        `- ${model.playerName} | ${model.position} | ${round(model.expectedPoints, 1)} | ${round(model.value, 2)} | tier ${model.tier}`
      );
    }
  }

  lines.push("Roster needs (slot | remaining of required):");
  if (needs.length === 0) {
    lines.push("- none");
  } else {
    for (const need of needs) {
      lines.push(`- ${need.slot} | ${need.remaining} of ${need.required}`);
    }
  }

  return lines.join("\n");
}

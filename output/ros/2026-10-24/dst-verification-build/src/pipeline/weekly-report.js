import { PmtError } from "../errors.js";
import { ingestFixtureSnapshot } from "../knowledge/ingestion.js";
import { InMemoryKnowledgeRepository } from "../knowledge/in-memory-knowledge-repository.js";
import { DefaultDecisionEngine } from "../decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "../recommendations/recommendation-engine.js";
import { ScoringRuleEngine } from "../rules/rule-engine.js";
export async function runWeeklyReport(fixturePath, leagueExternalId, teamExternalId, options = {}) {
    const repository = options.repository ?? new InMemoryKnowledgeRepository();
    const ruleEngine = options.ruleEngine ?? new ScoringRuleEngine();
    const decisionEngine = options.decisionEngine ?? new DefaultDecisionEngine(ruleEngine);
    const recommendationEngine = options.recommendationEngine ?? new DefaultRecommendationEngine(ruleEngine, { clock: options.clock });
    const snapshot = await ingestFixtureSnapshot(fixturePath, repository);
    const team = snapshot.league.teams.find((candidate) => candidate.external_id === teamExternalId);
    if (!team) {
        throw new PmtError({
            code: "TEAM_NOT_FOUND",
            message: `Team ${teamExternalId} was not found in the ingested snapshot.`,
            source: "recommendation_engine",
            retryable: false
        });
    }
    const evaluation = ruleEngine.validateLineup(snapshot.league, team.roster);
    const inputs = decisionEngine.generateWeeklyReportInputs(snapshot, team);
    const report = recommendationEngine.generateWeeklyReport(inputs);
    await repository.saveRecommendation(report);
    return {
        snapshot,
        team,
        lineupEvaluationValid: evaluation.valid,
        inputs,
        report
    };
}

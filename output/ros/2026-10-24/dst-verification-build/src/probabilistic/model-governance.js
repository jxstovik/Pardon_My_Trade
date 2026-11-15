import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validationError } from "../errors.js";
import { updateModel } from "./bayesian-model.js";
import { evaluatePredictions } from "../projections/performance.js";
const DEFAULT_MODEL_SOURCE = "bayesian-ewma";
const DEFAULT_MODEL_VERSION = "bayesian-ewma-v1";
const MANIFEST_VERSION = "model-governance-v1";
const DECISION_VERSION = "promotion-decision-v1";
/** File-backed artifact writer for the versioned manifest and rollback snapshot. */
export class JsonModelGovernanceArtifactStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    async write(manifest, previousModels) {
        await mkdir(this.directory, { recursive: true });
        await writeJson(join(this.directory, "manifest.json"), manifest);
        await writeJson(join(this.directory, "promotion-decision.json"), manifest.promotion_decision);
        await writeJson(join(this.directory, "rollback-models.json"), {
            schema_version: "1.0.0",
            rollback_id: manifest.rollback.rollback_id,
            models: [...previousModels].sort((left, right) => left.playerId.localeCompare(right.playerId))
        });
    }
}
/**
 * Applies one causal weekly label batch to already-built models.
 *
 * Predictions are scored before the recurrence is applied. This prevents the
 * just-arrived outcome from becoming the prediction it is evaluated against.
 */
export class PostWeekOutcomeUpdateService {
    modelStore;
    artifactStore;
    constructor(modelStore, options = {}) {
        this.modelStore = modelStore;
        if (options.artifactStore && options.artifactDir) {
            throw validationError("Provide artifactStore or artifactDir, not both.");
        }
        this.artifactStore = options.artifactStore ?? (options.artifactDir
            ? new JsonModelGovernanceArtifactStore(options.artifactDir)
            : undefined);
    }
    async update(request) {
        const normalized = validateRequest(request);
        const previousModels = [...await this.modelStore.list()].sort((left, right) => left.playerId.localeCompare(right.playerId));
        const models = new Map(previousModels.map((model) => [model.playerId, model]));
        const predictionRows = [];
        const nextModels = new Map(models);
        const updatedPlayerIds = [];
        for (const outcome of normalized.observations) {
            const current = models.get(outcome.playerId);
            if (!current)
                throw validationError(`No existing PlayerModel for ${outcome.playerId}.`);
            assertModelCanAdvance(current, normalized.season, normalized.week);
            const seenSources = new Set();
            for (const prediction of outcome.predictions ?? []) {
                if (seenSources.has(prediction.source)) {
                    throw validationError(`Duplicate source prediction for ${outcome.playerId}: ${prediction.source}.`);
                }
                seenSources.add(prediction.source);
                predictionRows.push({
                    playerId: outcome.playerId,
                    scoringPeriod: normalized.weeklyScoringPeriod,
                    source: prediction.source,
                    predicted: prediction.predicted,
                    actual: outcome.points
                });
            }
            // The forecast is the pre-update model mean. A supplied row with the same
            // source is authoritative, which permits replaying an archived forecast.
            if (!seenSources.has(normalized.modelSource)) {
                predictionRows.push({
                    playerId: outcome.playerId,
                    scoringPeriod: normalized.weeklyScoringPeriod,
                    source: normalized.modelSource,
                    predicted: current.mu,
                    actual: outcome.points
                });
            }
            const observation = {
                playerId: outcome.playerId,
                week: normalized.week,
                points: outcome.points,
                scoringPeriod: normalized.weeklyScoringPeriod
            };
            nextModels.set(outcome.playerId, updateModel(current, observation));
            updatedPlayerIds.push(outcome.playerId);
        }
        const updatedModels = [...nextModels.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
        const performance = evaluatePredictions(predictionRows).sort((left, right) => left.rmse - right.rmse || left.source.localeCompare(right.source));
        const decision = buildPromotionDecision(normalized, performance);
        const rollback = buildRollbackMetadata(previousModels, updatedModels, updatedPlayerIds, this.artifactStore !== undefined);
        const manifestWithoutId = {
            schema_version: "1.0.0",
            manifest_version: MANIFEST_VERSION,
            created_at: normalized.generatedAt,
            season: normalized.season,
            weekly_scoring_period: normalized.weeklyScoringPeriod,
            causal_cutoff: normalized.causalCutoff,
            model_version: normalized.modelVersion,
            model_source: normalized.modelSource,
            observed_player_ids: [...updatedPlayerIds].sort(),
            performance,
            promotion_decision: decision,
            rollback
        };
        const manifest = {
            ...manifestWithoutId,
            manifest_id: `manifest-${sha256(manifestWithoutId).slice(0, 16)}`
        };
        await this.modelStore.saveAll(updatedPlayerIds.map((playerId) => nextModels.get(playerId)));
        if (this.artifactStore)
            await this.artifactStore.write(manifest, previousModels);
        return { updatedModels, performance, decision, manifest };
    }
}
export async function updatePostWeekOutcomes(modelStore, request, options = {}) {
    return new PostWeekOutcomeUpdateService(modelStore, options).update(request);
}
function validateRequest(request) {
    const season = nonEmpty(request.season, "season");
    if (!Number.isInteger(request.week) || request.week < 1 || request.week > 18) {
        throw validationError("week must be an integer from 1 through 18.");
    }
    const causalCutoff = validTimestamp(request.causalCutoff, "causalCutoff");
    const generatedAt = validTimestamp(request.generatedAt ?? request.causalCutoff, "generatedAt");
    if (!request.observations.length)
        throw validationError("At least one completed weekly observation is required.");
    const weeklyScoringPeriod = weeklyPeriod(season, request.week);
    const observations = [...request.observations]
        .sort((left, right) => left.playerId.localeCompare(right.playerId));
    const playerIds = new Set();
    for (const observation of observations) {
        nonEmpty(observation.playerId, "observation.playerId");
        if (playerIds.has(observation.playerId)) {
            throw validationError(`Duplicate weekly observation for ${observation.playerId}.`);
        }
        playerIds.add(observation.playerId);
        if (!Number.isInteger(observation.week) || observation.week !== request.week) {
            throw validationError(`Observation week must be ${request.week}.`);
        }
        if (observation.season !== undefined && observation.season !== season) {
            throw validationError(`Observation season must be ${season}.`);
        }
        if (observation.scoringPeriod !== weeklyScoringPeriod && observation.scoringPeriod !== `${season}-W${request.week}`) {
            throw validationError(`Observation scoringPeriod must be the weekly period ${weeklyScoringPeriod}.`);
        }
        const observedAt = validTimestamp(observation.observedAt, "observation.observedAt");
        if (Date.parse(observedAt) > Date.parse(causalCutoff)) {
            throw validationError(`Future observation rejected for ${observation.playerId}: observed after causalCutoff.`);
        }
        assertFinite(observation.points, "observation.points");
        const sources = new Set();
        for (const prediction of observation.predictions ?? []) {
            nonEmpty(prediction.source, "prediction.source");
            assertFinite(prediction.predicted, "prediction.predicted");
            if (sources.has(prediction.source))
                throw validationError(`Duplicate source prediction: ${prediction.source}.`);
            sources.add(prediction.source);
            if (prediction.asOf !== undefined && Date.parse(validTimestamp(prediction.asOf, "prediction.asOf")) > Date.parse(causalCutoff)) {
                throw validationError(`Future prediction rejected for ${observation.playerId}: ${prediction.source}.`);
            }
        }
    }
    const modelSource = nonEmpty(request.modelSource ?? DEFAULT_MODEL_SOURCE, "modelSource");
    const modelVersion = nonEmpty(request.modelVersion ?? DEFAULT_MODEL_VERSION, "modelVersion");
    const promotion = request.promotion ?? {};
    const minimumSamples = promotion.minimumSamples ?? 1;
    if (!Number.isInteger(minimumSamples) || minimumSamples < 1)
        throw validationError("minimumSamples must be a positive integer.");
    const maxMaeRegression = promotion.maxMaeRegression ?? 0;
    const maxRmseRegression = promotion.maxRmseRegression ?? 0;
    if (!Number.isFinite(maxMaeRegression) || maxMaeRegression < 0)
        throw validationError("maxMaeRegression must be non-negative.");
    if (!Number.isFinite(maxRmseRegression) || maxRmseRegression < 0)
        throw validationError("maxRmseRegression must be non-negative.");
    return {
        season,
        week: request.week,
        causalCutoff,
        generatedAt,
        weeklyScoringPeriod,
        modelSource,
        modelVersion,
        observations,
        promotion: { ...promotion, minimumSamples, maxMaeRegression, maxRmseRegression }
    };
}
function buildPromotionDecision(request, performance) {
    const candidateSource = request.promotion.candidateSource ?? request.modelSource;
    const candidate = performance.find((metric) => metric.source === candidateSource) ?? null;
    const configuredBaseline = request.promotion.baselineSource;
    const baseline = configuredBaseline
        ? performance.find((metric) => metric.source === configuredBaseline) ?? null
        : performance
            .filter((metric) => metric.source !== candidateSource)
            .slice()
            .sort((left, right) => left.rmse - right.rmse || left.mae - right.mae || left.source.localeCompare(right.source))[0] ?? null;
    const minimumSamples = request.promotion.minimumSamples ?? 1;
    const maxMaeRegression = request.promotion.maxMaeRegression ?? 0;
    const maxRmseRegression = request.promotion.maxRmseRegression ?? 0;
    let status = "pass";
    let reason = "Candidate has sufficient weekly samples and no configured regression against the baseline.";
    if (!candidate || candidate.samples < minimumSamples) {
        status = "hold";
        reason = `Candidate requires at least ${minimumSamples} sample(s).`;
    }
    else if (configuredBaseline && !baseline) {
        status = "hold";
        reason = `Configured baseline source ${configuredBaseline} has no weekly performance.`;
    }
    else if (baseline && (candidate.samples < minimumSamples || baseline.samples < minimumSamples)) {
        status = "hold";
        reason = `Candidate and baseline both require at least ${minimumSamples} sample(s).`;
    }
    else if (baseline && candidate.mae > baseline.mae + maxMaeRegression) {
        status = "fail";
        reason = `Candidate MAE regresses against ${baseline.source}.`;
    }
    else if (baseline && candidate.rmse > baseline.rmse + maxRmseRegression) {
        status = "fail";
        reason = `Candidate RMSE regresses against ${baseline.source}.`;
    }
    const decisionWithoutId = {
        schema_version: "1.0.0",
        decision_version: DECISION_VERSION,
        created_at: request.generatedAt,
        model_version: request.modelVersion,
        candidate_source: candidateSource,
        baseline_source: baseline?.source ?? null,
        status,
        approved: status === "pass",
        reason,
        candidate_performance: candidate,
        baseline_performance: baseline
    };
    return {
        ...decisionWithoutId,
        decision_id: `decision-${sha256(decisionWithoutId).slice(0, 16)}`
    };
}
function assertModelCanAdvance(model, season, week) {
    const priorPeriod = model.lastUpdatedScoringPeriod;
    if (priorPeriod) {
        const parsed = parseWeeklyPeriod(priorPeriod);
        if (!parsed)
            throw validationError(`PlayerModel ${model.playerId} has a non-weekly lastUpdatedScoringPeriod.`);
        if (parsed.season === season && parsed.week >= week) {
            throw validationError(`PlayerModel ${model.playerId} is already updated through ${priorPeriod}.`);
        }
        return;
    }
    // Older persisted models have only lastUpdatedWeek and cannot identify their
    // season. Fail closed on a same/later week rather than applying a duplicate.
    if (model.lastUpdatedWeek !== null && model.lastUpdatedWeek >= week) {
        throw validationError(`PlayerModel ${model.playerId} is already updated through week ${model.lastUpdatedWeek}.`);
    }
}
function buildRollbackMetadata(previousModels, updatedModels, updatedPlayerIds, hasArtifactStore) {
    const base = {
        strategy: "restore-model-store-snapshot",
        previous_model_hash: hashModels(previousModels),
        updated_model_hash: hashModels(updatedModels),
        previous_model_count: previousModels.length,
        updated_model_count: updatedModels.length,
        updated_player_ids: [...new Set(updatedPlayerIds)].sort(),
        snapshot_ref: hasArtifactStore ? "rollback-models.json" : null
    };
    return {
        ...base,
        rollback_id: `rollback-${sha256(base).slice(0, 16)}`
    };
}
function parseWeeklyPeriod(value) {
    const match = /^(.*)-W(\d{1,2})$/.exec(value);
    if (!match)
        return null;
    return { season: match[1], week: Number(match[2]) };
}
function weeklyPeriod(season, week) {
    return `${season}-W${String(week).padStart(2, "0")}`;
}
function validTimestamp(value, name) {
    nonEmpty(value, name);
    if (!Number.isFinite(Date.parse(value)))
        throw validationError(`${name} must be a valid timestamp.`);
    return value;
}
function nonEmpty(value, name) {
    if (typeof value !== "string" || value.length === 0)
        throw validationError(`${name} must be a non-empty string.`);
    return value;
}
function assertFinite(value, name) {
    if (!Number.isFinite(value))
        throw validationError(`${name} must be finite.`);
}
function hashModels(models) {
    return sha256([...models].sort((left, right) => left.playerId.localeCompare(right.playerId)));
}
function sha256(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

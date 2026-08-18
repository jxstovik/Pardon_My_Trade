import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validationError } from "../errors.js";
import { updateModel, type Observation, type PlayerModel } from "./bayesian-model.js";
import type { ModelStore } from "./model-store.js";
import { evaluatePredictions, type PredictionObservation, type PredictionPerformance } from "../projections/performance.js";

const DEFAULT_MODEL_SOURCE = "bayesian-ewma";
const DEFAULT_MODEL_VERSION = "bayesian-ewma-v1";
const MANIFEST_VERSION = "model-governance-v1";
const DECISION_VERSION = "promotion-decision-v1";

export interface SourcePrediction {
  readonly source: string;
  readonly predicted: number;
  /** If present, the prediction's own as-of time is checked against the cutoff. */
  readonly asOf?: string;
}

/**
 * A completed label for one player in one weekly scoring period.
 * Season-long/ROS labels intentionally do not satisfy this contract.
 */
export interface CompletedWeeklyObservation {
  readonly playerId: string;
  readonly season?: string;
  readonly week: number;
  readonly scoringPeriod: string;
  readonly points: number;
  readonly observedAt: string;
  readonly predictions?: readonly SourcePrediction[];
}

export interface PromotionPolicy {
  /** Source name for the model being considered for promotion. */
  readonly candidateSource?: string;
  /** Optional frozen source/model used as the comparison baseline. */
  readonly baselineSource?: string;
  readonly minimumSamples?: number;
  /** Allowed absolute regression against the baseline. */
  readonly maxMaeRegression?: number;
  readonly maxRmseRegression?: number;
}

export interface PostWeekOutcomeUpdateRequest {
  readonly season: string;
  readonly week: number;
  readonly causalCutoff: string;
  readonly observations: readonly CompletedWeeklyObservation[];
  readonly modelSource?: string;
  readonly modelVersion?: string;
  readonly generatedAt?: string;
  readonly promotion?: PromotionPolicy;
}

export type PromotionStatus = "pass" | "hold" | "fail";

export interface PromotionDecision {
  readonly schema_version: "1.0.0";
  readonly decision_version: typeof DECISION_VERSION;
  readonly decision_id: string;
  readonly created_at: string;
  readonly model_version: string;
  readonly candidate_source: string;
  readonly baseline_source: string | null;
  readonly status: PromotionStatus;
  readonly approved: boolean;
  readonly reason: string;
  readonly candidate_performance: PredictionPerformance | null;
  readonly baseline_performance: PredictionPerformance | null;
}

export interface RollbackMetadata {
  readonly rollback_id: string;
  readonly strategy: "restore-model-store-snapshot";
  readonly previous_model_hash: string;
  readonly updated_model_hash: string;
  readonly previous_model_count: number;
  readonly updated_model_count: number;
  readonly updated_player_ids: readonly string[];
  /** Relative to the governance artifact directory, or null if not persisted. */
  readonly snapshot_ref: string | null;
}

export interface ModelGovernanceManifest {
  readonly schema_version: "1.0.0";
  readonly manifest_version: typeof MANIFEST_VERSION;
  readonly manifest_id: string;
  readonly created_at: string;
  readonly season: string;
  readonly weekly_scoring_period: string;
  readonly causal_cutoff: string;
  readonly model_version: string;
  readonly model_source: string;
  readonly observed_player_ids: readonly string[];
  readonly performance: readonly PredictionPerformance[];
  readonly promotion_decision: PromotionDecision;
  readonly rollback: RollbackMetadata;
}

export interface PostWeekOutcomeUpdateResult {
  readonly updatedModels: readonly PlayerModel[];
  readonly performance: readonly PredictionPerformance[];
  readonly decision: PromotionDecision;
  readonly manifest: ModelGovernanceManifest;
}

export interface ModelGovernanceArtifactStore {
  write(
    manifest: ModelGovernanceManifest,
    previousModels: readonly PlayerModel[]
  ): Promise<void>;
}

/** File-backed artifact writer for the versioned manifest and rollback snapshot. */
export class JsonModelGovernanceArtifactStore implements ModelGovernanceArtifactStore {
  constructor(private readonly directory: string) {}

  async write(manifest: ModelGovernanceManifest, previousModels: readonly PlayerModel[]): Promise<void> {
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

export interface PostWeekOutcomeUpdateOptions {
  readonly artifactStore?: ModelGovernanceArtifactStore;
  readonly artifactDir?: string;
}

/**
 * Applies one causal weekly label batch to already-built models.
 *
 * Predictions are scored before the recurrence is applied. This prevents the
 * just-arrived outcome from becoming the prediction it is evaluated against.
 */
export class PostWeekOutcomeUpdateService {
  private readonly artifactStore?: ModelGovernanceArtifactStore;

  constructor(
    private readonly modelStore: ModelStore,
    options: PostWeekOutcomeUpdateOptions = {}
  ) {
    if (options.artifactStore && options.artifactDir) {
      throw validationError("Provide artifactStore or artifactDir, not both.");
    }
    this.artifactStore = options.artifactStore ?? (options.artifactDir
      ? new JsonModelGovernanceArtifactStore(options.artifactDir)
      : undefined);
  }

  async update(request: PostWeekOutcomeUpdateRequest): Promise<PostWeekOutcomeUpdateResult> {
    const normalized = validateRequest(request);
    const previousModels = [...await this.modelStore.list()].sort((left, right) => left.playerId.localeCompare(right.playerId));
    const models = new Map(previousModels.map((model) => [model.playerId, model]));
    const predictionRows: PredictionObservation[] = [];
    const nextModels = new Map(models);
    const updatedPlayerIds: string[] = [];

    for (const outcome of normalized.observations) {
      const current = models.get(outcome.playerId);
      if (!current) throw validationError(`No existing PlayerModel for ${outcome.playerId}.`);
      assertModelCanAdvance(current, normalized.season, normalized.week);

      const seenSources = new Set<string>();
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

      const observation: Observation = {
        playerId: outcome.playerId,
        week: normalized.week,
        points: outcome.points,
        scoringPeriod: normalized.weeklyScoringPeriod
      };
      nextModels.set(outcome.playerId, updateModel(current, observation));
      updatedPlayerIds.push(outcome.playerId);
    }

    const updatedModels = [...nextModels.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
    const performance = evaluatePredictions(predictionRows).sort(
      (left, right) => left.rmse - right.rmse || left.source.localeCompare(right.source)
    );
    const decision = buildPromotionDecision(normalized, performance);
    const rollback = buildRollbackMetadata(previousModels, updatedModels, updatedPlayerIds, this.artifactStore !== undefined);
    const manifestWithoutId = {
      schema_version: "1.0.0" as const,
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
    } as const;
    const manifest: ModelGovernanceManifest = {
      ...manifestWithoutId,
      manifest_id: `manifest-${sha256(manifestWithoutId).slice(0, 16)}`
    };

    await this.modelStore.saveAll(updatedPlayerIds.map((playerId) => nextModels.get(playerId)!));
    if (this.artifactStore) await this.artifactStore.write(manifest, previousModels);

    return { updatedModels, performance, decision, manifest };
  }
}

export async function updatePostWeekOutcomes(
  modelStore: ModelStore,
  request: PostWeekOutcomeUpdateRequest,
  options: PostWeekOutcomeUpdateOptions = {}
): Promise<PostWeekOutcomeUpdateResult> {
  return new PostWeekOutcomeUpdateService(modelStore, options).update(request);
}

interface NormalizedRequest {
  readonly season: string;
  readonly week: number;
  readonly causalCutoff: string;
  readonly generatedAt: string;
  readonly weeklyScoringPeriod: string;
  readonly modelSource: string;
  readonly modelVersion: string;
  readonly observations: readonly CompletedWeeklyObservation[];
  readonly promotion: PromotionPolicy;
}

function validateRequest(request: PostWeekOutcomeUpdateRequest): NormalizedRequest {
  const season = nonEmpty(request.season, "season");
  if (!Number.isInteger(request.week) || request.week < 1 || request.week > 18) {
    throw validationError("week must be an integer from 1 through 18.");
  }
  const causalCutoff = validTimestamp(request.causalCutoff, "causalCutoff");
  const generatedAt = validTimestamp(request.generatedAt ?? request.causalCutoff, "generatedAt");
  if (!request.observations.length) throw validationError("At least one completed weekly observation is required.");
  const weeklyScoringPeriod = weeklyPeriod(season, request.week);
  const observations = [...request.observations]
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  const playerIds = new Set<string>();

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
    const sources = new Set<string>();
    for (const prediction of observation.predictions ?? []) {
      nonEmpty(prediction.source, "prediction.source");
      assertFinite(prediction.predicted, "prediction.predicted");
      if (sources.has(prediction.source)) throw validationError(`Duplicate source prediction: ${prediction.source}.`);
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
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) throw validationError("minimumSamples must be a positive integer.");
  const maxMaeRegression = promotion.maxMaeRegression ?? 0;
  const maxRmseRegression = promotion.maxRmseRegression ?? 0;
  if (!Number.isFinite(maxMaeRegression) || maxMaeRegression < 0) throw validationError("maxMaeRegression must be non-negative.");
  if (!Number.isFinite(maxRmseRegression) || maxRmseRegression < 0) throw validationError("maxRmseRegression must be non-negative.");

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

function buildPromotionDecision(
  request: NormalizedRequest,
  performance: readonly PredictionPerformance[]
): PromotionDecision {
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

  let status: PromotionStatus = "pass";
  let reason = "Candidate has sufficient weekly samples and no configured regression against the baseline.";
  if (!candidate || candidate.samples < minimumSamples) {
    status = "hold";
    reason = `Candidate requires at least ${minimumSamples} sample(s).`;
  } else if (configuredBaseline && !baseline) {
    status = "hold";
    reason = `Configured baseline source ${configuredBaseline} has no weekly performance.`;
  } else if (baseline && (candidate.samples < minimumSamples || baseline.samples < minimumSamples)) {
    status = "hold";
    reason = `Candidate and baseline both require at least ${minimumSamples} sample(s).`;
  } else if (baseline && candidate.mae > baseline.mae + maxMaeRegression) {
    status = "fail";
    reason = `Candidate MAE regresses against ${baseline.source}.`;
  } else if (baseline && candidate.rmse > baseline.rmse + maxRmseRegression) {
    status = "fail";
    reason = `Candidate RMSE regresses against ${baseline.source}.`;
  }

  const decisionWithoutId = {
    schema_version: "1.0.0" as const,
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
  } as const;
  return {
    ...decisionWithoutId,
    decision_id: `decision-${sha256(decisionWithoutId).slice(0, 16)}`
  };
}

function assertModelCanAdvance(model: PlayerModel, season: string, week: number): void {
  const priorPeriod = model.lastUpdatedScoringPeriod;
  if (priorPeriod) {
    const parsed = parseWeeklyPeriod(priorPeriod);
    if (!parsed) throw validationError(`PlayerModel ${model.playerId} has a non-weekly lastUpdatedScoringPeriod.`);
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

function buildRollbackMetadata(
  previousModels: readonly PlayerModel[],
  updatedModels: readonly PlayerModel[],
  updatedPlayerIds: readonly string[],
  hasArtifactStore: boolean
): RollbackMetadata {
  const base = {
    strategy: "restore-model-store-snapshot" as const,
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

function parseWeeklyPeriod(value: string): { season: string; week: number } | null {
  const match = /^(.*)-W(\d{1,2})$/.exec(value);
  if (!match) return null;
  return { season: match[1], week: Number(match[2]) };
}

function weeklyPeriod(season: string, week: number): string {
  return `${season}-W${String(week).padStart(2, "0")}`;
}

function validTimestamp(value: string, name: string): string {
  nonEmpty(value, name);
  if (!Number.isFinite(Date.parse(value))) throw validationError(`${name} must be a valid timestamp.`);
  return value;
}

function nonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw validationError(`${name} must be a non-empty string.`);
  return value;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw validationError(`${name} must be finite.`);
}

function hashModels(models: readonly PlayerModel[]): string {
  return sha256([...models].sort((left, right) => left.playerId.localeCompare(right.playerId)));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

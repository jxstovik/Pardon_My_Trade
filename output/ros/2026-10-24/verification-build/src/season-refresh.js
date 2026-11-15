import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SqliteKnowledgeRepository } from "./knowledge/sqlite-knowledge-repository.js";
import { buildProjectionSources } from "./projections/projection-source-registry.js";
import { matchProjectionsToRoster } from "./projections/projection-matching.js";
import { getCurrentScoringPeriod, weekFromScoringPeriod, REGULAR_SEASON_WEEKS } from "./seasons/nfl-calendar.js";
import { buildPriorsFromSnapshot, toWeeklyProjectionPoints } from "./agents/snapshot-integration.js";
import { buildModelsForOrchestrator } from "./agents/ff-orchestrator.js";
import { JsonModelStore } from "./probabilistic/model-store.js";
import { buildRuntimeProbabilisticProjections, loadHistoricalData, saveProbabilisticProjections } from "./projections/runtime.js";
import { loadApprovedWrArtifact, projectionFromApprovedWrArtifact } from "./projections/wr-artifact-loader.js";
/**
 * Refresh projections for an already-imported league WITHOUT re-importing it:
 * pull every configured source, match candidates to the roster, persist the
 * matched projections (the snapshot row itself stays immutable), then rebuild
 * the Bayesian model priors so the orchestrator sees fresh numbers.
 */
export async function runSeasonRefresh(options = {}) {
    const dataDir = options.dataDir ?? process.env.PMT_DATA_DIR ?? "data";
    const repository = options.repository ?? (await (async () => {
        await mkdir(dataDir, { recursive: true });
        return new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.sqlite") });
    })());
    const pointer = await loadLastSnapshotPointer(dataDir);
    const snapshot = await repository.getLeagueSnapshot(pointer.snapshot_id);
    if (!snapshot) {
        throw new Error("Imported snapshot not found in the store. Run `pmt import-espn <leagueId>` first.");
    }
    const season = options.season ?? snapshot.league.season;
    const scoringPeriod = options.week
        ? `${season}-W${options.week}`
        : snapshot.scoring_period ?? getCurrentScoringPeriod(new Date(), season);
    // Season-total projection sources are rescaled to single-week points so the
    // Bayesian priors and the runtime artifact stay apples-to-apples with weekly
    // predictions from other sources.
    const currentWeek = weekFromScoringPeriod(scoringPeriod);
    const weeksRemaining = currentWeek !== undefined ? REGULAR_SEASON_WEEKS - currentWeek + 1 : undefined;
    const sources = buildProjectionSources({
        sources: options.sources ?? process.env.PMT_PROJECTION_SOURCES,
        season,
        dataDir,
        espnCredentials: options.espnCredentials,
        force: options.force
    });
    const rosterPlayers = [...snapshot.players, ...snapshot.free_agents];
    const stored = [];
    const sourceBreakdown = {};
    const skipped = {};
    const errors = [];
    let wrArtifact;
    for (const source of sources) {
        try {
            const candidates = await source.fetchProjections("football", season, scoringPeriod);
            if (source.lastSkipReason) {
                skipped[source.name] = source.lastSkipReason;
                continue;
            }
            const matched = matchProjectionsToRoster(candidates, rosterPlayers, scoringPeriod, source.name);
            stored.push(...matched);
            sourceBreakdown[source.name] = matched.length;
        }
        catch (cause) {
            errors.push(`${source.name}: ${cause.message}`);
        }
    }
    const wrArtifactPath = options.wrArtifactPath ?? process.env.PMT_WR_ARTIFACT_DIR;
    if (wrArtifactPath) {
        try {
            const artifact = await loadApprovedWrArtifact(wrArtifactPath);
            if (String(artifact.season) !== season) {
                wrArtifact = { status: "skipped", reason: `artifact season ${artifact.season} does not match refresh season ${season}` };
            }
            else {
                const now = new Date().toISOString();
                for (const player of rosterPlayers.filter((candidate) => candidate.positions.includes("WR"))) {
                    const probabilistic = projectionFromApprovedWrArtifact(artifact, player.player_id, scoringPeriod);
                    if (!probabilistic)
                        continue;
                    stored.push({
                        schema_version: "1.0.0",
                        created_at: now,
                        updated_at: now,
                        source_system: "chatpft",
                        source_record_id: `${artifact.replayId}:${player.player_id}:${scoringPeriod}`,
                        projection_id: `chatpft-wr-${player.player_id}-${scoringPeriod}`,
                        player_id: player.player_id,
                        source: "chatpft-wr-artifact",
                        scoring_period: scoringPeriod,
                        projected_stats: { p10: probabilistic.quantiles.p10, p50: probabilistic.mean, p90: probabilistic.quantiles.p90 },
                        projected_points: probabilistic.mean,
                        floor: probabilistic.quantiles.p10,
                        ceiling: probabilistic.quantiles.p90,
                        confidence: Math.max(0, Math.min(1, 1 / (1 + probabilistic.standardDeviation)))
                    });
                }
                sourceBreakdown["chatpft-wr-artifact"] = stored.filter((projection) => projection.source === "chatpft-wr-artifact").length;
                wrArtifact = { status: "loaded", modelVersion: artifact.modelVersion };
            }
        }
        catch (cause) {
            wrArtifact = { status: "skipped", reason: cause.message };
            errors.push(`chatpft-wr-artifact: ${cause.message}`);
        }
    }
    await repository.upsertProjections(stored, snapshot.league.external_id);
    // Re-read so the snapshot carries the freshly stored projections, then
    // rebuild priors/models from them. Prior weekly observations are re-applied
    // (chronologically) so the rebuild never wipes in-season model state.
    const refreshed = await repository.getLeagueSnapshot(pointer.snapshot_id);
    const targetSnapshot = refreshed ?? snapshot;
    // Season snapshots include every stored week. Never let insertion order or
    // another week's rows choose the prior for an explicitly requested refresh.
    const priors = buildPriorsFromSnapshot({
        ...targetSnapshot,
        scoring_period: scoringPeriod,
        projections: targetSnapshot.projections.filter((projection) => projection.scoring_period === scoringPeriod)
    }, { weeksRemaining });
    const historyPath = process.env.PMT_HISTORICAL_DATA_PATH;
    const weeklyObservations = historyPath ? await loadWeeklyObservations(historyPath) : [];
    const modelStore = new JsonModelStore(join(dataDir, "models.json"));
    const models = await rebuildPreservingLearned(priors, weeklyObservations, await modelStore.list(), season);
    await modelStore.saveAll([...models.values()]);
    const playerIds = new Set(stored.map((p) => p.player_id));
    if (historyPath) {
        const history = await loadHistoricalData(historyPath);
        const storedByPlayer = new Map(stored.map((p) => [p.player_id, p]));
        const rows = rosterPlayers.map((player) => {
            const storedProjection = storedByPlayer.get(player.player_id);
            const weeklySourceMean = storedProjection
                ? toWeeklyProjectionPoints(storedProjection.projected_points, storedProjection.source, weeksRemaining)
                : undefined;
            return {
                playerId: player.player_id,
                position: (player.positions[0] ?? "WR"),
                scoringPeriod,
                history: history.filter((observation) => observation.playerId === player.player_id).map((observation) => observation.points),
                ...(weeklySourceMean !== undefined && Number.isFinite(weeklySourceMean) ? { sourceMean: weeklySourceMean } : {})
            };
        });
        const external = stored
            .filter((projection) => projection.source !== "razzball")
            .map((projection) => ({
            playerId: projection.player_id,
            source: projection.source,
            projectedPoints: toWeeklyProjectionPoints(projection.projected_points, projection.source, weeksRemaining),
            scoringPeriod: projection.scoring_period
        }));
        const razzball = stored
            .filter((projection) => projection.source.includes("razzball"))
            .map((projection) => ({
            playerId: projection.player_id,
            source: projection.source,
            projectedPoints: toWeeklyProjectionPoints(projection.projected_points, projection.source, weeksRemaining),
            scoringPeriod: projection.scoring_period
        }));
        await saveProbabilisticProjections(join(dataDir, "probabilistic-projections.json"), buildRuntimeProbabilisticProjections(rows, external, razzball, history));
    }
    return {
        snapshotId: pointer.snapshot_id,
        season,
        scoringPeriod,
        sources: sourceBreakdown,
        skipped,
        projectionsStored: stored.length,
        playersUpdated: playerIds.size,
        modelsRebuilt: models.size,
        errors,
        ...(wrArtifact ? { wrArtifact } : {})
    };
}
/**
 * Persist the candidates from a single source (e.g. an ad-hoc `pmt projections`
 * pull) into the store, matched to the imported roster.
 */
export async function persistCandidates(repository, snapshot, source, candidates, scoringPeriod, dataDir) {
    const rosterPlayers = [...snapshot.players, ...snapshot.free_agents];
    const matched = matchProjectionsToRoster(candidates, rosterPlayers, scoringPeriod, source.name);
    await repository.upsertProjections(matched, snapshot.league.external_id);
    const modelStore = new JsonModelStore(join(dataDir, "models.json"));
    const currentWeek = weekFromScoringPeriod(scoringPeriod);
    const weeksRemaining = currentWeek !== undefined ? REGULAR_SEASON_WEEKS - currentWeek + 1 : undefined;
    const priors = buildPriorsFromSnapshot(snapshot, { weeksRemaining });
    const historyPath = process.env.PMT_HISTORICAL_DATA_PATH;
    const weeklyObservations = historyPath ? await loadWeeklyObservations(historyPath) : [];
    const models = await rebuildPreservingLearned(priors, weeklyObservations, await modelStore.list(), snapshot.league.season);
    await modelStore.saveAll([...models.values()]);
    return matched.length;
}
async function rebuildPreservingLearned(priors, observations, existing, season) {
    const models = buildModelsForOrchestrator(priors, observations);
    const existingById = new Map(existing.map((model) => [model.playerId, model]));
    const { updateModel } = await import("./probabilistic/bayesian-model.js");
    for (const [playerId, rebuilt] of models) {
        const stored = existingById.get(playerId);
        if (!stored || stored.weeksObserved === 0 || stored.position !== rebuilt.position)
            continue;
        let next = stored;
        const storedPeriod = stored.lastUpdatedScoringPeriod;
        const storedWeek = stored.lastUpdatedWeek ?? (storedPeriod?.match(/-W(\d+)$/)?.[1] ? Number(storedPeriod.match(/-W(\d+)$/)[1]) : 0);
        if (storedPeriod?.startsWith(`${season}-W`)) {
            for (const observation of observations.filter((row) => row.scoringPeriod?.startsWith(`${season}-W`) && row.week > storedWeek)) {
                next = updateModel(next, observation);
            }
        }
        models.set(playerId, next);
    }
    return models;
}
/**
 * Load completed weekly observations from the configured historical file and
 * convert them to Bayesian Observation rows, ordered chronologically so the
 * EWMA recurrence reproduces the same model state the governance update wrote.
 */
export async function loadWeeklyObservations(path) {
    const history = await loadHistoricalData(path);
    return history
        .map((row) => ({
        playerId: row.playerId,
        week: weekFromScoringPeriod(row.scoringPeriod) ?? 0,
        points: row.points,
        scoringPeriod: row.scoringPeriod
    }))
        .filter((row) => row.week > 0)
        .sort((left, right) => left.week - right.week || left.playerId.localeCompare(right.playerId));
}
export async function loadLastSnapshotPointer(dataDir) {
    try {
        const raw = await readFile(join(dataDir, "last-snapshot.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        throw new Error("No imported snapshot pointer found at data/last-snapshot.json. Run `pmt import-espn <leagueId>` first.");
    }
}

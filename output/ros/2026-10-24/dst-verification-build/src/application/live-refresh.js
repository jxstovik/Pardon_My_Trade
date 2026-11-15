import { randomUUID } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { buildSnapshotFromPlatform, loadFixtureSnapshotSource } from "../knowledge/ingestion.js";
import { FixturePlatformReader } from "../adapters/fixture/fixture-platform-reader.js";
import { SleeperPlatformReader } from "../adapters/sleeper/sleeper-platform-reader.js";
import { EspnPlatformReader } from "../adapters/espn/espn-platform-reader.js";
import { buildProjectionSources } from "../projections/projection-source-registry.js";
import { matchProjectionsToRoster } from "../projections/projection-matching.js";
import { mergeProjections } from "../agents/snapshot-integration.js";
import { getCurrentScoringPeriod } from "../seasons/nfl-calendar.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { SqliteJobStore } from "../storage/sqlite-job-store.js";
import { runRefresh } from "../pipeline/refresh.js";
export function configuredReader(config = loadRuntimeConfig()) {
    if (config.platform === "fixture")
        return new FixturePlatformReader(config.fixturePath);
    if (config.platform === "sleeper")
        return new SleeperPlatformReader();
    return new EspnPlatformReader({ credentials: { leagueId: config.leagueExternalId, season: config.season, espnS2: process.env.ESPN_S2, swid: process.env.SWID } });
}
/** Refresh never falls back from a live platform to fixture data. */
export async function readConfiguredSnapshot(config = loadRuntimeConfig()) {
    const reader = configuredReader(config);
    let livePeriod;
    if (config.platform === "espn" && reader instanceof EspnPlatformReader) {
        const raw = await reader.getLeagueFresh();
        if (Number.isInteger(raw.scoringPeriodId) && raw.scoringPeriodId > 0)
            livePeriod = `${config.season}-W${raw.scoringPeriodId}`;
    }
    let snapshot = config.platform === "fixture"
        ? await loadFixtureSnapshotSource(config.fixturePath)
        : await buildSnapshotFromPlatform(reader, config.leagueExternalId, config.season);
    if (livePeriod)
        snapshot = { ...snapshot, scoring_period: livePeriod };
    if (snapshot.league.external_id !== config.leagueExternalId || snapshot.league.platform !== config.platform) {
        throw new Error("Snapshot platform/league differs from the configured connection.");
    }
    if (!snapshot.league.teams.some(t => t.external_id === config.teamExternalId || t.team_id === config.teamExternalId)) {
        throw new Error(`Configured team ${config.teamExternalId} is not in the returned league.`);
    }
    if (config.platform !== "fixture") {
        const period = snapshot.scoring_period ?? getCurrentScoringPeriod(new Date(), config.season);
        for (const source of buildProjectionSources({ sources: process.env.PMT_PROJECTION_SOURCES, season: config.season, dataDir: config.dataDir, espnCredentials: config.platform === "espn" ? { leagueId: config.leagueExternalId, season: config.season, espnS2: process.env.ESPN_S2, swid: process.env.SWID } : undefined })) {
            try {
                const candidates = await source.fetchProjections("football", config.season, period);
                snapshot = mergeProjections(snapshot, matchProjectionsToRoster(candidates, [...snapshot.players, ...snapshot.free_agents], period, source.name));
            }
            catch (error) {
                // Keep source failure explicit while retaining a usable roster. Analytics blocks uncovered starters.
                process.stderr.write(`Projection source ${source.name} unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
            }
        }
    }
    return { ...snapshot, snapshot_id: `${config.platform}-${config.leagueExternalId}-${randomUUID()}` };
}
export async function writeSnapshotPointer(snapshot, dataDir) {
    const temporary = join(dataDir, `last-snapshot-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ snapshot_id: snapshot.snapshot_id, league_id: snapshot.league.league_id }), { mode: 0o600 });
    await rename(temporary, join(dataDir, "last-snapshot.json"));
}
export async function refreshConfiguredLeague(options, config = loadRuntimeConfig()) {
    const jobs = new SqliteJobStore({ filePath: config.databasePath });
    const worker = `refresh-${randomUUID()}`;
    const bucket = Math.floor(Date.now() / 60_000);
    const job = jobs.enqueue("league-refresh", { platform: config.platform, league: config.leagueExternalId, team: config.teamExternalId }, { dedupeKey: `${config.platform}:${config.leagueExternalId}:${config.teamExternalId}:${bucket}` });
    try {
        if (job.status === "succeeded" && job.result)
            return job.result;
        if (!jobs.claimJob(job.jobId, worker, { leaseMs: 10 * 60_000 }))
            throw new Error("A refresh is already running or failed in this minute; consult agent activity and retry in the next minute.");
        try {
            const summary = await runRefresh({ ...options, fixturePath: config.fixturePath, leagueExternalId: config.leagueExternalId, teamExternalId: config.teamExternalId, snapshotSource: () => readConfiguredSnapshot(config) });
            const snapshot = await options.repository.getLeagueSnapshot(summary.snapshot_id);
            if (snapshot)
                await writeSnapshotPointer(snapshot, config.dataDir);
            if (!jobs.complete(job.jobId, worker, summary))
                throw new Error("Refresh lease was lost; result is saved but the job must be reconciled.");
            return summary;
        }
        catch (error) {
            jobs.fail(job.jobId, worker, error);
            throw error;
        }
    }
    finally {
        jobs.close();
    }
}
export async function getConfiguredSnapshot(repository, config = loadRuntimeConfig()) {
    const scoped = repository;
    if (scoped.getLatestLeagueSnapshot) {
        const snapshot = await scoped.getLatestLeagueSnapshot(config.platform === "fixture" ? undefined : config.leagueExternalId);
        if (snapshot && snapshot.league.external_id === config.leagueExternalId && snapshot.league.platform === config.platform)
            return snapshot;
    }
    return undefined;
}

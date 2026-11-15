import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultConfig } from "./config/app-config.js";
import { FixturePlatformReader } from "./adapters/fixture/fixture-platform-reader.js";
import { SleeperPlatformReader } from "./adapters/sleeper/sleeper-platform-reader.js";
import { buildSnapshotFromPlatform } from "./knowledge/ingestion.js";
import { ScoringRuleEngine } from "./rules/rule-engine.js";
import { DefaultDecisionEngine } from "./decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "./recommendations/recommendation-engine.js";
import { SqliteKnowledgeRepository } from "./knowledge/sqlite-knowledge-repository.js";
import { SqliteV1Store } from "./history/sqlite-v1-store.js";
import { ConsoleNotificationProvider, FileNotificationProvider } from "./notifications/notification-provider.js";
import { loadFixtureSnapshotSource } from "./knowledge/ingestion.js";
import { runRefresh } from "./pipeline/refresh.js";
import { createApiServer } from "./api/server.js";
import { DraftController } from "./draft/draft-controller.js";
import { attachDraftWebSocket } from "./api/draft-ws.js";
import { loadEnv } from "./config/load-env.js";
import { EspnPlatformReader } from "./adapters/espn/espn-platform-reader.js";
import { EspnPlatformWriter } from "./adapters/espn/espn-platform-writer.js";
import { runProjectionsCommand, runRazzballLogin } from "./cli-projections.js";
import { runSeasonRefresh } from "./season-refresh.js";
import { JsonModelStore } from "./probabilistic/model-store.js";
import { buildModels, applyObservations, rankByValue } from "./probabilistic/model-engine.js";
import { runOrchestrator } from "./agents/ff-orchestrator.js";
import { ActionQueue, SqliteActionQueueStore } from "./agents/action-queue.js";
import { ActionExecutor, SqliteActionExecutionStore } from "./agents/action-executor.js";
import { InMemoryScheduler } from "./scheduler/scheduler.js";
import { registerSeasonJobs, runDailySeasonJob } from "./seasons/season-jobs.js";
import { runSeasonOrchestration } from "./seasons/season-orchestration.js";
import { DraftSession } from "./draft/draft-session.js";
import { loadEspnCredentials } from "./adapters/espn/espn-auth.js";
import { EspnPlatformClient } from "./adapters/espn/espn-platform-client.js";
import { loadRuntimeConfig, prepareRuntimeStorage } from "./config/runtime-config.js";
import { readConfiguredSnapshot, refreshConfiguredLeague, getConfiguredSnapshot, writeSnapshotPointer } from "./application/live-refresh.js";
import { runEspnDoctor } from "./adapters/espn/espn-doctor.js";
const command = process.argv[2] ?? "help";
async function main() {
    loadEnv();
    switch (command) {
        case "help":
        case "--help":
        case "-h":
            printHelp();
            return;
        case "version":
        case "--version":
            console.log("pardon-my-trade 0.2.0");
            return;
        case "import-fixture": {
            const config = createDefaultConfig();
            const reader = new FixturePlatformReader(config.fixturePath);
            const league = await reader.getLeague("pmt-demo-football", "2026");
            const teams = await reader.getTeams(league.external_id);
            const players = await reader.getPlayers(league.sport, league.season);
            const freeAgents = await reader.getFreeAgents(league.external_id);
            console.log(JSON.stringify({
                leagueId: league.league_id,
                name: league.name,
                sport: league.sport,
                season: league.season,
                teams: teams.length,
                players: players.length,
                freeAgents: freeAgents.length
            }, null, 2));
            return;
        }
        case "weekly-report": {
            const { runWeeklyReport } = await import("./pipeline/weekly-report.js");
            const config = createDefaultConfig();
            const leagueExternalId = process.argv[3] ?? "pmt-demo-football";
            const teamExternalId = process.argv[4] ?? "team-001";
            const result = await runWeeklyReport(config.fixturePath, leagueExternalId, teamExternalId);
            console.log(JSON.stringify({
                team: result.team.name,
                lineupValid: result.lineupEvaluationValid,
                projectedPoints: result.inputs.currentProjectedPoints,
                lineupCandidates: result.inputs.lineupCandidates.length,
                waiverCandidates: result.inputs.waiverCandidates.length,
                dropCandidates: result.inputs.dropCandidates.length,
                tradeCandidates: result.inputs.tradeCandidates.length,
                recommendation: {
                    id: result.report.recommendation_id,
                    type: result.report.type,
                    confidence: result.report.confidence,
                    status: result.report.status
                }
            }, null, 2));
            return;
        }
        case "add-drop-eval": {
            const { readFileSync } = await import("node:fs");
            const { resolve } = await import("node:path");
            const leagueExternalId = process.argv[3] ?? "pmt-demo-football";
            const teamExternalId = process.argv[4] ?? "team-001";
            const config = createDefaultConfig();
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const snapshot = JSON.parse(readFileSync(resolve(config.fixturePath), "utf8"));
            const team = snapshot.league.teams.find((t) => t.external_id === teamExternalId || t.team_id === teamExternalId);
            if (!team)
                throw new Error(`Team ${teamExternalId} not found in ${config.fixturePath}`);
            // Weekly-scale projections artifact (p10/p90 for upside stashes); fall
            // back to the snapshot's attached projections (point estimates only).
            let projected = new Map();
            try {
                const artifact = JSON.parse(readFileSync(resolve(dataDir, "probabilistic-projections.json"), "utf8"));
                projected = new Map(artifact.projections.map((p) => [p.playerId, { mean: p.mean, p90: p.quantiles?.p90 }]));
            }
            catch {
                const snapProjections = snapshot.projections ?? [];
                projected = new Map(snapProjections.map((p) => [p.player_id, { mean: p.projected_points }]));
            }
            const positionByPlayer = new Map();
            for (const p of [...snapshot.players, ...snapshot.free_agents]) {
                if (!positionByPlayer.has(p.player_id))
                    positionByPlayer.set(p.player_id, p.positions[0] ?? "BN");
            }
            const nameByPlayer = new Map();
            for (const p of [...snapshot.players, ...snapshot.free_agents]) {
                nameByPlayer.set(p.player_id, p.full_name);
            }
            const { roster, slotCounts } = (() => {
                const rosterPlayers = [...team.roster.starters, ...team.roster.bench].map((entry) => ({
                    playerId: entry.player_id,
                    slot: entry.slot_type,
                    projected: projected.get(entry.player_id)?.mean ?? 0
                }));
                const counts = {};
                for (const slot of snapshot.league.roster_settings?.slots ?? []) {
                    if (slot.slot !== "BN")
                        counts[slot.slot] = slot.count;
                }
                return { roster: rosterPlayers, slotCounts: counts };
            })();
            const { rankFreeAgents, lineupSwapCandidates } = await import("./recommendations/slot-aware.js");
            const candidates = snapshot.free_agents
                .map((fa) => {
                const proj = projected.get(fa.player_id);
                return proj
                    ? { playerId: fa.player_id, position: fa.positions[0] ?? "BN", projected: proj.mean, upside: proj.p90 }
                    : undefined;
            })
                .filter((c) => c !== undefined && c.position !== "BN");
            const ranked = rankFreeAgents(roster, slotCounts, candidates).slice(0, 15);
            const swaps = lineupSwapCandidates(roster, Object.fromEntries([...team.roster.bench].map((b) => [b.player_id, positionByPlayer.get(b.player_id) ?? "FLEX"])), slotCounts);
            console.log(JSON.stringify({
                team: team.name,
                projectedBy: projected.size ? "probabilistic-projections.json (weekly scale)" : "snapshot projections",
                lineupSwaps: swaps.map((s) => ({
                    start: nameByPlayer.get(s.benchPlayerId) ?? s.benchPlayerId,
                    bench: nameByPlayer.get(s.outPlayerId) ?? s.outPlayerId,
                    slot: s.slot,
                    delta: s.delta
                })),
                addRecommendations: ranked.map((e) => ({
                    add: nameByPlayer.get(e.playerId) ?? e.playerId,
                    position: e.position,
                    projected: e.projected,
                    weeklyDelta: e.weeklyDelta,
                    startsThisWeek: e.startsThisWeek,
                    replaces: e.replaces ? nameByPlayer.get(e.replaces.playerId) ?? e.replaces.playerId : undefined,
                    drop: e.bestDropPlayerId ? nameByPlayer.get(e.bestDropPlayerId) ?? e.bestDropPlayerId : undefined,
                    upsideStash: e.upsideStash,
                    rationale: e.rationale
                })),
                evaluatedFreeAgents: candidates.length,
                actionable: ranked.length
            }, null, 2));
            return;
        }
        case "doctor": {
            const report = await runEspnDoctor({ credentials: process.env.ESPN_LEAGUE_ID || process.env.PMT_LEAGUE_ID ? { leagueId: process.env.ESPN_LEAGUE_ID ?? process.env.PMT_LEAGUE_ID, season: process.env.ESPN_SEASON ?? process.env.PMT_SEASON ?? new Date().getFullYear().toString(), espnS2: process.env.ESPN_S2, swid: process.env.SWID } : undefined });
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        case "refresh": {
            const runtime = loadRuntimeConfig();
            await mkdir(runtime.dataDir, { recursive: true });
            await prepareRuntimeStorage(runtime);
            const repository = new SqliteKnowledgeRepository({ filePath: runtime.databasePath });
            const v1Store = new SqliteV1Store({ filePath: runtime.databasePath });
            const ruleEngine = new ScoringRuleEngine();
            const summary = await refreshConfiguredLeague({ repository, v1Store, ruleEngine,
                decisionEngine: new DefaultDecisionEngine(ruleEngine), recommendationEngine: new DefaultRecommendationEngine(ruleEngine) }, runtime);
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        case "import-sleeper": {
            const leagueId = process.argv[3];
            if (!leagueId) {
                throw new Error("import-sleeper requires a Sleeper league id: pmt import-sleeper <leagueId> [season]");
            }
            const season = process.argv[4] ?? new Date().getFullYear().toString();
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            await mkdir(dataDir, { recursive: true });
            const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.sqlite") });
            const reader = new SleeperPlatformReader();
            const snapshot = await buildSnapshotFromPlatform(reader, leagueId, season);
            await repository.saveLeagueSnapshot(snapshot);
            const pointer = { snapshot_id: snapshot.snapshot_id, league_id: snapshot.league.league_id };
            await writeFile(join(dataDir, "last-snapshot.json"), JSON.stringify(pointer), "utf8");
            console.log(JSON.stringify({
                message: "Imported Sleeper league snapshot (read-only).",
                snapshotId: snapshot.snapshot_id,
                league: snapshot.league.name,
                teams: snapshot.league.teams.length,
                players: snapshot.players.length,
                freeAgents: snapshot.free_agents.length,
                note: "Projections and news are empty until a projection source is connected. Run `pmt serve` to view."
            }, null, 2));
            return;
        }
        case "serve": {
            const runtime = loadRuntimeConfig();
            const dataDir = runtime.dataDir;
            await mkdir(dataDir, { recursive: true });
            await prepareRuntimeStorage(runtime);
            const repository = new SqliteKnowledgeRepository({ filePath: runtime.databasePath });
            const v1Store = new SqliteV1Store({ filePath: runtime.databasePath });
            const ruleEngine = new ScoringRuleEngine();
            const initialSnapshot = await getConfiguredSnapshot(repository, runtime) ?? await readConfiguredSnapshot(runtime);
            if (!await repository.getLeagueSnapshot(initialSnapshot.snapshot_id))
                await repository.saveLeagueSnapshot(initialSnapshot);
            await writeSnapshotPointer(initialSnapshot, dataDir);
            const doRefresh = () => refreshConfiguredLeague({ repository, v1Store, ruleEngine,
                decisionEngine: new DefaultDecisionEngine(ruleEngine), recommendationEngine: new DefaultRecommendationEngine(ruleEngine) }, runtime);
            const host = process.env.PMT_HOST ?? "127.0.0.1";
            if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.PMT_WEB_PASSWORD)
                throw new Error("PMT_WEB_PASSWORD is required for non-loopback serving.");
            const server = createApiServer({ repository, v1Store, refresh: doRefresh, initialSnapshot,
                teamId: runtime.teamExternalId, dataDir, getSnapshot: () => getConfiguredSnapshot(repository, runtime),
                modelingDir: process.env.PMT_MODELING_DIR ?? join(process.cwd(), "artifacts", "wr-2024-replay") });
            const port = Number(process.env.PMT_PORT ?? 3000);
            server.listen(port, host, () => console.log(`Pardon My Trade running at http://${host}:${port}`));
            if (process.argv.includes("--scheduler"))
                throw new Error("Use a single Hermes cron owner with durable jobs; serve does not start a second scheduler.");
            return;
        }
        case "import-espn": {
            const leagueId = process.argv[3] ?? process.env.PMT_LEAGUE_ID ?? process.env.ESPN_LEAGUE_ID;
            const season = process.argv[4] ?? process.env.PMT_SEASON ?? process.env.ESPN_SEASON ?? String(new Date().getUTCFullYear());
            const teamId = process.argv[5] ?? process.env.PMT_TEAM_ID ?? process.env.ESPN_TEAM_ID;
            if (!leagueId || !teamId)
                throw new Error("import-espn requires explicit league and team ids: pmt import-espn <leagueId> [season] <teamId>.");
            const runtime = loadRuntimeConfig({ ...process.env, platform: "espn", leagueExternalId: leagueId, season, teamExternalId: teamId });
            await mkdir(runtime.dataDir, { recursive: true });
            await prepareRuntimeStorage(runtime);
            const repository = new SqliteKnowledgeRepository({ filePath: runtime.databasePath });
            const snapshot = await readConfiguredSnapshot(runtime);
            await repository.saveLeagueSnapshot(snapshot);
            await writeSnapshotPointer(snapshot, runtime.dataDir);
            const team = snapshot.league.teams.find(t => t.team_id === teamId || t.external_id === teamId);
            const covered = new Set(snapshot.projections.map(p => p.player_id));
            console.log(JSON.stringify({ message: "Imported ESPN read-only snapshot. No team actions submitted.", snapshotId: snapshot.snapshot_id,
                league: snapshot.league.name, team: team.name, players: snapshot.players.length, freeAgents: snapshot.free_agents.length,
                projections: snapshot.projections.length, uncoveredStarters: team.roster.starters.filter(s => s.player_id && !covered.has(s.player_id)).map(s => s.player_id),
                next: "Set PMT_PLATFORM=espn, PMT_LEAGUE_ID, PMT_TEAM_ID and PMT_SEASON for serve, refresh and Hermes." }, null, 2));
            return;
        }
        case "build-models": {
            const priorsPath = process.argv[3] ?? process.env.PMT_PRIORS_PATH;
            if (!priorsPath) {
                throw new Error("build-models requires a priors JSON file: pmt build-models <priors.json> [observations.json]");
            }
            const observationsPath = process.argv[4];
            const priors = JSON.parse(await readFile(priorsPath, "utf8"));
            const observations = observationsPath
                ? JSON.parse(await readFile(observationsPath, "utf8"))
                : [];
            let models = buildModels(priors);
            models = applyObservations(models, observations);
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const store = new JsonModelStore(join(dataDir, "models.json"));
            await store.saveAll([...models.values()]);
            const ranked = rankByValue(models.values()).slice(0, 10);
            console.log(JSON.stringify({
                built: models.size,
                topByValue: ranked.map((r) => ({
                    player: r.model.playerName,
                    position: r.model.position,
                    expectedPoints: Math.round(r.expectedPoints * 100) / 100,
                    value: Math.round(r.value * 100) / 100,
                    p12: Math.round(r.probabilities[12] * 1000) / 1000
                }))
            }, null, 2));
            return;
        }
        case "ff-run": {
            const configPath = process.argv[3];
            if (!configPath) {
                throw new Error("ff-run requires a config JSON: pmt ff-run <config.json> [--auto]");
            }
            if (process.argv.includes("--auto"))
                throw new Error("Automatic execution is paused; use action preview, human approval, and action-execute after live write validation.");
            const autoApproveLowRisk = false;
            const config = JSON.parse(await readFile(configPath, "utf8"));
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const queue = new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
            const result = await runOrchestrator({
                input: config.input,
                priors: config.priors,
                observations: config.observations,
                queue,
                autoApproveLowRisk
            });
            console.log(JSON.stringify({
                team: result.teamId,
                lineupExpectedPoints: Math.round(result.lineupExpectedPoints * 100) / 100,
                starters: result.lineup.map((s) => s.playerId),
                waiverCandidates: result.waiverCandidates.length,
                tradeCandidates: result.tradeCandidates.length,
                executed: result.executed.map((a) => a.type),
                queuedForApproval: result.queued.map((q) => ({ actionId: q.actionId, type: q.action.type, risk: q.risk }))
            }, null, 2));
            return;
        }
        case "action-queue": {
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const queue = new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
            const pending = await queue.pending();
            console.log(JSON.stringify({
                pending: pending.length,
                actions: pending.map((q) => ({
                    actionId: q.actionId,
                    type: q.action.type,
                    risk: q.risk,
                    rationale: q.rationale,
                    expiresAt: q.expiresAt
                }))
            }, null, 2));
            return;
        }
        case "action-approve": {
            const actionId = process.argv[3];
            if (!actionId)
                throw new Error("action-approve requires an action id: pmt action-approve <actionId>");
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const queue = new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
            const approved = await queue.approve(actionId, process.env.PMT_ACTION_ACTOR ?? "cli-operator");
            console.log(JSON.stringify({ actionId: approved.actionId, status: approved.status }, null, 2));
            return;
        }
        case "action-reject": {
            const actionId = process.argv[3];
            if (!actionId)
                throw new Error("action-reject requires an action id: pmt action-reject <actionId>");
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const queue = new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
            const rejected = await queue.reject(actionId, process.env.PMT_ACTION_ACTOR ?? "cli-operator");
            console.log(JSON.stringify({ actionId: rejected.actionId, status: rejected.status }, null, 2));
            return;
        }
        case "action-execute": {
            if (process.env.PMT_EXECUTION_ENABLED !== "true")
                throw new Error("Execution is paused. Set PMT_EXECUTION_ENABLED=true only after a human-reviewed live write canary.");
            const actionId = process.argv[3];
            if (!actionId)
                throw new Error("action-execute requires an action id: pmt action-execute <actionId>");
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            const leagueExternalId = process.argv[4] ?? process.env.ESPN_LEAGUE_ID;
            const queue = new ActionQueue(new SqliteActionQueueStore(join(dataDir, "pmt.sqlite")));
            const reader = new EspnPlatformReader();
            const writer = new EspnPlatformWriter();
            const executor = new ActionExecutor({
                queue,
                reader,
                writer,
                store: new SqliteActionExecutionStore(join(dataDir, "pmt.sqlite")),
                leagueExternalId
            });
            console.log(JSON.stringify(await executor.execute(actionId, { leagueExternalId }), null, 2));
            return;
        }
        case "razzball-login": {
            await runRazzballLogin();
            return;
        }
        case "season-refresh": {
            const positionals = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
            const season = positionals[0];
            const weekArg = positionals[1];
            const week = weekArg ? Number(weekArg) : undefined;
            const force = process.argv.includes("--force");
            const summary = await runSeasonRefresh({ season, week, force });
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        case "daemon": {
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            await mkdir(dataDir, { recursive: true });
            const scheduler = new InMemoryScheduler(() => new Date(), 60_000, true);
            const jobs = registerSeasonJobs(scheduler, buildSeasonJobDeps(dataDir));
            scheduler.start();
            console.log(JSON.stringify({
                message: "Pardon My Trade season daemon running (Ctrl+C to stop).",
                dataDir,
                jobs: jobs.map((job) => ({ jobId: job.jobId, name: job.name, time: job.time, days: job.days }))
            }, null, 2));
            if (process.argv.includes("--run-now")) {
                await runDailySeasonJob(buildSeasonJobDeps(dataDir));
            }
            const shutdown = () => {
                scheduler.stop();
                process.exit(0);
            };
            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);
            return;
        }
        case "projections": {
            await runProjectionsCommand(process.argv.slice(3));
            return;
        }
        case "draft-pick": {
            const args = process.argv.slice(3);
            const positional = args.filter((a) => !a.startsWith("--"));
            const [roundStr, roundPickStr, teamId, playerExternalId] = positional;
            const round = Number(roundStr);
            const roundPick = Number(roundPickStr);
            if (!round || !roundPick || !teamId || !playerExternalId) {
                throw new Error("usage: pmt draft-pick <round> <roundPick> <teamId> <playerExternalId> [--pickNo N]");
            }
            const pickNoArg = args.find((a) => a.startsWith("--pickNo"));
            const pickNo = pickNoArg ? Number(pickNoArg.split("=")[1]) : undefined;
            const session = new DraftSession({ manualStoragePath: resolveDraftStore() });
            const event = session.recordManualPick({ round, roundPick, teamId, playerExternalId, pickNo });
            console.log(JSON.stringify(event));
            return;
        }
        case "draft-harness": {
            const config = createDefaultConfig();
            const snapshot = await loadFixtureSnapshotSource(config.fixturePath);
            const dataDir = process.env.PMT_DATA_DIR ?? join(process.cwd(), "data");
            await mkdir(dataDir, { recursive: true });
            const draftConfig = {
                format: config.draft.format,
                teams: config.draft.teams,
                myTeamId: config.draft.myTeamId,
                draftPosition: config.draft.draftPosition
            };
            let client;
            if (config.draft.feed === "espn" && config.draft.espnDraftId) {
                try {
                    client = new EspnPlatformClient({ credentials: loadEspnCredentials() });
                }
                catch {
                    client = undefined;
                }
            }
            const controller = new DraftController({
                snapshot,
                config: draftConfig,
                dataDir,
                espnDraftId: config.draft.feed === "espn" ? config.draft.espnDraftId : undefined,
                client,
                intervalMs: config.draft.pollMs,
                onSnapshot: (snap) => hub?.broadcast(snap)
            });
            await controller.init();
            const repository = new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.sqlite") });
            const v1Store = new SqliteV1Store({ filePath: join(dataDir, "pmt.sqlite") });
            const ruleEngine = new ScoringRuleEngine();
            const decisionEngine = new DefaultDecisionEngine(ruleEngine);
            const recommendationEngine = new DefaultRecommendationEngine(ruleEngine);
            const newsPath = process.env.PMT_NEWS_PATH ?? "tests/fixtures/sample-news.json";
            const server = createApiServer({
                repository,
                v1Store,
                refresh: () => runRefresh({
                    fixturePath: config.fixturePath,
                    newsPath,
                    leagueExternalId: "pmt-demo-football",
                    teamExternalId: "team-001",
                    repository,
                    v1Store,
                    ruleEngine,
                    decisionEngine,
                    recommendationEngine,
                    notificationProviders: [new ConsoleNotificationProvider()]
                }),
                initialSnapshot: snapshot,
                draft: controller
            });
            const port = Number(process.env.PMT_PORT ?? 3000);
            const hub = attachDraftWebSocket(server, controller);
            controller.startWatching();
            server.listen(port, () => {
                console.log(`Pardon My Trade draft harness running at http://localhost:${port}/draft`);
                console.log(`Feed: ${config.draft.feed}${config.draft.espnDraftId ? ` (espn ${config.draft.espnDraftId})` : ""} | seat ${draftConfig.draftPosition} of ${draftConfig.teams}`);
            });
            const shutdown = () => {
                hub?.close();
                controller.stopWatching();
                process.exit(0);
            };
            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);
            await new Promise(() => { });
            return;
        }
        case "draft-watch": {
            const args = process.argv.slice(3);
            const intervalMs = Number(getArg(args, "--interval-ms", "15000"));
            const espnDraftId = getArg(args, "--espn-draft-id");
            const once = args.includes("--once");
            const asJson = args.includes("--json");
            let client;
            if (espnDraftId) {
                try {
                    client = new EspnPlatformClient({ credentials: loadEspnCredentials() });
                }
                catch {
                    client = undefined;
                }
            }
            const session = new DraftSession({
                intervalMs,
                espnDraftId,
                client,
                manualStoragePath: resolveDraftStore(),
                onPick: (picks) => {
                    if (asJson) {
                        console.log(JSON.stringify(picks));
                    }
                    else {
                        for (const p of picks)
                            console.log(formatPick(p));
                    }
                }
            });
            if (once) {
                const picks = await session.pollOnce();
                console.log(asJson ? JSON.stringify(picks) : picks.map(formatPick).join("\n"));
                return;
            }
            console.log(`Watching draft via ${session.feedName}. Ctrl-C to stop.`);
            session.startWatching();
            const stop = () => {
                session.stopWatching();
                process.exit(0);
            };
            process.on("SIGINT", stop);
            process.on("SIGTERM", stop);
            await new Promise(() => { });
            return;
        }
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}
/**
 * Wire the in-season scheduled jobs (doc 21 Phase 3) to the real pipeline:
 * projections -> news/injuries -> orchestrator -> notifications. Shared SQLite
 * handles are reused when `serve` already opened them.
 */
function buildSeasonJobDeps(dataDir, shared) {
    const config = createDefaultConfig();
    const repository = shared?.repository ?? new SqliteKnowledgeRepository({ filePath: join(dataDir, "pmt.sqlite") });
    const v1Store = shared?.v1Store ?? new SqliteV1Store({ filePath: join(dataDir, "pmt.sqlite") });
    const ruleEngine = new ScoringRuleEngine();
    const decisionEngine = new DefaultDecisionEngine(ruleEngine);
    const recommendationEngine = new DefaultRecommendationEngine(ruleEngine);
    const newsPath = process.env.PMT_NEWS_PATH ?? "tests/fixtures/sample-news.json";
    const providers = [
        new ConsoleNotificationProvider(),
        new FileNotificationProvider(join(dataDir, "notifications.log"))
    ];
    return {
        dataDir,
        refresh: () => refreshConfiguredLeague({
            repository,
            v1Store,
            ruleEngine,
            decisionEngine,
            recommendationEngine,
            notificationProviders: providers
        }),
        seasonRefresh: (options) => runSeasonRefresh({ ...options, repository }),
        orchestrate: (options) => runSeasonOrchestration({ ...options, repository }),
        notify: async (notifications) => {
            for (const notification of notifications) {
                await v1Store.saveNotification(notification);
                for (const provider of providers) {
                    await provider.send(notification);
                }
            }
        },
        log: (result) => {
            console.log(JSON.stringify(result));
        }
    };
}
function resolveDraftStore() {
    return process.env.PMT_DRAFT_STORE ?? join(process.cwd(), ".pmt", "draft-manual.jsonl");
}
function getArg(args, flag, fallback) {
    const hit = args.find((a) => a === flag || a.startsWith(`${flag}=`));
    if (!hit)
        return fallback;
    if (hit.includes("="))
        return hit.split("=")[1];
    return fallback;
}
function formatPick(p) {
    return `pick ${p.pickNo} (r${p.round}.${p.roundPick}) team=${p.teamId} player=${p.playerExternalId} via=${p.source}`;
}
function printHelp() {
    console.log(`Pardon My Trade CLI

Usage:
  pmt help
  pmt version
  pmt doctor --platform espn --read-only
  pmt import-fixture
  pmt weekly-report [leagueExternalId] [teamExternalId]
  pmt add-drop-eval [leagueExternalId] [teamExternalId]
  pmt refresh [leagueExternalId] [teamExternalId]
  pmt import-sleeper <sleeperLeagueId> [season]
  pmt import-espn <espnLeagueId> [season] [teamId]
  pmt build-models <priors.json> [observations.json]
  pmt ff-run <config.json> [--auto]
  pmt action-queue
  pmt action-approve <actionId>
  pmt action-reject <actionId>
  pmt action-execute <actionId> [leagueExternalId]
  pmt razzball-login
  pmt season-refresh [season] [week] [--force]
  pmt projections <razzball|razzball-premium|fftoday|espn> <position> [--week N] [--auto] [--ppr] [--force] [--no-save] [--persist] [--max N]
  pmt projections --clear-cache
  pmt projections --cache-stats
  pmt daemon [--run-now]
  pmt serve [--scheduler]
  pmt draft-pick <round> <roundPick> <teamId> <playerExternalId> [--pickNo N]
  pmt draft-watch [--espn-draft-id ID] [--interval-ms N] [--once] [--json]
  pmt draft-harness [--scheduler]

V1 adds scheduled refresh, news ingestion, injury alerts, projection
consensus, manager profiles, historical tracking, and notifications,
surfaced through a local web GUI (pmt serve).

DraftKat (feature/DraftKat) adds the ESPN read/write adapter, a
probabilistic Bayesian player-model engine (plan Open Claw Agent Fantasy
section 5), and the FF_Orchestrator agent with a human-approval action
queue for high-risk moves (trades, drops). Live ESPN logins require
ESPN_LEAGUE_ID (+ ESPN_S2, SWID) in the environment.

The in-season loop (pmt daemon, or pmt serve --scheduler) runs the daily
projection pull + advisory pass Mon-Sat, a Sunday lineup-lock reminder, and
a Tuesday waiver/trade sweep. Jobs pause automatically in the offseason and
  never execute a move. Explicitly approved actions can be executed through
  pmt action-execute, which revalidates state and records an audit receipt.
`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});

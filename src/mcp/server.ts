import { readWaiverContext, prepareWaiverClaim } from "./waiver-context.js";
import { pendingActionPage } from "./action-context.js";
import { runKickoffReview, finalizeKickoffReport, kickoffSchedule, scheduleKickoffReviews, prepareKickoffLineup } from "./kickoff-review.js";
import type { KickoffSource } from "../adapters/espn/kickoff-source.js";
import { buildEspnLineupTransaction } from "../adapters/espn/espn-platform-writer.js";
import { startScoutingReport, getScoutingReport, startModelEvaluation, getModelEvaluation, archivePregameForecasts, getForecastArchives } from "./scout-workflow.js";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { ActionExecutor, rosterFingerprint, SqliteActionExecutionStore, type ActionExecutionStore } from "../agents/action-executor.js";
import { ActionQueue, SqliteActionQueueStore } from "../agents/action-queue.js";
import type { QueuedAction } from "../agents/types.js";
import { buildPriorsFromSnapshot, buildSnapshotEnqueueOptions } from "../agents/snapshot-integration.js";
import { buildModelsForOrchestrator, runOrchestrator } from "../agents/ff-orchestrator.js";
import type { PlatformReader } from "../adapters/platform-reader.js";
import { EspnPlatformReader } from "../adapters/espn/espn-platform-reader.js";
import { EspnPlatformWriter } from "../adapters/espn/espn-platform-writer.js";
import type { PlatformWriter } from "../adapters/platform-writer.js";
import { SqliteV1Store } from "../history/sqlite-v1-store.js";
import type { V1Store } from "../history/v1-store.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { LeagueSnapshot } from "../models/types.js";
import { EspnNewsSource } from "../news/espn-news-source.js";
import { RazzballNewsSource } from "../news/razzball-news-source.js";
import type { NewsSource } from "../news/news-source.js";
import { buildNewsContext, buildInjuryContext, readPersistedNews, type NewsContextInput } from "./news-context.js";
import { evaluatePredictions, type PredictionObservation } from "../projections/performance.js";
import { runSeasonRefresh } from "../season-refresh.js";
import { getCurrentScoringPeriod, isOffseason, weekFromScoringPeriod } from "../seasons/nfl-calendar.js";
import { JsonModelStore } from "../probabilistic/model-store.js";
import { updatePostWeekOutcomes } from "../probabilistic/model-governance.js";
import {
  PMT_MCP_CONTRACT_VERSION,
  PMT_MCP_SERVER_VERSION,
  PMT_MCP_TOOL_NAMES,
  type PmtMcpEnvelope,
  type PmtMcpToolName
} from "./contracts.js";

import { resolveRuntimeModels, buildRosterAnalytics, simulateFreeAgentScenario } from "../application/roster-analytics.js";
import { loadRuntimeConfig, prepareRuntimeStorage } from "../config/runtime-config.js";
import { configuredReader, getConfiguredSnapshot, refreshConfiguredLeague } from "../application/live-refresh.js";
import { ScoringRuleEngine } from "../rules/rule-engine.js";
import { DefaultDecisionEngine } from "../decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "../recommendations/recommendation-engine.js";

export type PmtMcpRole = "read" | "operator";
export function resolveMcpRole(value = process.env.PMT_MCP_ROLE ?? "read"): PmtMcpRole {
  if (value !== "read" && value !== "operator") throw new Error("PMT_MCP_ROLE must be read or operator.");
  return value;
}

const completedWeeklyObservationSchema = z.object({
  playerId: z.string().min(1),
  season: z.string().optional(),
  week: z.number().int().min(1).max(18),
  scoringPeriod: z.string().min(1),
  points: z.number(),
  observedAt: z.string().datetime(),
  predictions: z.array(z.object({
    source: z.string().min(1),
    predicted: z.number(),
    asOf: z.string().datetime().optional()
  })).optional()
});

export interface PmtMcpDependencies {
  readonly dataDir: string;
  readonly reader: PlatformReader;
  readonly repository: KnowledgeRepository;
  readonly v1Store: V1Store;
  readonly actionQueue: ActionQueue;
  readonly writer?: PlatformWriter;
  readonly executionStore?: ActionExecutionStore;
  readonly actionExecutor?: ActionExecutor;
  readonly clock?: () => Date;
  readonly teamId?: string;
  readonly leagueExternalId?: string;
  readonly syncSnapshot?: () => Promise<Record<string, unknown>>;
  readonly loadSnapshot?: () => Promise<LeagueSnapshot>;
  readonly kickoffSource?: KickoffSource;
}

export interface PmtMcpServerOptions {
  readonly deps: PmtMcpDependencies;
  readonly role?: PmtMcpRole;
  readonly name?: string;
  readonly version?: string;
}

export async function createDefaultPmtMcpDependencies(
  dataDir = process.env.PMT_DATA_DIR ?? "data",
  role: PmtMcpRole = resolveMcpRole()
): Promise<PmtMcpDependencies> {
  const config = loadRuntimeConfig({ ...process.env, dataDir });
  await mkdir(dataDir, { recursive: true });
  await prepareRuntimeStorage(config);
  const reader = configuredReader(config);
  const actionQueue = new ActionQueue(new SqliteActionQueueStore(config.databasePath));
  const executionStore = new SqliteActionExecutionStore(config.databasePath);
  const repository = new (await import("../knowledge/sqlite-knowledge-repository.js")).SqliteKnowledgeRepository({ filePath: config.databasePath });
  const v1Store = new SqliteV1Store({ filePath: config.databasePath });
  const writer = role === "operator" && config.platform === "espn" && process.env.PMT_EXECUTION_ENABLED === "true"
    ? new EspnPlatformWriter({ credentials: { leagueId: config.leagueExternalId, season: config.season, espnS2: process.env.ESPN_S2, swid: process.env.SWID } }) : undefined;
  const ruleEngine = new ScoringRuleEngine();
  return { dataDir, reader, repository, v1Store, actionQueue, executionStore, writer,
    teamId: config.teamExternalId, leagueExternalId: config.leagueExternalId,
    loadSnapshot: async () => { const snapshot = await getConfiguredSnapshot(repository, config); if (!snapshot) throw new Error("No snapshot for the configured league. Run pmt refresh first."); return snapshot; },
    syncSnapshot: async () => ({ ...await refreshConfiguredLeague({ repository, v1Store, ruleEngine,
      decisionEngine: new DefaultDecisionEngine(ruleEngine), recommendationEngine: new DefaultRecommendationEngine(ruleEngine) }, config) }),
    actionExecutor: writer ? new ActionExecutor({ queue: actionQueue, reader, writer, store: executionStore, leagueExternalId: config.leagueExternalId }) : undefined,
    clock: () => new Date() };
}

export function createPmtMcpServer(options: PmtMcpServerOptions): McpServer {
  const deps = options.deps;
  const role = options.role ?? "read";
  const clock = deps.clock ?? (() => new Date());
  const server = new McpServer({
    name: options.name ?? "pardon-my-trade",
    version: options.version ?? PMT_MCP_SERVER_VERSION
  });

  const register = <Args extends ZodRawShape>(
    name: PmtMcpToolName,
    description: string,
    inputSchema: Args,
    handler: (input: z.infer<z.ZodObject<Args>>) => Promise<Record<string, unknown>>
  ): void => {
    if (role !== "operator" && ["pmt_prepare_kickoff_lineup", "pmt_prepare_lineup", "pmt_prepare_add_drop", "pmt_prepare_waiver_claim", "pmt_action_approve", "pmt_action_reject", "pmt_action_execute"].includes(name)) return;
    const callback = (async (input: z.infer<z.ZodObject<Args>>) => {
      try {
        const request = input as Record<string, unknown>;
        if (deps.leagueExternalId && typeof request.leagueId === "string" && request.leagueId !== deps.leagueExternalId) throw new Error("Requested league differs from the configured connection.");
        if (deps.teamId && name === "pmt_run_advisory_orchestration" && typeof request.teamId === "string" && request.teamId !== deps.teamId) throw new Error("Advisory team differs from the configured team.");
        return toolSuccess(name, await handler(input as z.infer<z.ZodObject<Args>>), clock);
      } catch (error) {
        return toolFailure(name, error, clock);
      }
    }) as unknown as ToolCallback<Args>;
    // The SDK supports multiple Zod major versions; PMT pins the runtime
    // dependency and keeps this cast at the single registration boundary.
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: !["pmt_prepare_kickoff_lineup", "pmt_schedule_kickoff_reviews", "pmt_run_kickoff_review", "pmt_archive_pregame_forecasts", "pmt_start_model_evaluation", "pmt_generate_scout_report", "pmt_prepare_lineup", "pmt_prepare_add_drop", "pmt_prepare_waiver_claim", "pmt_refresh_projections", "pmt_run_projection_refresh", "pmt_run_news_injury_refresh", "pmt_run_advisory_orchestration", "pmt_sync_league", "pmt_action_approve", "pmt_action_reject", "pmt_action_execute", "pmt_rebuild_models", "pmt_update_post_week_outcomes"].includes(name),
        destructiveHint: name === "pmt_action_execute",
        idempotentHint: !["pmt_run_kickoff_review", "pmt_run_advisory_orchestration", "pmt_rebuild_models", "pmt_update_post_week_outcomes", "pmt_run_news_injury_refresh", "pmt_action_execute"].includes(name),
        openWorldHint: name.includes("espn") || name.includes("news") || name.includes("projection")
      }
    }, callback as never);
  };

  register("pmt_archive_pregame_forecasts","Save existing candidate forecasts and model weights in an immutable archive before the first weekly kickoff. Rejects late snapshots; never promotes models.",{week:z.number().int().min(1).max(18)},async(input)=>{if(deps.leagueExternalId!=="98806880"||deps.teamId!=="7")throw new Error("Archive scope mismatch.");return archivePregameForecasts(input.week);});
  register("pmt_get_nfl_kickoff_schedule", "Return verified published NFL game groups, DST-correct T-60 timestamps and self-contained Luna/xhigh job prompts. Does not schedule or send messages.", { season: z.string().regex(/^20\d{2}$/), nflWeek: z.number().int().min(1).max(18) }, async input => kickoffSchedule(input.season, input.nflWeek, clock(), deps.kickoffSource));
  register("pmt_schedule_kickoff_reviews", "Reconcile installed league 98806880/team 7 T-60 Hermes jobs from the published schedule. Uses the Tuesday parent's existing weekly-thread destination and user-installed Luna/xhigh policy. No arbitrary destination/model, platform action, or immediate message delivery. Preserves history and pauses only obsolete future groups.", { season: z.string().regex(/^20\d{2}$/), nflWeek: z.number().int().min(1).max(18) }, async input => scheduleKickoffReviews(deps, input.season, input.nflWeek));
  register("pmt_prepare_kickoff_lineup", "Queue only the exact complete eligible lineup from an unexpired kickoff report. Rechecks current ESPN scope/period, roster fingerprint, locks and eligibility. Deterministic idempotency; no player arguments, approval or platform submission.", { reportId: z.string().regex(/^[a-f0-9]{64}$/) }, async input => prepareKickoffLineup(deps, input.reportId));
  register("pmt_run_kickoff_review", "Run one bounded T-60 workflow: fresh league/roster/projections, published game scope, live game injuries, individual player news, deterministic legal owned lineup and named changes. Persists a report; no platform writes, queue mutations, terminal approval or broad orchestration.", { season: z.string().regex(/^20\d{2}$/), nflWeek: z.number().int().min(1).max(18), kickoff: z.string().datetime({ offset: true }) }, async input => runKickoffReview(deps, input, deps.kickoffSource));
  register("pmt_finalize_kickoff_report", "Render a complete named kickoff report. Optional exact actionId is verified against scope, full recommended lineup, execution receipt, audit and fresh roster. Return report verbatim. Never submits or retries a move.", { reportId: z.string().regex(/^[a-f0-9]{64}$/), actionId: z.string().min(1).optional() }, async input => finalizeKickoffReport(deps, input.reportId, input.actionId));
  register("pmt_get_forecast_archives","List and integrity-check immutable pregame forecast archives without exposing weights or credentials.",{},async()=>getForecastArchives());
  register("pmt_start_model_evaluation","Start a current-season causal replay and scoring audit with roster/top50/top150 uncertainty plots. No roster writes or model promotion.",{},async()=>{if(deps.leagueExternalId!=="98806880"||deps.teamId!=="7")throw new Error("Evaluation scope mismatch.");return startModelEvaluation();});
  register("pmt_get_model_evaluation","Read model-performance audit progress, cohort metrics, scoring warnings and artifact paths.",{},async()=>getModelEvaluation());
  register("pmt_generate_scout_report", "Start current/next-week candidate models and HTML/Markdown scouting report. Read ESPN only; never executes roster actions. Poll pmt_get_scout_report for completion.", { week: z.number().int().min(1).max(18), asOf: z.string().datetime().optional() }, async (input) => {
    if (deps.leagueExternalId !== "98806880" || deps.teamId !== "7") throw new Error("Weekly scout workflow requires the configured league/team scope.");
    return startScoutingReport(input.week,input.asOf);
  });
  register("pmt_get_scout_report", "Read weekly workflow status, model summary, degradation and artifact paths.", { week:z.number().int().min(1).max(18) }, async(input)=>getScoutingReport(input.week));

  register("pmt_sync_league", "Refresh and persist the configured live league through a durable leased job. Never submits transactions.", {}, async () => {
    if (!deps.syncSnapshot) throw new Error("League sync is not configured for this server.");
    return { refresh: await deps.syncSnapshot() };
  });
  register("pmt_get_roster_analytics", "Return current roster and fixed-lineup forecast distributions with coverage and modeling assumptions.",
    { period: z.string().optional(), samples: z.number().int().min(100).max(10000).optional() }, async input => {
      const snapshot = await loadSnapshot(deps);
      const team = deps.teamId;
      if (!team) throw new Error("Configure an explicit PMT team.");
      return { analytics: await buildRosterAnalytics(snapshot, team, { ...input, dataDir: deps.dataDir }) };
    });
  register("pmt_compare_free_agent", "Simulate a hypothetical add/drop with paired outcomes and legally optimized fixed lineups. Never submits a move.",
    { addPlayerId: z.string().min(1), dropPlayerId: z.string().min(1).optional(), period: z.string().optional(), samples: z.number().int().min(100).max(10000).optional() }, async input => {
      const snapshot = await loadSnapshot(deps);
      if (!deps.teamId) throw new Error("Configure an explicit PMT team.");
      return { scenario: await simulateFreeAgentScenario(snapshot, deps.teamId, { ...input, dataDir: deps.dataDir }) };
    });

  register(
    "pmt_get_current_scoring_period",
    "Resolve the PMT scoring period and offseason state from the NFL calendar.",
    { season: z.string().optional(), at: z.string().datetime().optional() },
    async (input) => {
      const now = input.at ? new Date(input.at) : clock();
      const scoringPeriod = getCurrentScoringPeriod(now, input.season);
      return {
        scoring_period: scoringPeriod,
        week: weekFromScoringPeriod(scoringPeriod) ?? null,
        season: input.season ?? scoringPeriod.slice(0, 4),
        offseason: isOffseason(now),
        evaluated_at: now.toISOString()
      };
    }
  );

  register(
    "pmt_get_inseason_status",
    "Return the imported league/team context and current in-season status without making a league change.",
    { leagueId: z.string().optional(), teamId: z.string().optional(), season: z.string().optional() },
    async (input) => {
      const snapshot = await loadSnapshot(deps);
      const teamId = input.teamId ?? deps.teamId;
      const team = snapshot.league.teams.find((candidate) => candidate.team_id === teamId || candidate.external_id === teamId);
      return {
        league: {
          league_id: snapshot.league.league_id,
          external_id: snapshot.league.external_id,
          name: snapshot.league.name,
          platform: snapshot.league.platform,
          season: snapshot.league.season
        },
        snapshot_id: snapshot.snapshot_id,
        team: team ? { team_id: team.team_id, name: team.name, manager_id: team.manager_id } : null,
        requested_league_id: input.leagueId ?? null,
        requested_season: input.season ?? null,
        scoring_period: getCurrentScoringPeriod(clock(), input.season ?? snapshot.league.season),
        offseason: isOffseason(clock())
      };
    }
  );

  register(
    "pmt_espn_read_league",
    "Read the canonical ESPN league, settings, teams, schedule, and waiver/trade configuration.",
    { leagueId: z.string().min(1), season: z.string().optional() },
    async (input) => ({ league: await deps.reader.getLeague(input.leagueId, input.season ?? String(new Date().getFullYear())) })
  );

  register(
    "pmt_espn_read_rosters",
    "Read one ESPN roster or all team rosters in the league.",
    { leagueId: z.string().min(1), teamId: z.string().optional() },
    async (input) => {
      const freshReader = deps.reader as PlatformReader & { getLeagueFresh?: () => Promise<unknown> };
      if (freshReader.getLeagueFresh) await freshReader.getLeagueFresh();
      return input.teamId
        ? { rosters: [{ team_id: input.teamId, roster: await deps.reader.getRoster(input.leagueId, input.teamId) }] }
        : { teams: await deps.reader.getTeams(input.leagueId) };
    }
  );

  register(
    "pmt_espn_read_schedule",
    "Read ESPN matchup schedule and scoring-period results.",
    { leagueId: z.string().min(1) },
    async (input) => ({ schedule: await deps.reader.getSchedule(input.leagueId) })
  );

  register(
    "pmt_espn_read_transactions",
    "Read ESPN transaction history since an optional ISO timestamp.",
    { leagueId: z.string().min(1), since: z.string().datetime().optional() },
    async (input) => ({ transactions: await deps.reader.getTransactions(input.leagueId, input.since) })
  );

  register(
    "pmt_espn_read_players",
    "Read ESPN player metadata for a sport and season.",
    { sport: z.string().default("football"), season: z.string().optional() },
    async (input) => ({ players: await deps.reader.getPlayers(input.sport, input.season ?? String(new Date().getFullYear())) })
  );

  register(
    "pmt_espn_read_free_agents",
    "Read ESPN free agents for a league.",
    { leagueId: z.string().min(1) },
    async (input) => ({ free_agents: await deps.reader.getFreeAgents(input.leagueId) })
  );

  const refreshProjections = async (input: {
    season?: string;
    week?: number;
    force?: boolean;
    sources?: string;
  }): Promise<Record<string, unknown>> => {
    const sync = deps.syncSnapshot ? await deps.syncSnapshot() : undefined;
    return { sync, refresh: await runSeasonRefresh({
      repository: deps.repository,
      dataDir: deps.dataDir,
      season: input.season,
      week: input.week,
      force: input.force,
      sources: input.sources
    }) };
  };

  register(
    "pmt_refresh_projections",
    "Refresh configured ESPN/Razzball/FFToday projections and rebuild deterministic PMT priors.",
    { season: z.string().optional(), week: z.number().int().min(1).max(18).optional(), force: z.boolean().optional(), sources: z.string().optional() },
    refreshProjections
  );
  register(
    "pmt_run_projection_refresh",
    "Run the in-season projection refresh step. This does not execute league actions.",
    { season: z.string().optional(), week: z.number().int().min(1).max(18).optional(), force: z.boolean().optional(), sources: z.string().optional() },
    refreshProjections
  );

  register(
    "pmt_get_projection_status",
    "Return stored projection counts and the latest available scoring periods.",
    { scoringPeriod: z.string().optional() },
    async (input) => {
      const periods = input.scoringPeriod ? [input.scoringPeriod] : await storedProjectionPeriods(deps.repository, await loadSnapshot(deps));
      const counts = await Promise.all(periods.map(async (period) => ({ scoring_period: period, count: (await deps.repository.getProjections(period, deps.leagueExternalId)).length })));
      return { periods: counts };
    }
  );

  register(
    "pmt_get_projection_provenance",
    "Return stored projections with source, scoring period, confidence, and player provenance.",
    { scoringPeriod: z.string().min(1), playerId: z.string().optional(), source: z.string().optional() },
    async (input) => ({
      projections: (await deps.repository.getProjections(input.scoringPeriod, deps.leagueExternalId)).filter((projection) =>
        (!input.playerId || projection.player_id === input.playerId) &&
        (!input.source || projection.source === input.source)
      )
    })
  );

  const newsContextSchema = {
    leagueId: z.string().min(1).optional(), teamId: z.string().min(1).optional(),
    playerIds: z.array(z.string().min(1)).max(500).optional(),
    candidatePlayerIds: z.array(z.string().min(1)).max(500).optional(),
    since: z.string().datetime().optional(), until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    maxChars: z.number().int().min(2048).max(64000).optional()
  };
  const newsScope = (input: NewsContextInput): NewsContextInput => ({
    ...input, teamId: input.teamId ?? (input.playerIds !== undefined ? undefined : deps.teamId)
  });
  register(
    "pmt_run_news_injury_refresh",
    "Fetch once from ESPN/Razzball and persist ALL fetched items; return a compact bounded persisted-news page. Defaults to configured roster plus candidatePlayerIds and last 7 days. Continue using pmt_list_news/next_cursor. maxChars bounds JSON data, not the common MCP envelope. Source completeness is unknown; external text is untrusted.",
    { ...newsContextSchema, sources: z.string().max(80).optional() },
    async (input) => {
      const snapshot = await loadSnapshot(deps);
      const scoped = newsScope(input);
      // Validate scope/window/budget before fetching or persisting anything.
      buildNewsContext(snapshot, [], scoped, clock());
      const leagueId = snapshot.league.league_id;
      const sourceNames = new Set((input.sources ?? "espn,razzball").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
      if (!sourceNames.size || [...sourceNames].some(name => !["espn", "razzball"].includes(name))) throw new Error("News sources must be espn and/or razzball.");
      const nameMap = new Map<string, string>();
      for (const player of [...snapshot.players, ...snapshot.free_agents]) {
        nameMap.set(normalizeName(player.full_name), player.player_id);
      }
      const sources: Array<[string, NewsSource]> = [];
      if (sourceNames.has("espn")) sources.push(["espn", new EspnNewsSource()]);
      if (sourceNames.has("razzball")) sources.push(["razzball", new RazzballNewsSource({ playerIdsByName: nameMap })]);
      const counts: Record<string, number> = {};
      const degraded: Record<string, string> = {};
      const items = [];
      for (const [name, source] of sources) {
        try {
          const rows = await source.fetchNews(leagueId, input.since);
          counts[name] = rows.length;
          if (rows.length === 0) degraded[name] = "Empty, unavailable, or unmappable; not evidence of no news.";
          items.push(...rows);
        } catch {
          counts[name] = 0;
          degraded[name] = "Source failed; coverage unknown.";
        }
      }
      if (items.length > 0) await deps.v1Store.saveNews(leagueId, items);
      return buildNewsContext(snapshot, await readPersistedNews(deps.v1Store, snapshot), scoped, clock(), { league_id: leagueId, counts, degraded, ingested: items.length });
    }
  );

  register(
    "pmt_list_news",
    "Read compact persisted news, impact-first then recency. Defaults to configured roster and last 7 days; teamId includes all roster slots plus explicit candidatePlayerIds/playerIds. playerIds without teamId selects only those players. Canonical/external IDs resolve from snapshot; unknown coverage is not clearance. Repeat same scope with next_cursor; changed data requires restart. maxChars bounds JSON data excluding MCP envelope.",
    { ...newsContextSchema, leagueId: z.string().min(1), cursor: z.string().max(2048).optional() },
    async (input) => {
      const snapshot = await loadSnapshot(deps);
      const scoped = newsScope(input);
      buildNewsContext(snapshot, [], { ...scoped, cursor: undefined }, clock());
      return buildNewsContext(snapshot, await readPersistedNews(deps.v1Store, snapshot), scoped, clock());
    }
  );

  register(
    "pmt_list_injury_alerts",
    "Read compact, bounded snapshot injury alerts in exact roster/candidate scope; configured roster is default. Both status fields are checked. since/until mark freshness, never hide stale current injuries. Unknown or missing status is not clearance. maxChars bounds JSON data excluding MCP envelope. Continue with next_cursor.",
    { ...newsContextSchema, cursor: z.string().max(2048).optional() },
    async (input) => {
      const snapshot = await loadSnapshot(deps);
      return buildInjuryContext(snapshot, newsScope(input), clock());
    }
  );

  register(
    "pmt_list_notifications",
    "List persisted PMT notifications for a league.",
    { leagueId: z.string().min(1) },
    async (input) => ({ notifications: await deps.v1Store.getNotifications(input.leagueId) })
  );

  register(
    "pmt_run_advisory_orchestration",
    "Run deterministic lineup, waiver, and trade analysis with automatic league execution disabled.",
    { teamId: z.string().optional() },
    async (input) => {
      if (deps.syncSnapshot) await deps.syncSnapshot();
      const snapshot = await loadSnapshot(deps);
      const teamId = input.teamId ?? deps.teamId;
      if (!teamId) throw new Error("Configure an explicit team for advisory orchestration.");
      const priors = buildPriorsFromSnapshot(snapshot);
      const period = advisoryPeriod(snapshot, deps.teamId, clock());
      const models = await resolveRuntimeModels(snapshot, deps.dataDir, period);
      const selectedTeam = snapshot.league.teams.find(team => team.team_id === teamId || team.external_id === teamId);
      for (const slot of selectedTeam?.roster.starters ?? []) if (slot.player_id && !models.has(slot.player_id)) throw new Error(`Starter ${slot.player_id} is uncovered for ${period}; refresh projections before advice.`);
      const result = await runOrchestrator({
        input: (await import("../agents/snapshot-integration.js")).buildOrchestratorInputFromSnapshot(snapshot, teamId, models),
        priors,
        models,
        enqueueOptions: buildSnapshotEnqueueOptions(snapshot, period),
        queue: deps.actionQueue,
        autoApproveLowRisk: false,
        acquisitionStatus: deps.reader instanceof EspnPlatformReader
          ? async playerId => {
            const rules = (await deps.reader.getLeague(snapshot.league.external_id, snapshot.league.season)).waiver_settings;
            const status = await (deps.reader as EspnPlatformReader).getAcquisitionStatus(snapshot.league.external_id, playerId);
            // FAB claims need an explicit reviewed bid; never invent one in a sweep.
            return rules.type === "faab" && status === "WAIVERS" ? undefined : status;
          } : undefined
      });
      return {
        team_id: result.teamId,
        lineup: result.lineup,
        lineup_expected_points: result.lineupExpectedPoints,
        waiver_candidates: result.waiverCandidates,
        waiver_claims: result.waiverClaims ?? [],
        trade_candidates: result.tradeCandidates,
        queued: result.queued,
        executed: []
      };
    }
  );

  register("pmt_prepare_lineup", "Validate and queue one exact complete starter lineup for human approval. No ESPN write.",
    {leagueId:z.string().min(1),teamId:z.string().min(1),starters:z.array(z.object({playerId:z.string().regex(/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/),slot:z.enum(["QB","RB","WR","TE","FLEX","DST","K"])}))},async(input)=>{
      if(input.teamId!==deps.teamId||input.leagueId!==deps.leagueExternalId)throw new Error("Requested lineup differs from configured scope.");
      const reader=deps.reader as EspnPlatformReader;if(typeof reader.getLeagueFresh!=="function")throw new Error("Fresh ESPN lineup validation unavailable.");
      const fresh=await reader.getLeagueFresh();const team=fresh.teams?.find(t=>String(t.id)===input.teamId);
      const body=buildEspnLineupTransaction({type:"set_roster",teamId:input.teamId,starters:input.starters},"validation-only",fresh.scoringPeriodId!,team?.roster?.entries as Parameters<typeof buildEspnLineupTransaction>[3]??[],fresh.settings?.rosterSettings?.lineupSlotCounts??{});
      const roster=await deps.reader.getRoster(input.leagueId,input.teamId);
      const action=await deps.actionQueue.enqueue({type:"set_roster",teamId:input.teamId,starters:input.starters},"low","Human-requested exact starter lineup",{ttlMs:30*60*1000,preconditions:{leagueExternalId:input.leagueId,scoringPeriod:`${fresh.seasonId}-W${fresh.scoringPeriodId}`,expectedRosterHashes:{[input.teamId]:rosterFingerprint(roster)}}});
      return {action,changes:body.items,execution_allowed:false,note:"Legal slots and locks validated; exact human approval and separate execution required."};
    });

  register(
    "pmt_prepare_add_drop",
    "Validate and queue exactly one requested add/drop for human review. Never approves or submits it; free agents and waivers are rechecked at execution.",
    { leagueId: z.string().min(1), teamId: z.string().min(1), addPlayerId: z.string().regex(/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/), dropPlayerId: z.string().regex(/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/) },
    async (input) => {
      if (!deps.teamId || input.teamId !== deps.teamId) throw new Error("Requested team differs from the configured connection.");
      if (input.addPlayerId === input.dropPlayerId) throw new Error("Add and drop must be distinct players.");
      const freshReader = deps.reader as PlatformReader & { getLeagueFresh?: () => Promise<{ scoringPeriodId?: number; seasonId?: number }>; getAcquisitionStatus?: (leagueId: string, playerId: string) => Promise<string | undefined> };
      if (!freshReader.getLeagueFresh) throw new Error("Fresh ESPN acquisition preflight is unavailable.");
      const fresh = await freshReader.getLeagueFresh();
      if (!fresh.seasonId || !fresh.scoringPeriodId) throw new Error("Current ESPN scoring period is unavailable.");
      const roster = await deps.reader.getRoster(input.leagueId, input.teamId);
      const slots = [...roster.starters, ...roster.bench, ...roster.injured_reserve, ...roster.taxi];
      const drop = slots.find((slot) => slot.player_id === input.dropPlayerId);
      if (!drop || drop.locked) throw new Error("Drop player is not owned or is locked.");
      const freeAgents = await deps.reader.getFreeAgents(input.leagueId);
      const add = freeAgents.find((player) => player.player_id === input.addPlayerId);
      if (!add) throw new Error("Add player is not available in the current league.");
      if (!freshReader.getAcquisitionStatus || await freshReader.getAcquisitionStatus(input.leagueId, input.addPlayerId) !== "FREEAGENT") throw new Error("Player is not an immediate free agent; a separate waiver claim is required.");
      const action = { type: "add_drop" as const, teamId: input.teamId, addPlayerIds: [input.addPlayerId], dropPlayerIds: [input.dropPlayerId] };
      const pending = await deps.actionQueue.pending();
      const existing = pending.find((queued) => JSON.stringify(queued.action) === JSON.stringify(action) && Date.parse(queued.expiresAt) > clock().getTime());
      const queued = existing ?? await deps.actionQueue.enqueue(action, "high", `Human-requested add/drop: add ${add.full_name}; drop player ${input.dropPlayerId}.`, {
        ttlMs: 30 * 60 * 1000, preconditions: { leagueExternalId: input.leagueId, scoringPeriod: `${fresh.seasonId}-W${fresh.scoringPeriodId}`, expectedRosterHashes: { [input.teamId]: rosterFingerprint(roster) } }
      });
      return { action: queued, execution_allowed: false, note: "Pending human review. Confirm FREEAGENT versus WAIVERS before approving; no ESPN POST occurred." };
    }
  );

  register("pmt_espn_read_waivers", "Read fresh ESPN acquisition rules and selected team's league waiver rank. Claim preferences are separate from league order.",
    { leagueId: z.string().min(1), teamId: z.string().min(1) }, async input => {
      if (input.teamId !== deps.teamId) throw new Error("Requested waiver team differs from configured connection.");
      return readWaiverContext(deps.reader, input.leagueId, input.teamId);
    });
  register("pmt_prepare_waiver_claim", "Prepare one exact priority-ordered waiver claim for individual human approval. No ESPN write or reordering of existing ESPN claims.",
    { leagueId: z.string().min(1), teamId: z.string().min(1), addPlayerId: z.string().regex(/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/), dropPlayerId: z.string().regex(/^(?:[1-9]\d*|-160(?:0[1-9]|[12]\d|3[0-4]))$/).optional(), priority: z.number().int().min(1), faabBid: z.number().int().min(0).optional() }, async input => {
      if (input.teamId !== deps.teamId) throw new Error("Requested waiver team differs from configured connection.");
      const { leagueId, ...claim } = input;
      return prepareWaiverClaim(deps.reader, deps.actionQueue, leagueId, { type: "waiver_claim", ...claim });
    });

  register(
    "pmt_list_pending_actions",
    "List a compact paginated index of unexpired pending proposals. Filter league/team/period/type; get and preview exact actions before approval.",
    { leagueId:z.string().min(1).optional(), teamId:z.string().min(1).optional(), scoringPeriod:z.string().min(1).optional(), actionType:z.enum(["set_roster","add_drop","waiver_claim","propose_trade"]).optional(), limit:z.number().int().min(1).max(50).optional(), offset:z.number().int().min(0).optional() },
    async (input) => pendingActionPage(await deps.actionQueue.pending(),input,clock())
  );

  register(
    "pmt_get_action",
    "Read one queued action by ID.",
    { actionId: z.string().min(1) },
    async (input) => ({ action: await requireAction(deps.actionQueue, input.actionId) })
  );

  register(
    "pmt_preview_action",
    "Return a human-review preview of a queued action. This never calls ESPN.",
    { actionId: z.string().min(1) },
    async (input) => {
      const action = await requireAction(deps.actionQueue, input.actionId);
      return { action, execution_allowed: action.status === "approved", note: "Execution still revalidates current ESPN state and idempotency before POST." };
    }
  );

  register(
    "pmt_action_approve",
    "Mark a queued proposal approved for later operator handling. This does not execute a platform write.",
    { actionId: z.string().min(1), actor: z.string().min(1).optional() },
    async (input) => ({ action: await deps.actionQueue.approve(input.actionId, input.actor ?? "hermes-operator"), execution_allowed: false })
  );

  register(
    "pmt_action_reject",
    "Reject a queued proposal. This never calls ESPN.",
    { actionId: z.string().min(1), actor: z.string().min(1).optional() },
    async (input) => ({ action: await deps.actionQueue.reject(input.actionId, input.actor ?? "hermes-operator"), execution_allowed: false })
  );

  register(
    "pmt_action_execute",
    "Execute one approved, unexpired action after PMT revalidates current ESPN state. Unknown network outcomes are never retried automatically.",
    { actionId: z.string().min(1), leagueId: z.string().optional() },
    async (input) => {
      if (!deps.actionExecutor) throw new Error("The PMT action executor is not configured for this server.");
      return { execution: await deps.actionExecutor.execute(input.actionId, { leagueExternalId: input.leagueId }) };
    }
  );

  register(
    "pmt_get_action_audit",
    "Return the queue record plus durable execution receipts and audit events.",
    { actionId: z.string().min(1) },
    async (input) => ({
      action: await requireAction(deps.actionQueue, input.actionId),
      receipt: deps.executionStore ? await deps.executionStore.getReceipt(input.actionId) : null,
      audit: deps.executionStore
        ? (await deps.executionStore.listAudit()).filter((record) => record.actionId === input.actionId)
        : []
    })
  );

  register(
    "pmt_get_model_status",
    "Return model-store and probabilistic projection artifact status without changing models.",
    {},
    async () => ({
      model_store: await fileStatus(join(deps.dataDir, "models.json")),
      probabilistic_projections: await fileStatus(join(deps.dataDir, "probabilistic-projections.json"))
    })
  );

  register(
    "pmt_get_model_artifact",
    "Read a bounded JSON model artifact from the configured data or artifacts directory.",
    { path: z.string().min(1) },
    async (input) => ({ artifact: await readSafeArtifact(deps.dataDir, input.path) })
  );

  register(
    "pmt_evaluate_model",
    "Evaluate supplied prediction observations using PMT's deterministic MAE, RMSE, bias, and coverage metrics.",
    { observations: z.array(z.object({ playerId: z.string(), scoringPeriod: z.string(), source: z.string(), predicted: z.number(), actual: z.number() })) },
    async (input) => ({ performance: evaluatePredictions(input.observations as PredictionObservation[]) })
  );

  register(
    "pmt_rebuild_models",
    "Resolve current projection models while preserving learned observations. No platform action is executed.",
    {},
    async () => {
      const snapshot = await loadSnapshot(deps);
      const period = advisoryPeriod(snapshot, deps.teamId, clock());
      const models = await resolveRuntimeModels(snapshot, deps.dataDir, period);
      await new JsonModelStore(join(deps.dataDir, "models.json")).saveAll([...models.values()]);
      return { models_rebuilt: models.size, path: join(deps.dataDir, "models.json") };
    }
  );

  register(
    "pmt_update_post_week_outcomes",
    "Apply a causal weekly outcome batch, score archived forecasts, persist model updates, and write a promotion/rollback manifest.",
    {
      season: z.string().min(1),
      week: z.number().int().min(1).max(18),
      causalCutoff: z.string().datetime(),
      observations: z.array(completedWeeklyObservationSchema).optional(),
      modelSource: z.string().optional(),
      modelVersion: z.string().optional(),
      generatedAt: z.string().datetime().optional(),
      promotion: z.object({
        candidateSource: z.string().optional(),
        baselineSource: z.string().optional(),
        minimumSamples: z.number().int().min(1).optional(),
        maxMaeRegression: z.number().min(0).optional(),
        maxRmseRegression: z.number().min(0).optional()
      }).optional()
    },
    async (input) => {
      const observations = input.observations ?? await loadConfiguredObservations();
      return {
        update: await updatePostWeekOutcomes(
          new JsonModelStore(join(deps.dataDir, "models.json")),
          { ...input, observations },
          { artifactDir: join(deps.dataDir, "model-governance", `${input.season}-W${String(input.week).padStart(2, "0")}`) }
        )
      };
    }
  );

  if (PMT_MCP_TOOL_NAMES.length !== 47) {
    throw new Error("PMT MCP contract/tool registration drift detected.");
  }
  return server;
}

async function loadSnapshot(deps: PmtMcpDependencies): Promise<LeagueSnapshot> {
  if (deps.loadSnapshot) return deps.loadSnapshot();
  const scoped = deps.repository as KnowledgeRepository & { getLatestLeagueSnapshot?: () => Promise<LeagueSnapshot | undefined> };
  if (scoped.getLatestLeagueSnapshot) { const latest = await scoped.getLatestLeagueSnapshot(); if (latest) return latest; }
  const pointer = JSON.parse(await readFile(join(deps.dataDir, "last-snapshot.json"), "utf8")) as { snapshot_id: string };
  const snapshot = await deps.repository.getLeagueSnapshot(pointer.snapshot_id);
  if (!snapshot) throw new Error(`Imported snapshot ${pointer.snapshot_id} was not found.`);
  return snapshot;
}

async function storedProjectionPeriods(repository: KnowledgeRepository, snapshot: LeagueSnapshot): Promise<string[]> {
  const periods = new Set(snapshot.projections.map((projection) => projection.scoring_period));
  for (const period of [
    `${snapshot.league.season}-ROS`,
    ...Array.from({ length: 18 }, (_, index) => `${snapshot.league.season}-W${index + 1}`)
  ]) {
    if ((await repository.getProjections(period, snapshot.league.external_id)).length > 0) periods.add(period);
  }
  return [...periods].sort();
}

async function requireAction(queue: ActionQueue, actionId: string): Promise<QueuedAction> {
  const action = await queue.get(actionId);
  if (!action) throw new Error(`Action ${actionId} not found in queue.`);
  return action;
}

async function fileStatus(path: string): Promise<Record<string, unknown>> {
  try {
    const info = await stat(path);
    return { path, exists: true, bytes: info.size, modified_at: info.mtime.toISOString() };
  } catch {
    return { path, exists: false };
  }
}

async function readSafeArtifact(dataDir: string, requestedPath: string): Promise<Record<string, unknown>> {
  const root = resolve(dataDir);
  const candidate = resolve(root, requestedPath);
  const artifactRoot = resolve(join(root, "..", "artifacts"));
  const allowed = [root, artifactRoot];
  if (!allowed.some((prefix) => {
    const rel = relative(prefix, candidate);
    return rel === "" || (!rel.startsWith("..") && !rel.includes("\\"));
  })) throw new Error("Artifact path must remain inside PMT data or artifacts directories.");
  const info = await stat(candidate);
  if (info.size > 128 * 1024) throw new Error("Artifact is larger than the MCP preview limit; inspect it through the model dashboard or local filesystem.");
  const text = await readFile(candidate, "utf8");
  try {
    return { path: candidate, json: JSON.parse(text) as unknown };
  } catch {
    return { path: candidate, text };
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function loadConfiguredObservations(): Promise<z.infer<typeof completedWeeklyObservationSchema>[]> {
  const path = process.env.PMT_HISTORICAL_DATA_PATH;
  if (!path) throw new Error("Provide observations or configure PMT_HISTORICAL_DATA_PATH for post-week model updates.");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (Array.isArray(parsed)) return z.array(completedWeeklyObservationSchema).parse(parsed);
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { observations?: unknown[] }).observations)) {
    return z.array(completedWeeklyObservationSchema).parse((parsed as { observations: unknown[] }).observations);
  }
  throw new Error("PMT_HISTORICAL_DATA_PATH must contain an observation array or an object with an observations array.");
}

function toolSuccess(name: PmtMcpToolName, data: Record<string, unknown>, clock: () => Date): CallToolResult {
  const envelope: PmtMcpEnvelope<Record<string, unknown>> = {
    contract_version: PMT_MCP_CONTRACT_VERSION,
    tool: name,
    generated_at: clock().toISOString(),
    ok: true,
    data
  };
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>
  };
}

function toolFailure(name: PmtMcpToolName, error: unknown, clock: () => Date): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const envelope: PmtMcpEnvelope<Record<string, unknown>> = {
    contract_version: PMT_MCP_CONTRACT_VERSION,
    tool: name,
    generated_at: clock().toISOString(),
    ok: false,
    error: { code: "PMT_TOOL_ERROR", message, retryable: false }
  };
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
    isError: true
  };
}

function advisoryPeriod(snapshot: LeagueSnapshot, teamId: string | undefined, at: Date): string {
  return snapshot.scoring_period ?? (snapshot.league.platform === "fixture" ? snapshot.league.schedule.find(match => match.team_id === teamId)?.scoring_period : undefined)
    ?? getCurrentScoringPeriod(at, snapshot.league.season);
}

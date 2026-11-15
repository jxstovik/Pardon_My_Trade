import { loginRazzball } from "../projections/razzball-auth.js";
import { runSeasonRefresh } from "../season-refresh.js";
import { runSeasonOrchestration } from "./season-orchestration.js";
import { getCurrentScoringPeriod, isOffseason, weekFromScoringPeriod } from "./nfl-calendar.js";
import { buildApprovalRequestNotifications, buildLineupLockNotification, buildSourceDegradedNotification, buildWaiverWindowNotification } from "../notifications/season-alerts.js";
import { FRIDAY, MONDAY, SATURDAY, SUNDAY, THURSDAY, TUESDAY, WEDNESDAY } from "../scheduler/scheduler.js";
export const DEFAULT_SEASON_JOB_TIMES = {
    daily: "06:00",
    lineupLock: "11:00",
    waiverSweep: "13:00"
};
export const DAILY_JOB_DAYS = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY];
function times(deps) {
    return {
        daily: deps.times?.daily ?? process.env.PMT_SEASON_DAILY_TIME ?? DEFAULT_SEASON_JOB_TIMES.daily,
        lineupLock: deps.times?.lineupLock ?? process.env.PMT_SEASON_LINEUP_LOCK_TIME ?? DEFAULT_SEASON_JOB_TIMES.lineupLock,
        waiverSweep: deps.times?.waiverSweep ?? process.env.PMT_SEASON_WAIVER_TIME ?? DEFAULT_SEASON_JOB_TIMES.waiverSweep
    };
}
function startContext(deps) {
    const now = (deps.clock ?? (() => new Date()))();
    const scoringPeriod = getCurrentScoringPeriod(now, deps.season);
    return {
        now,
        dataDir: deps.dataDir ?? process.env.PMT_DATA_DIR ?? "data",
        scoringPeriod,
        week: weekFromScoringPeriod(scoringPeriod),
        steps: {},
        notifications: [],
        errors: []
    };
}
function offseasonResult(job, context) {
    return {
        job,
        ranAt: context.now.toISOString(),
        scoringPeriod: context.scoringPeriod,
        skipped: true,
        skipReason: "Outside the NFL regular season; season jobs are paused.",
        steps: {},
        notifications: 0,
        queuedForApproval: 0,
        errors: []
    };
}
async function finish(job, context, deps, queuedForApproval) {
    if (context.notifications.length > 0 && deps.notify) {
        try {
            await deps.notify(context.notifications);
        }
        catch (cause) {
            context.errors.push(`notify: ${cause.message}`);
        }
    }
    const result = {
        job,
        ranAt: context.now.toISOString(),
        scoringPeriod: context.scoringPeriod,
        skipped: false,
        steps: context.steps,
        notifications: context.notifications.length,
        queuedForApproval,
        errors: context.errors
    };
    deps.log?.(result);
    return result;
}
function alertContext(deps, context, leagueId) {
    return {
        leagueId,
        userId: deps.userId ?? process.env.PMT_USER_ID ?? "manager-001",
        scoringPeriod: context.scoringPeriod,
        clock: () => context.now
    };
}
async function defaultLogin(dataDir) {
    const username = process.env.RAZZBALL_USERNAME;
    const password = process.env.RAZZBALL_PASSWORD;
    if (!username || !password) {
        throw new Error("NO_CREDENTIALS");
    }
    await loginRazzball(username, password, { dataDir });
}
/**
 * Best-effort premium login. A failure never aborts the loop: the projection
 * sources fall back to the free tier and the user gets a degraded-source alert
 * (doc 21 Phase 5).
 */
async function runLoginStep(deps, context) {
    const login = deps.login ?? (() => defaultLogin(context.dataDir));
    try {
        await login();
        context.steps.login = "premium session refreshed";
    }
    catch (cause) {
        const message = cause.message;
        if (message === "NO_CREDENTIALS") {
            context.steps.login = "skipped (no Razzball credentials configured)";
            return;
        }
        context.steps.login = `failed: ${message}`;
        context.errors.push(`login: ${message}`);
        context.notifications.push(buildSourceDegradedNotification(alertContext(deps, context, process.env.PMT_LEAGUE_ID ?? ""), {
            source: "razzball-premium",
            reason: `Premium login failed (${message}).`,
            fallback: "free-tier Razzball projections"
        }));
    }
}
async function runProjectionStep(deps, context) {
    const seasonRefresh = deps.seasonRefresh ?? runSeasonRefresh;
    try {
        const summary = await seasonRefresh({
            dataDir: context.dataDir,
            season: deps.season,
            week: context.week
        });
        context.steps.projections =
            `${summary.projectionsStored} projections stored for ${summary.scoringPeriod} ` +
                `across ${Object.keys(summary.sources).length} source(s)`;
        for (const error of summary.errors)
            context.errors.push(`season-refresh: ${error}`);
        for (const [source, reason] of Object.entries(summary.skipped ?? {})) {
            context.notifications.push(buildSourceDegradedNotification(alertContext(deps, context, process.env.PMT_LEAGUE_ID ?? ""), {
                source,
                reason,
                fallback: "the remaining configured sources"
            }));
        }
    }
    catch (cause) {
        const message = cause.message;
        context.steps.projections = `failed: ${message}`;
        context.errors.push(`season-refresh: ${message}`);
    }
}
async function runNewsStep(deps, context) {
    if (!deps.refresh) {
        context.steps.news = "skipped (no refresh pipeline wired)";
        return;
    }
    try {
        const summary = await deps.refresh();
        context.steps.news =
            `${summary.news_ingested} news item(s), ${summary.injury_alerts} injury alert(s), ` +
                `report ${summary.weekly_report_id}`;
    }
    catch (cause) {
        const message = cause.message;
        context.steps.news = `failed: ${message}`;
        context.errors.push(`refresh: ${message}`);
    }
}
async function runOrchestrationStep(deps, context) {
    const orchestrate = deps.orchestrate ?? runSeasonOrchestration;
    try {
        const summary = await orchestrate({
            dataDir: context.dataDir,
            teamId: deps.teamId,
            autoApproveLowRisk: false
        });
        context.steps.orchestrator =
            `lineup ${Math.round(summary.lineupExpectedPoints * 100) / 100} pts, ` +
                `${summary.waiverCandidates.length} waiver, ${summary.tradeCandidates.length} trade, ` +
                `${summary.queued.length} awaiting approval`;
        return summary;
    }
    catch (cause) {
        const message = cause.message;
        context.steps.orchestrator = `failed: ${message}`;
        context.errors.push(`orchestrator: ${message}`);
        return undefined;
    }
}
/**
 * Daily 06:00 (Mon–Sat): premium login -> pull every configured projection
 * source -> news/injuries -> FF_Orchestrator (advisory only) -> notifications.
 */
export async function runDailySeasonJob(deps = {}) {
    const context = startContext(deps);
    if (isOffseason(context.now)) {
        const result = offseasonResult("season-daily", context);
        deps.log?.(result);
        return result;
    }
    await runLoginStep(deps, context);
    await runProjectionStep(deps, context);
    await runNewsStep(deps, context);
    const orchestration = await runOrchestrationStep(deps, context);
    if (orchestration && orchestration.queued.length > 0) {
        context.notifications.push(...buildApprovalRequestNotifications(alertContext(deps, context, orchestration.leagueId), orchestration.queued));
    }
    return finish("season-daily", context, deps, orchestration?.queued.length ?? 0);
}
/** Sunday pre-lock: final start/sit reminder before kickoff. */
export async function runLineupLockJob(deps = {}) {
    const context = startContext(deps);
    if (isOffseason(context.now)) {
        const result = offseasonResult("season-lineup-lock", context);
        deps.log?.(result);
        return result;
    }
    const orchestration = await runOrchestrationStep(deps, context);
    if (orchestration) {
        context.notifications.push(buildLineupLockNotification(alertContext(deps, context, orchestration.leagueId), {
            teamId: orchestration.teamId,
            starters: orchestration.starters,
            expectedPoints: orchestration.lineupExpectedPoints
        }));
    }
    return finish("season-lineup-lock", context, deps, orchestration?.queued.length ?? 0);
}
/** Tuesday post-waiver-processing: waiver-wire scan + trade review. */
export async function runWaiverSweepJob(deps = {}) {
    const context = startContext(deps);
    if (isOffseason(context.now)) {
        const result = offseasonResult("season-waiver-sweep", context);
        deps.log?.(result);
        return result;
    }
    await runProjectionStep(deps, context);
    const orchestration = await runOrchestrationStep(deps, context);
    if (orchestration) {
        const alerts = alertContext(deps, context, orchestration.leagueId);
        context.notifications.push(buildWaiverWindowNotification(alerts, {
            teamId: orchestration.teamId,
            waiverCandidates: orchestration.waiverCandidates,
            tradeCandidates: orchestration.tradeCandidates
        }));
        if (orchestration.queued.length > 0) {
            context.notifications.push(...buildApprovalRequestNotifications(alerts, orchestration.queued));
        }
    }
    return finish("season-waiver-sweep", context, deps, orchestration?.queued.length ?? 0);
}
/** The three in-season jobs, ready to hand to a `Scheduler`. */
export function buildSeasonJobs(deps = {}) {
    const schedule = times(deps);
    return [
        {
            jobId: "season-daily",
            name: "Daily projections + advisory loop",
            time: schedule.daily,
            days: [...DAILY_JOB_DAYS],
            handler: async () => {
                await runDailySeasonJob(deps);
            }
        },
        {
            jobId: "season-lineup-lock",
            name: "Sunday lineup-lock reminder",
            time: schedule.lineupLock,
            days: [SUNDAY],
            handler: async () => {
                await runLineupLockJob(deps);
            }
        },
        {
            jobId: "season-waiver-sweep",
            name: "Tuesday waiver + trade sweep",
            time: schedule.waiverSweep,
            days: [TUESDAY],
            handler: async () => {
                await runWaiverSweepJob(deps);
            }
        }
    ];
}
export function registerSeasonJobs(scheduler, deps = {}) {
    const jobs = buildSeasonJobs(deps);
    for (const job of jobs)
        scheduler.register(job);
    return jobs;
}

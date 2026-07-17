import { PmtError } from "../errors.js";
import { loadFixtureSnapshotSource } from "../knowledge/ingestion.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { V1Store } from "../history/v1-store.js";
import { FixtureNewsSource } from "../news/news-source.js";
import { DefaultProjectionEngine } from "../projections/projection-engine.js";
import type { ProjectionEngine } from "../projections/projection-engine.js";
import { detectInjuryChanges } from "../intelligence/injury-monitor.js";
import { updateManagerProfiles } from "../intelligence/manager-profiles.js";
import type { RuleEngine } from "../rules/rule-engine.js";
import type { DecisionEngine } from "../decisions/decision-engine.js";
import type { RecommendationEngine } from "../recommendations/recommendation-engine.js";
import type { NotificationProvider } from "../notifications/notification-provider.js";
import type { NotificationRecord, RefreshSummary } from "../models/v1.js";
import type { LeagueSnapshot, Recommendation } from "../models/types.js";

export interface RefreshOptions {
  readonly fixturePath: string;
  readonly newsPath?: string;
  readonly leagueExternalId: string;
  readonly teamExternalId: string;
  readonly repository: KnowledgeRepository;
  readonly v1Store: V1Store;
  readonly ruleEngine: RuleEngine;
  readonly decisionEngine: DecisionEngine;
  readonly recommendationEngine: RecommendationEngine;
  readonly projectionEngine?: ProjectionEngine;
  readonly newsSource?: FixtureNewsSource;
  readonly notificationProviders?: NotificationProvider[];
  readonly clock?: () => Date;
  readonly userId?: string;
}

export async function runRefresh(options: RefreshOptions): Promise<RefreshSummary> {
  const clock = options.clock ?? (() => new Date());
  const now = clock();
  const nowIso = now.toISOString();
  const projectionEngine = options.projectionEngine ?? new DefaultProjectionEngine();

  const source = await loadFixtureSnapshotSource(options.fixturePath);
  const leagueId = source.league.league_id;
  const snapshotId = `${source.snapshot_id}-${now.getTime()}`;
  const datedSnapshot: LeagueSnapshot = { ...source, snapshot_id: snapshotId };
  await options.repository.saveLeagueSnapshot(datedSnapshot);

  const team = datedSnapshot.league.teams.find((candidate) => candidate.external_id === options.teamExternalId);
  if (!team) {
    throw new PmtError({
      code: "TEAM_NOT_FOUND",
      message: `Team ${options.teamExternalId} was not found for refresh.`,
      source: "recommendation_engine",
      retryable: false
    });
  }

  const newsSource = options.newsSource ?? (options.newsPath ? new FixtureNewsSource(options.newsPath) : undefined);
  const news = newsSource ? await newsSource.fetchNews(leagueId) : [];
  if (news.length > 0) await options.v1Store.saveNews(leagueId, news);

  const consensus = projectionEngine.buildConsensus(
    [{ source: "fixture", projections: datedSnapshot.projections }],
    datedSnapshot.league.season
  );

  const alerts = detectInjuryChanges([], datedSnapshot.players, clock);

  const profiles = updateManagerProfiles(datedSnapshot, clock);
  for (const profile of profiles) {
    await options.v1Store.saveManagerProfile(profile);
  }

  await options.v1Store.recordHistory({
    record_id: `hist-${snapshotId}`,
    league_id: leagueId,
    snapshot_id: snapshotId,
    captured_at: nowIso,
    roster_changes: [],
    projection_changes: []
  });

  const inputs = options.decisionEngine.generateWeeklyReportInputs(datedSnapshot, team);
  const report = options.recommendationEngine.generateWeeklyReport(inputs);
  await options.repository.saveRecommendation(report);

  const notifications = buildNotifications(report, alerts, leagueId, nowIso, options.userId ?? "manager-001");
  let sent = 0;
  for (const notification of notifications) {
    await options.v1Store.saveNotification(notification);
    for (const provider of options.notificationProviders ?? []) {
      const result = await provider.send(notification);
      if (result.delivered) sent += 1;
    }
  }

  return {
    refreshed_at: nowIso,
    league_id: leagueId,
    team_id: team.team_id,
    snapshot_id: snapshotId,
    news_ingested: news.length,
    injury_alerts: alerts.length,
    projection_updates: consensus.length,
    notifications_sent: sent,
    weekly_report_id: report.recommendation_id
  };
}

function buildNotifications(
  report: Recommendation,
  alerts: Recommendation[],
  leagueId: string,
  nowIso: string,
  userId: string
): NotificationRecord[] {
  const notifications: NotificationRecord[] = [{
    notification_id: `notif-${report.recommendation_id}`,
    user_id: userId,
    league_id: leagueId,
    priority: "medium",
    type: "weekly_planning_report",
    title: report.title,
    body: report.recommendation,
    related_recommendation_ids: [report.recommendation_id],
    action_required: false,
    created_at: nowIso,
    expires_at: report.expiration,
    delivered: false
  }];

  for (const alert of alerts) {
    notifications.push({
      notification_id: `notif-${alert.recommendation_id}`,
      user_id: userId,
      league_id: leagueId,
      priority: "high",
      type: "breaking_injury_alert",
      title: alert.title,
      body: alert.recommendation,
      related_recommendation_ids: [alert.recommendation_id],
      action_required: true,
      created_at: nowIso,
      expires_at: alert.expiration,
      delivered: false
    });
  }

  return notifications;
}

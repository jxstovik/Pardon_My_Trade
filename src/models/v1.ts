import type { NewsItem, Projection, Recommendation } from "./types.js";

export type NotificationPriority = "low" | "medium" | "high" | "critical";

export interface ConsensusProjection {
  readonly projection_id: string;
  readonly player_id: string;
  readonly scoring_period: string;
  readonly projected_points: number;
  readonly floor: number;
  readonly ceiling: number;
  readonly confidence: number;
  readonly sources: number;
}

export interface NotificationRecord {
  readonly notification_id: string;
  readonly user_id: string;
  readonly league_id: string;
  readonly priority: NotificationPriority;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly related_recommendation_ids: string[];
  readonly action_required: boolean;
  readonly created_at: string;
  readonly expires_at: string;
  readonly delivered: boolean;
  readonly delivery_detail?: string;
}

export interface ProjectionChange {
  readonly player_id: string;
  readonly before: number;
  readonly after: number;
}

export interface HistoricalRecord {
  readonly record_id: string;
  readonly league_id: string;
  readonly snapshot_id: string;
  readonly captured_at: string;
  readonly roster_changes: string[];
  readonly projection_changes: ProjectionChange[];
}

export interface ManagerProfileRecord {
  readonly league_id: string;
  readonly manager_id: string;
  readonly display_name: string;
  readonly observed_behavior_profile: Record<string, unknown>;
  readonly updated_at: string;
}

export interface RefreshSummary {
  readonly refreshed_at: string;
  readonly league_id: string;
  readonly team_id: string;
  readonly snapshot_id: string;
  readonly news_ingested: number;
  readonly injury_alerts: number;
  readonly projection_updates: number;
  readonly notifications_sent: number;
  readonly weekly_report_id: string;
}

export interface ProjectionSourceInput {
  readonly source: string;
  readonly projections: Projection[];
}

export type Sport = "football" | "baseball" | "basketball" | "hockey" | "soccer";
export type Platform = "fixture" | "sleeper" | "espn" | "yahoo" | "cbs" | "nfl";
export type PlayerPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST" | "FLEX" | "SUPER_FLEX" | "BN" | "IR" | "P" | "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "UTIL";
export type PlayerStatus = "active" | "questionable" | "doubtful" | "out" | "injured_reserve" | "suspended" | "bye" | "unknown";
export type RecommendationType = "lineup" | "bench" | "waiver_claim" | "drop" | "trade" | "weekly_report" | "alert" | "playoff_plan" | "season_strategy" | "draft_pick";
export type RecommendationStatus = "draft" | "ready" | "viewed" | "accepted" | "rejected" | "expired" | "superseded";
export type RiskLevel = "low" | "medium" | "high";

export interface VersionedRecord {
  readonly schema_version: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly source_system: string;
  readonly source_record_id?: string;
}

export interface ImportMetadata {
  readonly imported_at: string;
  readonly source: Platform;
  readonly adapter_version: string;
  readonly raw_payload_ref?: string;
}

export interface League extends VersionedRecord {
  readonly league_id: string;
  readonly external_id: string;
  readonly platform: Platform;
  readonly sport: Sport;
  readonly season: string;
  readonly name: string;
  readonly teams: Team[];
  readonly roster_settings: RosterSettings;
  readonly scoring_settings: ScoringSettings;
  readonly waiver_settings: WaiverSettings;
  readonly trade_settings: TradeSettings;
  readonly schedule: Matchup[];
  readonly import_metadata: ImportMetadata;
}

export interface Team extends VersionedRecord {
  readonly team_id: string;
  readonly external_id: string;
  readonly league_id: string;
  readonly manager_id: string;
  readonly name: string;
  readonly roster: Roster;
  readonly standings: Standings;
  readonly transaction_history: Transaction[];
}

export interface Manager extends VersionedRecord {
  readonly manager_id: string;
  readonly display_name: string;
  readonly contact_preferences: Record<string, unknown>;
  readonly observed_behavior_profile: Record<string, unknown>;
}

export interface Player extends VersionedRecord {
  readonly player_id: string;
  readonly external_id: string;
  readonly sport: Sport;
  readonly full_name: string;
  readonly team: string;
  readonly positions: PlayerPosition[];
  readonly status: PlayerStatus;
  readonly injury_status: PlayerStatus;
  readonly eligibility: PlayerEligibility;
  readonly external_ids: Record<string, string>;
}

export interface PlayerEligibility {
  readonly eligible_slots: PlayerPosition[];
  readonly injured_reserve_eligible: boolean;
  readonly taxi_eligible: boolean;
}

export interface RosterSlot {
  readonly slot_id: string;
  readonly slot_type: PlayerPosition;
  readonly allowed_positions: PlayerPosition[];
  readonly locked: boolean;
  readonly player_id?: string;
}

export interface Roster {
  readonly team_id: string;
  readonly starters: RosterSlot[];
  readonly bench: RosterSlot[];
  readonly injured_reserve: RosterSlot[];
  readonly taxi: RosterSlot[];
  readonly last_updated_at: string;
}

export interface RosterSettings {
  readonly slots: Array<{
    readonly slot: PlayerPosition;
    readonly count: number;
    readonly positions: PlayerPosition[];
  }>;
  readonly bench_count: number;
  readonly injured_reserve_count: number;
  readonly taxi_count: number;
}

export interface ScoringRule {
  readonly rule_id: string;
  readonly category: string;
  readonly stat: string;
  readonly points: number;
  readonly conditions: Record<string, unknown>;
  readonly applies_to_positions: PlayerPosition[];
}

export interface ScoringSettings {
  readonly scoring_type: "standard" | "half_ppr" | "ppr" | "custom";
  readonly rules: ScoringRule[];
}

export interface WaiverSettings {
  readonly type: "rolling" | "faab" | "none";
  readonly budget?: number;
  readonly claim_deadline?: string;
}

export interface TradeSettings {
  readonly enabled: boolean;
  readonly deadline?: string;
  readonly review_type: "none" | "commissioner" | "league_vote";
}

export interface Standings {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly points_for: number;
  readonly points_against: number;
  readonly rank: number;
}

export interface Matchup extends VersionedRecord {
  readonly matchup_id: string;
  readonly league_id: string;
  readonly scoring_period: string;
  readonly team_id: string;
  readonly opponent_team_id: string;
  readonly projected_points_for?: number;
  readonly projected_points_against?: number;
  readonly actual_points_for?: number;
  readonly actual_points_against?: number;
}

export interface Projection extends VersionedRecord {
  readonly projection_id: string;
  readonly player_id: string;
  readonly source: string;
  readonly scoring_period: string;
  readonly projected_stats: Record<string, number>;
  readonly projected_points: number;
  readonly floor: number;
  readonly ceiling: number;
  readonly confidence: number;
}

export interface NewsItem extends VersionedRecord {
  readonly news_id: string;
  readonly player_id: string;
  readonly source: string;
  readonly headline: string;
  readonly summary: string;
  readonly impact: "low" | "medium" | "high";
  readonly published_at: string;
  readonly ingested_at: string;
  readonly source_url?: string;
  readonly content_hash?: string;
  readonly parser_version?: string;
}

export interface Evidence {
  readonly evidence_id: string;
  readonly source: string;
  readonly source_type: string;
  readonly observed_at: string;
  readonly claim: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly link?: string;
}

export interface Recommendation extends VersionedRecord {
  readonly recommendation_id: string;
  readonly league_id: string;
  readonly team_id: string;
  readonly type: RecommendationType;
  readonly title: string;
  readonly recommendation: string;
  readonly reasoning: string[];
  readonly evidence: Evidence[];
  readonly confidence: number;
  readonly risk: {
    readonly level: RiskLevel;
    readonly factors: string[];
  };
  readonly expected_benefit: {
    readonly metric: string;
    readonly value: number;
    readonly range: [number, number];
  };
  readonly assumptions: string[];
  readonly alternatives: string[];
  readonly generated_at: string;
  readonly expiration: string;
  readonly status: RecommendationStatus;
}

export interface DecisionAudit extends VersionedRecord {
  readonly audit_id: string;
  readonly recommendation_id: string;
  readonly inputs_hash: string;
  readonly config_version: string;
  readonly engine_version: string;
  readonly provider_calls: Array<Record<string, unknown>>;
  readonly validation_results: Array<Record<string, unknown>>;
  readonly generated_at: string;
}

export interface Transaction extends VersionedRecord {
  readonly transaction_id: string;
  readonly league_id: string;
  readonly type: "add" | "drop" | "trade" | "waiver" | "commissioner";
  readonly team_ids: string[];
  readonly player_ids: string[];
  readonly occurred_at: string;
}

export interface WaiverState extends VersionedRecord {
  readonly league_id: string;
  readonly waiver_order: string[];
  readonly faab_budgets: Record<string, number>;
}

export interface LeagueSnapshot {
  readonly snapshot_id: string;
  readonly league: League;
  readonly managers: Manager[];
  readonly players: Player[];
  readonly free_agents: Player[];
  readonly waiver_state: WaiverState;
  readonly projections: Projection[];
  readonly news: NewsItem[];
}

export const PMT_MCP_CONTRACT_VERSION = "1.0.0";
export const PMT_MCP_SERVER_VERSION = "0.1.0";

export const PMT_MCP_TOOL_NAMES = [
  "pmt_get_inseason_status",
  "pmt_get_current_scoring_period",
  "pmt_espn_read_league",
  "pmt_espn_read_rosters",
  "pmt_espn_read_schedule",
  "pmt_espn_read_transactions",
  "pmt_espn_read_players",
  "pmt_espn_read_free_agents",
  "pmt_refresh_projections",
  "pmt_run_projection_refresh",
  "pmt_get_projection_status",
  "pmt_get_projection_provenance",
  "pmt_run_news_injury_refresh",
  "pmt_list_news",
  "pmt_list_injury_alerts",
  "pmt_list_notifications",
  "pmt_run_advisory_orchestration",
  "pmt_list_pending_actions",
  "pmt_get_action",
  "pmt_preview_action",
  "pmt_action_approve",
  "pmt_action_reject",
  "pmt_get_action_audit",
  "pmt_get_model_status",
  "pmt_get_model_artifact",
  "pmt_evaluate_model",
  "pmt_rebuild_models"
] as const;

export type PmtMcpToolName = (typeof PMT_MCP_TOOL_NAMES)[number];

export interface PmtMcpEnvelope<T extends Record<string, unknown>> {
  readonly contract_version: string;
  readonly tool: PmtMcpToolName;
  readonly generated_at: string;
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

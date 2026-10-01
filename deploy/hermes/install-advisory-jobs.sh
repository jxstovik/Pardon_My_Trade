#!/usr/bin/env bash
set -euo pipefail

: "${PMT_WORKDIR:?Set PMT_WORKDIR to this absolute PMT checkout path}"
: "${PMT_LEAGUE_EXTERNAL_ID:?Set the configured league's external ID}"
: "${PMT_TEAM_EXTERNAL_ID:?Set the managed team's external ID}"
: "${HERMES_PROVIDER:?Set the exact provider ID used by this Hermes gateway}"
: "${HERMES_MODEL:?Set the immutable model ID used by this Hermes gateway}"

if [[ "$PMT_WORKDIR" != /* || ! -f "$PMT_WORKDIR/docker-compose.yml" ]]; then
  printf 'PMT_WORKDIR must be an absolute PMT checkout with docker-compose.yml: %s\n' "$PMT_WORKDIR" >&2
  exit 2
fi

league_id=$(printf '%q' "$PMT_LEAGUE_EXTERNAL_ID")
team_id=$(printf '%q' "$PMT_TEAM_EXTERNAL_ID")
delivery=${HERMES_DELIVERY:-local}

daily_prompt="Use the configured pmt-read MCP server for Pardon My Trade. First call mcp_pmt_read_pmt_get_inseason_status for league ${league_id}. If that fails or no current league state is available, report the exact block reason and stop. Then call mcp_pmt_read_pmt_get_current_scoring_period, mcp_pmt_read_pmt_run_projection_refresh, mcp_pmt_read_pmt_run_news_injury_refresh, mcp_pmt_read_pmt_run_advisory_orchestration with automatic execution disabled for league ${league_id} and team ${team_id}, and mcp_pmt_read_pmt_list_pending_actions. Report source degradation, scoring period, recommendation evidence, and queued action IDs. Never approve, reject, or execute an action. Do not emit credentials."
sunday_prompt="Use the configured pmt-read MCP server for the Pardon My Trade pre-lock review. First call mcp_pmt_read_pmt_get_inseason_status for league ${league_id}; if it fails, report the reason and stop. Then call mcp_pmt_read_pmt_get_current_scoring_period, mcp_pmt_read_pmt_espn_read_rosters, mcp_pmt_read_pmt_get_projection_provenance, mcp_pmt_read_pmt_list_news, mcp_pmt_read_pmt_list_injury_alerts, mcp_pmt_read_pmt_run_advisory_orchestration with automatic execution disabled for league ${league_id} and team ${team_id}, and mcp_pmt_read_pmt_list_pending_actions. Summarize starter recommendations, uncertainty, and injury/news risks for human review. Never approve, reject, or execute an action. Do not emit credentials."
tuesday_prompt="Use the configured pmt-read MCP server for the Pardon My Trade waiver review. First call mcp_pmt_read_pmt_get_inseason_status for league ${league_id}; if it fails, report the reason and stop. Then call mcp_pmt_read_pmt_get_current_scoring_period, mcp_pmt_read_pmt_espn_read_free_agents, mcp_pmt_read_pmt_espn_read_transactions, mcp_pmt_read_pmt_run_advisory_orchestration with automatic execution disabled for league ${league_id} and team ${team_id}, and mcp_pmt_read_pmt_list_pending_actions. Review adds, drops, trades, confidence, waiver context, and expiration for human review. Never approve, reject, or execute an action. Do not emit credentials."

create_job() {
  local name="$1" schedule="$2" prompt="$3"
  if hermes cron list --all 2>/dev/null | grep -Fq "$name"; then
    printf 'Skipping existing Hermes job: %s\n' "$name"
    return
  fi
  hermes cron create "$schedule" "$prompt" \
    --name "$name" \
    --deliver "$delivery" \
    --workdir "$PMT_WORKDIR" \
    --provider "$HERMES_PROVIDER" \
    --model "$HERMES_MODEL"
}

create_job pmt-daily-refresh '0 6 * * 1-6' "$daily_prompt"
create_job pmt-sunday-pre-lock '0 11 * * 0' "$sunday_prompt"
create_job pmt-tuesday-waiver-review '0 13 * * 2' "$tuesday_prompt"

printf 'Installed advisory-only PMT Hermes jobs. Review with: hermes cron list --all\n'

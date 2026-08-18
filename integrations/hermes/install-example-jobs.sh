#!/usr/bin/env bash

set -euo pipefail

: "${PMT_WORKDIR:?Set PMT_WORKDIR to an existing absolute PMT repository path}"
: "${PMT_LEAGUE_EXTERNAL_ID:?Set PMT_LEAGUE_EXTERNAL_ID before installing the examples}"
: "${PMT_TEAM_EXTERNAL_ID:?Set PMT_TEAM_EXTERNAL_ID before installing the examples}"
: "${HERMES_PROVIDER:?Set HERMES_PROVIDER to the pinned Hermes provider name}"
: "${HERMES_MODEL:?Set HERMES_MODEL to the pinned immutable model ID}"

if [[ "$PMT_WORKDIR" != /* || ! -d "$PMT_WORKDIR" ]]; then
  printf 'PMT_WORKDIR must be an existing absolute directory: %s\n' "$PMT_WORKDIR" >&2
  exit 2
fi

hermes_home="${HERMES_HOME:-$HOME/.hermes}"
scripts_dir="$hermes_home/scripts"
source_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
precheck_source="$source_dir/pmt-hermes-precheck.sh"

mkdir -p "$scripts_dir"
for script_name in \
  pmt-daily-precheck.sh \
  pmt-sunday-precheck.sh \
  pmt-tuesday-precheck.sh \
  pmt-post-week-precheck.sh; do
  install -m 0755 "$precheck_source" "$scripts_dir/$script_name"
done

league_arg="$(printf '%q' "$PMT_LEAGUE_EXTERNAL_ID")"
team_arg="$(printf '%q' "$PMT_TEAM_EXTERNAL_ID")"
delivery="${HERMES_DELIVERY:-local}"

daily_prompt='Run the Pardon My Trade daily state/news/projection refresh from the configured absolute workdir using the PMT read-only MCP server and the attached pre-check output. If it says precheck=blocked, do not call PMT tools; report the exact reason and stop. If it says precheck=pass, call `mcp_pmt_read_pmt_get_inseason_status`, `mcp_pmt_read_pmt_get_current_scoring_period`, `mcp_pmt_read_pmt_run_projection_refresh`, `mcp_pmt_read_pmt_run_news_injury_refresh`, `mcp_pmt_read_pmt_run_advisory_orchestration` with automatic execution disabled, `mcp_pmt_read_pmt_list_notifications`, and `mcp_pmt_read_pmt_list_pending_actions`. The configured league is LEAGUE_ID and team is TEAM_ID. Preserve contract results, source degradation, scoring period, model refresh counts, recommendation evidence, and queued action IDs. Never call action approval/rejection or any platform-write tool. Never start `pmt daemon` or `pmt serve --scheduler`; Hermes owns this schedule. Do not emit secrets.'
sunday_prompt='Run the Pardon My Trade Sunday pre-lock review from the configured absolute workdir using the PMT read-only MCP server and the attached pre-check output. If it says precheck=blocked, do not call PMT tools; report the exact reason and stop. If it says precheck=pass, call `mcp_pmt_read_pmt_get_inseason_status`, `mcp_pmt_read_pmt_get_current_scoring_period`, `mcp_pmt_read_pmt_espn_read_rosters`, `mcp_pmt_read_pmt_get_projection_provenance`, `mcp_pmt_read_pmt_list_news`, `mcp_pmt_read_pmt_list_injury_alerts`, `mcp_pmt_read_pmt_run_advisory_orchestration`, and `mcp_pmt_read_pmt_list_pending_actions`. The configured league is LEAGUE_ID and team is TEAM_ID. Summarize recommended starters, uncertainty, injury/news concerns, and pending approvals before the weekly lock. This is advisory only: never approve/reject actions, call platform-write tools, or start `pmt daemon` or `pmt serve --scheduler`. Report failures explicitly and do not emit secrets.'
tuesday_prompt='Run the Pardon My Trade Tuesday waiver review from the configured absolute workdir using the PMT read-only MCP server and the attached pre-check output. If it says precheck=blocked, do not call PMT tools; report the exact reason and stop. If it says precheck=pass, call `mcp_pmt_read_pmt_get_inseason_status`, `mcp_pmt_read_pmt_get_current_scoring_period`, `mcp_pmt_read_pmt_espn_read_free_agents`, `mcp_pmt_read_pmt_espn_read_transactions`, `mcp_pmt_read_pmt_run_advisory_orchestration`, `mcp_pmt_read_pmt_list_pending_actions`, and `mcp_pmt_read_pmt_get_projection_provenance`. The configured league is LEAGUE_ID and team is TEAM_ID. Review waiver adds, drops, trades, confidence, waiver context, and expiration times. Do not repeat the daily projection refresh. Never approve/reject actions, call platform-write tools, or start `pmt daemon` or `pmt serve --scheduler`. Report failures explicitly and do not emit secrets.'
post_week_prompt='Run the Pardon My Trade post-week model review from the configured absolute workdir using the PMT read-only MCP server and the attached pre-check output. If it says wakeAgent=false, report nothing and stop; that is the intentional zero-token path when completed observations are not ready. If it says precheck=blocked, do not call PMT tools; report the exact reason and stop. If it says precheck=pass, verify that PMT_HISTORICAL_DATA_PATH points to completed observations with a documented cutoff, then call `mcp_pmt_read_pmt_get_model_status`, `mcp_pmt_read_pmt_rebuild_models`, and `mcp_pmt_read_pmt_list_pending_actions`. Do not mix future information into the observations. This phase rebuilds deterministic runtime models but does not yet apply a full weekly outcome update, promote a separate artifact, or execute actions. Report the cutoff, model result, limitations, and failures without emitting secrets.'

daily_prompt="${daily_prompt/LEAGUE_ID/$league_arg}"
daily_prompt="${daily_prompt/TEAM_ID/$team_arg}"
sunday_prompt="${sunday_prompt/LEAGUE_ID/$league_arg}"
sunday_prompt="${sunday_prompt/TEAM_ID/$team_arg}"
tuesday_prompt="${tuesday_prompt/LEAGUE_ID/$league_arg}"
tuesday_prompt="${tuesday_prompt/TEAM_ID/$team_arg}"

create_job() {
  local name="$1"
  local schedule="$2"
  local script_name="$3"
  local prompt="$4"
  shift 4
  local skills=("$@")

  if hermes cron list --all 2>/dev/null | grep -Fq "$name"; then
    printf 'Skipping existing Hermes job: %s\n' "$name"
    return 0
  fi

  local skill_args=()
  for skill in "${skills[@]}"; do
    skill_args+=(--skill "$skill")
  done

  hermes cron create "$schedule" "$prompt" \
    --name "$name" \
    --deliver "$delivery" \
    --script "$script_name" \
    --workdir "$PMT_WORKDIR" \
    --provider "$HERMES_PROVIDER" \
    --model "$HERMES_MODEL" \
    "${skill_args[@]}"
}

create_job "pmt-daily-refresh" "0 6 * * 1-6" "pmt-daily-precheck.sh" "$daily_prompt" pmt-inseason
create_job "pmt-sunday-pre-lock" "0 11 * * 0" "pmt-sunday-precheck.sh" "$sunday_prompt" pmt-inseason pmt-espn-league-operations pmt-news-and-injuries
create_job "pmt-tuesday-waiver-review" "0 13 * * 2" "pmt-tuesday-precheck.sh" "$tuesday_prompt" pmt-inseason pmt-espn-league-operations pmt-projection-refresh
create_job "pmt-post-week-model-update" "30 5 * * 2" "pmt-post-week-precheck.sh" "$post_week_prompt" pmt-model-operations

printf 'Installed Hermes PMT Phase 4 examples. Verify with: hermes cron list --all\n'

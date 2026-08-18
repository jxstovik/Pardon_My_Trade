# Hermes Integration

These examples let Hermes own the outer schedule while Pardon My Trade exposes
its deterministic services through the local stdio MCP server. They are
advisory by default. High-risk actions remain in the PMT action queue; the
operator MCP server can execute only explicitly approved, revalidated actions
and remains disabled by default.

The PMT/Hermes compatibility baseline is
`integrations/hermes/pmt-hermes-compatibility.yaml`. Installation and upgrade
steps are in `docs/hermes/install-upgrade.md`; release artifact and version
pinning guidance is in `docs/hermes/release-versioning.md`.

## Scope

The installer creates these local-time jobs:

| Job | Schedule | Purpose |
| --- | --- | --- |
| `pmt-daily-refresh` | `06:00`, Monday-Saturday | Refresh projections/models, news, and the advisory queue |
| `pmt-sunday-pre-lock` | `11:00`, Sunday | Review the lineup before the weekly lock |
| `pmt-tuesday-waiver-review` | `13:00`, Tuesday | Review waiver and trade candidates after the waiver window |
| `pmt-post-week-model-update` | `05:30`, Tuesday | Rebuild the runtime model after completed weekly observations are available |

Hermes cron uses the timezone configured for the Hermes gateway. Set that
timezone before enabling these jobs if the gateway host timezone is not the
league's local timezone.

## Important Safety Rule

This installer and its Hermes jobs are an alternative scheduler. Do **not** run
`pmt daemon` or `pmt serve --scheduler` at the same time as these jobs. Those
PMT modes already register the daily, Sunday, and Tuesday season jobs and would
duplicate work.

Keep the Hermes gateway running; Hermes owns only the schedule, while PMT owns
refresh and recommendation behavior.

The `pmt-operator` MCP entry in
`integrations/hermes/mcp-config.example.yaml` is disabled by default. Enabling
it exposes queue approval and `pmt_action_execute`, which performs current-state
revalidation, idempotency checks, durable receipts, and unknown-outcome
handling. Do not enable it until the operator has completed a canary and
reviewed the execution audit.

## Prerequisites

- Hermes Agent and its gateway are installed and authenticated.
- Node 26 is available to the Hermes terminal process.
- The repository has been built with `npm run build`.
- An imported PMT snapshot exists at the configured data directory.
- The PMT `.env` contains any required platform/source settings. Do not put
  secrets in this directory or in a cron prompt.
- Hermes has the `pmt-read` MCP server configured from
  `integrations/hermes/mcp-config.example.yaml`.
- Hermes has trusted project skills enabled from `.agents/skills/`.

The installer requires non-secret configuration values. Replace every example
placeholder with an actual value before running it:

```bash
export PMT_WORKDIR="/ABSOLUTE/PATH/TO/Pardon_My_Trade"
export PMT_DATA_DIR="/ABSOLUTE/PATH/TO/Pardon_My_Trade/data"
export PMT_LEAGUE_EXTERNAL_ID="<LEAGUE_EXTERNAL_ID>"
export PMT_TEAM_EXTERNAL_ID="<TEAM_EXTERNAL_ID>"

# Pin an immutable provider/model pair. Do not use a floating alias such as
# "sonnet" or leave either value to the global Hermes default.
export HERMES_PROVIDER="<PINNED_PROVIDER>"
export HERMES_MODEL="<PINNED_MODEL_ID>"

# Optional Hermes delivery target. "local" writes to Hermes cron output only.
export HERMES_DELIVERY="local"

# Used by the post-week wake gate. The PMT process should also have this value
# through its project .env or service environment.
export HERMES_PMT_HISTORICAL_DATA_PATH="/ABSOLUTE/PATH/TO/completed-observations.json"
export PMT_HISTORICAL_DATA_PATH="$HERMES_PMT_HISTORICAL_DATA_PATH"

bash integrations/hermes/install-example-jobs.sh
```

Before the first scheduled run, trust the checkout and enable the `skills` and
`mcp-pmt-read` toolsets for the Hermes cron platform with `hermes tools`. The
project-local skill trust command is:

```bash
hermes skills trust "$PMT_WORKDIR"
```

The two external IDs are identifiers, not credentials. ESPN credentials stay
in the normal PMT environment and are never interpolated into a prompt.

## Hermes Conventions Used

- Every job has an explicit absolute `--workdir`.
- Every job pins both `--provider` and `--model`.
- Jobs attach only the PMT skills they need. PMT MCP tools perform data access;
  Hermes does not need web, browser, delegation, or memory tools for these jobs.
- Each job has a pre-check script. It verifies the built CLI, imported state,
  and the absence of a PMT scheduler process before waking the model.
- The post-week job emits `{"wakeAgent": false}` until a completed observation
  file exists, so an empty Tuesday model run costs no inference tokens.
- Prompts are self-contained because every Hermes cron run starts a fresh
  session.
- Prompts explicitly prohibit approvals and scheduler startup. Reviews may
  inspect the queue but may not execute a move.

## Verify and Test

```bash
hermes cron list --all
hermes cron run pmt-daily-refresh
hermes cron runs pmt-daily-refresh --limit 5
```

The first manual run should be done after confirming `PMT_NEWS_PATH`, the
projection source settings, and the imported snapshot. If a job is recreated,
remove the old job by name first or edit it with the same pinned provider,
model, workdir, script, and prompt.

The pre-check script is installed into `$HERMES_HOME/scripts/` because Hermes
rejects cron scripts outside that directory. The repository copy is only the
secret-free source template.

## Current PMT/MCP Assumptions

- `pmt_run_projection_refresh` is the one-shot projection refresh and rebuilds
  the persisted PMT model files.
- `pmt_run_news_injury_refresh` uses the live ESPN and Razzball source adapters
  and persists player-linked news.
- The post-week job uses `PMT_HISTORICAL_DATA_PATH` as the completed-observation
  input for `pmt_update_post_week_outcomes`; it writes a model-governance
  manifest, promotion decision, and rollback snapshot. It does not silently
  promote a held or failed candidate.
- The pre-check process does not source the PMT `.env`, intentionally avoiding
  exposure of credentials. If `PMT_DATA_DIR` is not the default `data/`, export
  its absolute value in the Hermes gateway environment as shown above.

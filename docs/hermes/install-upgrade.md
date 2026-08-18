# Hermes Install And Upgrade

This guide installs the PMT Hermes integration without putting credentials in
the repository, a cron prompt, or a tracked configuration file. Hermes owns the
outer schedule; PMT owns league reads, refreshes, deterministic advice, and the
human-gated action queue.

The compatibility baseline is
`integrations/hermes/pmt-hermes-compatibility.yaml`. It currently describes PMT
package version `0.2.0`, MCP contract `1.0.0`, and MCP server `0.2.0`.

## Safety Boundary

The checked-in `pmt-operator` MCP entry is `enabled: false`. Leave it disabled
until the operator has reviewed the Phase 5 executor and completed a canary:

- `pmt_action_approve` marks a queued proposal approved; it does not submit a
  move to ESPN by itself.
- `pmt_action_reject`, preview, and audit are queue operations or views only.
- `pmt_action_execute` is the only Phase 5 mutation entry point. It requires an
  approved, unexpired queue item and performs current-state, payload-hash, and
  idempotency checks before using the ESPN writer.
- An unknown network outcome is terminal for automatic execution and must be
  reconciled against ESPN before any further action.
- Scheduled Hermes jobs use `pmt-read` and must never approve, reject, or submit
  a platform action.

The operator block may be enabled only after the release satisfies every
condition in `phase_5_write_boundary` in the compatibility manifest and the
operator has completed a canary in the intended league.

## Install

### 1. Select An Immutable PMT Revision

Use a release tag or full commit SHA. Do not run a Hermes job from a moving
branch.

```bash
git clone <PMT_REPOSITORY_URL> /ABSOLUTE/PATH/TO/Pardon_My_Trade
git -C /ABSOLUTE/PATH/TO/Pardon_My_Trade checkout --detach <PMT_TAG_OR_FULL_SHA>
```

Use Node 26 from `.nvmrc`. Install dependencies and build the exact checkout:

```bash
cd /ABSOLUTE/PATH/TO/Pardon_My_Trade
npm ci
npm rebuild better-sqlite3
npm run build
```

Record the selected revision with `git rev-parse HEAD`. The build must produce
`dist/src/mcp/stdio.js` before Hermes is configured.

### 2. Keep Secrets Outside The Checkout

Create the normal PMT environment from `.env.example` using the operator's
secret manager or an untracked local `.env`. Do not paste credential values in
this guide, a Hermes prompt, `mcp-config.example.yaml`, or a release archive.

The MCP example references secret names such as `ESPN_S2` and `SWID`; the
gateway must resolve them from its protected environment. The following are
non-secret installation settings and may be exported in the gateway's service
environment:

```bash
export PMT_WORKDIR="/ABSOLUTE/PATH/TO/Pardon_My_Trade"
export PMT_DATA_DIR="/ABSOLUTE/PATH/TO/Pardon_My_Trade/data"
export ESPN_LEAGUE_ID="<LEAGUE_ID>"
export ESPN_SEASON="<SEASON>"
export PMT_LEAGUE_EXTERNAL_ID="<LEAGUE_EXTERNAL_ID>"
export PMT_TEAM_EXTERNAL_ID="<TEAM_EXTERNAL_ID>"
export HERMES_PROVIDER="<PINNED_PROVIDER_ID>"
export HERMES_MODEL="<PINNED_IMMUTABLE_MODEL_ID>"
```

The league and team values are identifiers, not credentials. Never put cookies,
tokens, or passwords in these variables or in a prompt.

### 3. Configure The Read Server

Merge `integrations/hermes/mcp-config.example.yaml` into the Hermes profile
configuration. Replace only path and non-secret placeholders. Keep the
`${ESPN_S2}` and `${SWID}` references resolved by the protected gateway
environment. Keep this entry unchanged unless the compatibility manifest for
the selected PMT release says otherwise.

Trust the project checkout and enable only the skill/toolsets required by the
jobs, following the installed Hermes CLI's `hermes skills trust` and
`hermes tools` commands. The project trust command is:

```bash
hermes skills trust "$PMT_WORKDIR"
```

Do not enable `pmt-operator` for this release.

### 4. Install The Example Jobs

Hermes must be the only scheduler for these jobs. Do not run `pmt daemon` or
`pmt serve --scheduler` at the same time.

```bash
bash "$PMT_WORKDIR/integrations/hermes/install-example-jobs.sh"
hermes cron list --all
```

Set the Hermes gateway timezone to the league's local timezone before enabling
the jobs. Run one read-only job manually after confirming the imported PMT
snapshot, data directory, projection sources, and news settings.

## Upgrade

1. Disable or pause the Hermes jobs in the Hermes control plane and confirm that
   no PMT daemon or `pmt serve --scheduler` process is running.
2. Preserve the PMT data directory and back it up using the operator's approved
   private backup process. Do not put the backup in a release archive.
3. Select the new PMT tag or full commit SHA, then run `npm ci`,
   `npm rebuild better-sqlite3`, and `npm run build` from that checkout.
4. Compare the release's compatibility manifest with the installed
   `pmt-hermes-compatibility.yaml`. Confirm the package, MCP contract, server,
   Node, Hermes gateway, provider, and model pins.
5. Re-merge the matching MCP example if the tool contract changed. Keep
   `pmt-operator` disabled unless the release explicitly passes its Phase 5
   write-executor gate.
6. Recreate or update existing Hermes jobs so their absolute workdir,
   pre-check script, provider, model, skills, and prompt match the new release.
   The example installer intentionally skips jobs that already exist.
7. Run a read-only manual job, inspect its run record, then resume the schedule.

Do not run two versions of the same schedule during a rolling upgrade. If the
new build fails, leave the jobs paused and follow the rollback procedure.

## Rollback

Pause Hermes jobs, check out the previously recorded immutable PMT revision,
run the same dependency install/native rebuild/build sequence, and restore the
matching job configuration. Keep the data directory on its approved backup
path. Verify the read server and one manual read-only job before resuming the
schedule.

## Secret-Free Verification

Before activation, inspect the rendered Hermes configuration and job prompts
for credential values. It should contain references or secret-manager bindings,
not the values of `ESPN_S2`, `SWID`, session cookies, API keys, or passwords.
The pre-check script deliberately does not source `.env`.

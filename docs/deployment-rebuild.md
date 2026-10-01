# Reproducible single-host deployment

This deployment runs the PMT web service and its same-origin UI in a Node 26
container. Caddy terminates HTTPS and obtains/renews a certificate for the
configured DNS name. SQLite state lives in the Docker-managed `pmt-data`
volume at `/data/pmt.sqlite`. The external Hermes gateway remains a separate
process and connects to PMT through the stdio MCP configuration in
[`deploy/hermes/mcp-config.example.yaml`](../deploy/hermes/mcp-config.example.yaml).

## Requirements

- Docker Engine with the Compose v2 plugin.
- A DNS name whose A/AAAA records point at the host, with inbound TCP ports 80
  and 443 available. UDP 443 is optional and enables HTTP/3.
- A unique web password stored only in the untracked `.env` file.

Node 26 is required by `.nvmrc` and `package.json`. The image uses the
`node:26-bookworm-slim` major tag, which can move to a newer Node 26 patch
release over time; record the built image digest when you need an immutable
release. It installs the lockfile with `npm ci`, compiles TypeScript, and
rebuilds `better-sqlite3` for the container runtime. The package engine floor
is also Node 26. The build accepts an optional BuildKit secret named
`proxy_ca` for managed build environments whose npm traffic or native module
rebuild uses a TLS inspection proxy. The certificate is trusted only for the
install/build steps that need it; strict TLS verification remains enabled, and
the certificate is not copied into the image. Ordinary
builds need no secret. If your current build session provides `CODEX_PROXY_CERT`
as the path to its trusted proxy CA, build once with:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t pardon-my-trade:local .
```

Then start Compose without `--build` so it uses that tagged image. This
session-specific certificate option is not needed on a normal VPS build.

## Hosting recommendation

A provider-neutral starting point is an Ubuntu 24.04 LTS VPS with 2 vCPUs,
4 GiB RAM, and at least 40 GiB of SSD storage (or another supported Linux
release with Docker Engine and Compose v2). Run PMT and Caddy with Docker Compose, and run
the Hermes gateway as a separate process on that host. This keeps the app and
SQLite volume on one machine while Hermes owns its own schedule. Allow inbound
TCP 80 and 443 for Caddy, and restrict administrative access such as SSH to
trusted addresses. Choose a VPS region near the operator and available league
services. Increase memory or storage if you retain large historical datasets
or additional model artifacts.

## Start

```sh
cp .env.example .env
```

Edit `.env`: set `PMT_WEB_PASSWORD` to a long, unique password, set
`PMT_DOMAIN` to the DNS name that reaches this host, and optionally set
`PMT_WEB_SESSION_SECRET` to a separate random value. Generate a local value
with `openssl rand -hex 32` and keep it only in `.env`. If omitted, PMT uses
the web password to sign sessions. Keep the session secret stable across
restarts; rotating it signs out existing sessions. Select `PMT_PLATFORM`
(`fixture`, `sleeper`, or `espn`) and set its league/team identifiers as needed.
For ESPN, place `ESPN_S2` and `SWID` in `.env`; never commit or paste those
values into tracked config files. Start the stack:

```sh
docker compose up -d --build
docker compose ps
```

Open `https://${PMT_DOMAIN}` and sign in with the configured web password. The
app binds to `0.0.0.0` inside its isolated Compose network so Caddy can reach it.
Compose does not publish the app port on the host. `PMT_WEB_PASSWORD` enables
web authentication, and `PMT_COOKIE_SECURE=true` marks the session cookie for
HTTPS. Do not expose port 3000 directly or put this service behind a proxy that
does not provide TLS.

The service starts in fixture mode by default. It uses the persistent
`/data/pmt.sqlite` store; replacing or rebuilding the container does not remove
the named volume. Execution is paused: the deployment sets
`PMT_EXECUTION_ENABLED=false` and MCP role `read`. Keep the operator MCP server
disabled until a reviewed canary is complete. Changing the MCP role to
`operator` alone does not turn on execution; enabling execution also requires
`PMT_EXECUTION_ENABLED=true`.

The `/api/health` route returns minimal readiness information without requiring
a login so the container health check can monitor the app. All league and UI
routes require web authentication.

## Hermes gateway

Hermes is not bundled into this image. Configure its external gateway with
[`deploy/hermes/mcp-config.example.yaml`](../deploy/hermes/mcp-config.example.yaml).
It starts isolated PMT MCP stdio containers with the same `pmt-data` volume and
`PMT_DATA_DIR=/data`; the read role is the default and its tool list excludes
operator actions. The operator entry is disabled by default. Keep it disabled
unless the operator canary and safety review have succeeded. No Hermes release
number is assumed or pinned here; record the exact gateway version installed
in your environment alongside the PMT compatibility baseline.

## Hermes advisory schedule

The Compose stack does not install or start Hermes. Install Hermes separately,
select and record its exact gateway version in your environment, and configure
the external gateway with
[`deploy/hermes/mcp-config.example.yaml`](../deploy/hermes/mcp-config.example.yaml).
That MCP entry launches PMT as a short-lived container process over stdio,
using the same Compose project and `pmt-data` volume. It limits the gateway to
read, refresh, and advisory tools. It does not provision Hermes credentials or
choose a provider/model; provide those in the separately installed Hermes
environment and pin the exact provider and model for each scheduled job.

Set the gateway timezone to the league's local timezone, then create these
three scheduled advisory jobs with the Hermes cron mechanism for the pinned
gateway release:

| Job | Local schedule | PMT calls |
| --- | --- | --- |
| `pmt-daily-refresh` | 06:00, Monday-Saturday | `pmt_run_projection_refresh`, `pmt_run_news_injury_refresh`, `pmt_run_advisory_orchestration`, `pmt_list_pending_actions` |
| `pmt-sunday-pre-lock` | 11:00, Sunday | Read rosters, projection provenance, news, and injuries; then `pmt_run_advisory_orchestration` and `pmt_list_pending_actions` |
| `pmt-tuesday-waiver-review` | 13:00, Tuesday | Read free agents and recent transactions; then `pmt_run_advisory_orchestration` and `pmt_list_pending_actions` |

Install the jobs from the PMT checkout after the read MCP entry is configured.
Set the non-secret league/team IDs and exact provider/model IDs selected for the
Hermes gateway:

```sh
export PMT_WORKDIR="/absolute/path/to/Pardon_My_Trade"
export PMT_LEAGUE_EXTERNAL_ID="your-league-id"
export PMT_TEAM_EXTERNAL_ID="your-team-id"
export HERMES_PROVIDER="your-pinned-provider-id"
export HERMES_MODEL="your-immutable-model-id"
bash "$PMT_WORKDIR/deploy/hermes/install-advisory-jobs.sh"
hermes cron list --all
```

Set the Hermes gateway timezone to the league's local timezone before the first
run. Existing jobs with these names are left alone; remove or edit them through
your installed Hermes release if their schedule or prompt needs changing. Each
job stops if league state is unavailable, reports source errors, and preserves
pending action IDs for human review. Keep the schedule advisory: these jobs
must not approve, reject, or execute actions. Leave `pmt-operator` disabled and
`PMT_EXECUTION_ENABLED=false`. Do not schedule a second PMT or Hermes owner
against the same data volume. A durable scheduler service with one-minute
idempotency keys and leases is future work; this Compose setup does not yet
provide cross-process job claiming.

This package contains deployment artifacts only. It has not created a VPS,
installed Hermes, or deployed a hosted service.

## Backup and restore

SQLite backup uses its online backup API, which is safe while PMT is running.
The Compose wrapper writes a consistent SQLite backup under `./backups/`:

```sh
sh deploy/scripts/backup.sh
```

Set `PMT_BACKUP_DIR=/absolute/path` to select another destination. Backups
contain league data and should be protected with the same care as the data
volume. The backup script verifies SQLite integrity before reporting success.

Restore stops the web service before replacing the database and verifies the
backup before and after copying it. Supply a backup path on the Docker host:

```sh
sh deploy/scripts/restore.sh /absolute/path/to/pmt-20261001T120000Z.sqlite
docker compose up -d
```

Restore leaves Caddy running while PMT is stopped. Do not run any other PMT
process against the volume during restore. To take a portable copy of the full
volume, stop PMT first; the SQLite online backup is preferred for routine
backups.

## Health, logs, and updates

```sh
docker compose ps
docker compose logs --tail=100 pmt caddy
docker compose up -d --build
```

`/api/health` is a readiness check only, not a complete dependency or data
freshness monitor. Confirm the UI and imported league data after upgrades.
Retain a verified SQLite backup before an upgrade. To roll back, rebuild from
the previous immutable source revision and restore the pre-upgrade database
backup if a migration changed its format.

## Local CLI

Outside Docker, the app binds to `127.0.0.1` by default. Do not set
`PMT_HOST=0.0.0.0` on a directly exposed host process. For persistent local
runs, set `PMT_DATA_DIR` to a durable directory; PMT writes its SQLite database
there. Node 26 is required.

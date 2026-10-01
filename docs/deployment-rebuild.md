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

Node 26 is pinned by `.nvmrc`, `package.json`, and the Docker image. The image
installs the lockfile with `npm ci`, compiles TypeScript, and rebuilds
`better-sqlite3` for the container runtime. The package engine floor is also
Node 26.

## Start

```sh
cp .env.example .env
```

Edit `.env`: set `PMT_WEB_PASSWORD` to a long, unique password and set
`PMT_DOMAIN` to the DNS name that reaches this host. Select `PMT_PLATFORM`
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

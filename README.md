# Pardon My Trade

Documentation-first foundation for an autonomous Fantasy Sports General Manager.

Current milestone: Phase 0 - Documentation Sprint (complete). MVP complete; V1 (Daily Fantasy General Manager) implemented.

Current implementation target: Version 1 - Daily Fantasy General Manager.

Built so far (MVP + V1):

- Canonical domain models (`src/models`, including `v1.ts` V1 types).
- Fixture platform adapter (read-only) and a real read-only Sleeper adapter (`src/adapters`).
- Knowledge repository interface + in-memory and SQLite implementations (`src/knowledge`).
- Deterministic rule engine: lineup legality, scoring, eligibility, waiver/trade/completeness validation (`src/rules`).
- Decision engine: lineup, waiver, drop, and trade candidate generation + weekly report inputs (`src/decisions`).
- Recommendation engine: candidate ranking, evidence attachment, contract validation, and weekly report generation (`src/recommendations`).
- V1 services: scheduler (`src/scheduler`), news ingestion (`src/news`), projection consensus engine (`src/projections`), injury monitor / manager profiles / league intelligence (`src/intelligence`), historical tracking + V1 store (`src/history`), notifications (`src/notifications`).
- End-to-end pipelines: `weekly-report` and `refresh` (`src/pipeline`).
- Local web GUI: HTTP API + single-page app (`src/api`, `public/index.html`).

The MVP is being built fixture-first and credential-free. Live fantasy platform logins, GitHub remote setup, and AI provider keys are intentionally postponed.

## Storage

The knowledge layer implements the `KnowledgeRepository` interface. Two implementations are available:

- `InMemoryKnowledgeRepository` — default for tests and short-lived CLI runs (immutable snapshots per ADR-0004).
- `SqliteKnowledgeRepository` — local file-backed SQLite store (via `better-sqlite3`), the recommended MVP default for development and production per `docs/09-knowledge-base.md`.

Snapshots are immutable: re-saving an existing `snapshot_id` throws. Recommendations and decision audits are upserted by id.

## Local Development

The current implementation is TypeScript with read-only fixture and Sleeper adapters.

Commands:

```text
npm install
npm run build
npm test
npm run pmt -- import-fixture
npm run pmt -- weekly-report [leagueExternalId] [teamExternalId]
npm run refresh [leagueExternalId] [teamExternalId]
npm run serve
```

`npm run refresh` runs the full V1 refresh pipeline (news ingestion, projection consensus, injury alerts, manager-profile updates, historical recording, weekly report, and notifications). `npm run serve` starts a local web GUI at `http://localhost:3000` backed by file-backed SQLite stores under `data/`; use the **Run Refresh** button to trigger a refresh and view the weekly report, alerts, manager profiles, and news.

Environment overrides: `PMT_DATA_DIR`, `PMT_PORT`, `PMT_NEWS_PATH`, `PMT_FIXTURE_PATH`.

Credential-free fixture verification is also available through PowerShell:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-fixture.ps1
```

## Hooking up a real league (Sleeper)

The Sleeper adapter (`src/adapters/sleeper`) reads public league data from Sleeper's API **read-only and without credentials** (public leagues; consistent with ADR-0005). The `import-sleeper` command assembles a canonical `LeagueSnapshot` from a live league and stores it in the SQLite knowledge store:

```text
npm run pmt -- import-sleeper <your-sleeper-league-id> [season]
npm run serve
```

After import, open `http://localhost:3000` — `serve` loads the most recently imported snapshot and the **Run Refresh** button runs the full V1 pipeline against your league.

**Current limitation:** a `LeagueSnapshot` also requires `projections` and `news`, which the Sleeper adapter does not yet provide. Until a projection/news source is connected, imported leagues show structure, rosters, standings, free agents, and waiver order, but weekly reports will have zero projected points and no waiver/trade candidates. You can supply your own data by passing `projections`/`news` into `buildSnapshotFromPlatform` (see `src/knowledge/ingestion.ts`), or wait for the V2 projection-ingestion work package. Live platform logins and any league actions remain intentionally out of scope.

## Documentation Package

- [System Vision](docs/01-system-vision.md)
- [Requirements Specification](docs/02-requirements.md)
- [Architecture Specification](docs/03-architecture.md)
- [Data Model Specification](docs/04-data-models.md)
- [API Specification](docs/05-api-specification.md)
- [Platform Adapter Specification](docs/06-platform-adapters.md)
- [Agent Specification](docs/07-agent-specification.md)
- [Rule Engine Specification](docs/08-rule-engine.md)
- [Knowledge Base Specification](docs/09-knowledge-base.md)
- [Notification Specification](docs/10-notifications.md)
- [Security Specification](docs/11-security.md)
- [Testing Specification](docs/12-testing.md)
- [Deployment Specification](docs/13-deployment.md)
- [Coding Standards](docs/14-coding-standards.md)
- [Prompt Standards](docs/15-prompt-standards.md)
- [Implementation Roadmap](docs/16-implementation-roadmap.md)
- [Development Guide](docs/17-development-guide.md)
- [Interface Catalog](docs/18-interface-catalog.md)
- [Configuration Specification](docs/19-configuration.md)
- [ADR Index](docs/adr/README.md)

## Phase 0 Exit Criteria

- Documentation complete.
- Architecture reviewed and approved.
- Interfaces frozen for MVP.
- Data model approved for MVP.
- ADRs accepted for initial architectural decisions.

Implementation begins only after these items are approved.

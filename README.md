# Pardon My Trade

Documentation-first foundation for an autonomous Fantasy Sports General Manager.

Current milestone: Phase 0 - Documentation Sprint (complete). MVP in progress.

Current implementation target: MVP - Single League Assistant (recommendation-only).

Built so far:

- Canonical domain models (`src/models`).
- Fixture platform adapter (read-only) and a real read-only Sleeper adapter (`src/adapters`).
- Knowledge repository interface + in-memory implementation (`src/knowledge`).
- Deterministic rule engine: lineup legality, scoring, eligibility, waiver/trade/completeness validation (`src/rules`).
- Decision engine: lineup, waiver, drop, and trade candidate generation + weekly report inputs (`src/decisions`).
- Recommendation engine: candidate ranking, evidence attachment, contract validation, and weekly report generation (`src/recommendations`).
- End-to-end weekly-report pipeline (`src/pipeline`).

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
```

Credential-free fixture verification is also available through PowerShell:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-fixture.ps1
```

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

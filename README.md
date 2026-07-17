# Pardon My Trade

Documentation-first foundation for an autonomous Fantasy Sports General Manager.

Current milestone: Phase 0 - Documentation Sprint.

Current implementation target: MVP Phase 1-3.

The MVP is being built fixture-first and credential-free. Live fantasy platform logins, GitHub remote setup, and AI provider keys are intentionally postponed.

## Local Development

The current implementation is TypeScript with a read-only fixture adapter.

Planned commands once Node.js dependencies are installed:

```text
npm install
npm run build
npm test
npm run pmt -- import-fixture
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

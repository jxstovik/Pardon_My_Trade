# Deployment Specification

Document ID: FDP-DEPLOY-001  
Status: Draft  
Milestone: Foundation

## Deployment Stages

### Local Development

- Local environment variables.
- Fixture adapter.
- SQLite or local Postgres.
- Mock AI provider.

### MVP Production

- Single-user or small hosted deployment.
- Read-only platform adapter credentials.
- Postgres-compatible database.
- Managed secret storage.
- Structured logs.

### Enterprise

- Multi-user service.
- Distributed workers.
- RBAC.
- Centralized audit logging.
- Queue-based background jobs.
- Scalable notification workers.

## Environment Configuration

Required configuration groups:

- app.
- database.
- platform adapters.
- AI providers.
- scheduler.
- notifications.
- security.
- observability.

## Release Requirements

Each release must include:

- Version number.
- Migration notes.
- Configuration changes.
- Test results.
- Known limitations.
- Rollback guidance.
- Release notes.

## Operational Metrics

- Data refresh success rate.
- Data freshness.
- Recommendation latency.
- Adapter error rate.
- Provider error rate.
- Background job failure rate.
- Notification delivery rate.

## MVP Deployment Recommendation

Use a simple server process and relational database before adding distributed workers. Distributed scheduling should wait until Version 1.

# Configuration Specification

Document ID: FDP-CONFIG-001  
Status: Draft  
Milestone: Foundation

## Purpose

Configuration controls sports, scoring, roster rules, platform adapters, provider routing, recommendation policies, storage, observability, and safety settings.

## Configuration Principles

- Configuration is explicit and versioned.
- Environment-specific values are separated from domain policy.
- Secrets are never committed.
- Scoring and roster rules are data-driven where practical.
- Provider selection is configurable.

## Configuration Groups

### App

- app_name
- environment
- version
- timezone
- default_sport

### Database

- provider
- connection_url_secret_ref
- migration_mode
- retention_policy

### Platform Adapters

- enabled_platforms
- default_platform
- credential_secret_refs
- rate_limit_policy
- fixture_mode

### AI Providers

- enabled_providers
- default_provider
- model_routing_policy
- timeout_ms
- retry_policy
- cost_budget

### Rules

- sport
- scoring_settings
- roster_settings
- waiver_policy
- trade_policy
- recommendation_thresholds

### Recommendation Policy

- confidence_thresholds
- risk_levels
- expiration_windows
- evidence_requirements
- alternative_count

### Observability

- log_level
- metrics_enabled
- tracing_enabled
- audit_enabled

### Security

- secret_provider
- encryption_required
- read_only_mode
- approval_required

## MVP Required Settings

MVP configuration must support:

- fixture platform adapter.
- one real read-only platform adapter.
- local database provider.
- mock AI provider.
- at least one real AI provider adapter when enabled.
- read_only_mode set to true.

## Versioning

Each configuration bundle includes:

- config_version.
- schema_version.
- created_at.
- environment.
- checksum.

Recommendation audits must record the config_version used.

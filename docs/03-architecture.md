# Architecture Specification

Document ID: FDP-ARCH-001  
Status: Draft  
Milestone: Foundation

## Architectural Style

The system uses a ports-and-adapters architecture. Core domain logic depends on interfaces. External services are accessed through adapters.

## MVP Context

```text
Fantasy Platform
        |
        v
Platform Adapter
        |
        v
Knowledge Database
        |
        v
Decision Engine
        |
        v
Recommendation API/UI
```

## Core Components

### Platform Adapter Layer

Imports league, roster, scoring, standings, schedule, player, transaction, free agent, waiver, and trade data from fantasy platforms.

The adapter layer owns platform-specific authentication, rate limits, field mappings, pagination, retries, and platform quirks.

### Data Ingestion Layer

Normalizes imported platform data into canonical domain models. Validates required fields and attaches provenance metadata.

### Knowledge Database

Stores normalized league snapshots, roster state, player state, projections, news, historical recommendations, outcomes, and manager tendencies.

### Rule Engine

Evaluates league configuration, roster constraints, scoring rules, eligibility, waiver rules, trade rules, and configurable policies.

### Decision Engine

Combines deterministic rules, projections, rankings, risk models, and optional AI-assisted reasoning to produce candidate recommendations.

### Recommendation Engine

Ranks candidates, attaches explanations, validates required evidence, and produces final recommendation payloads.

### AI Provider Layer

Provides provider-neutral completion, structured output, embedding, classification, summarization, and critique capabilities. It does not own fantasy business logic.

### User Interface Layer

Presents recommendations, evidence, alternatives, and approval state. MVP may expose CLI, API, or web UI, but must preserve the same recommendation contracts.

## Dependency Rules

- Core domain must not depend on platform SDKs.
- Core domain must not depend on AI SDKs.
- Adapters may depend on external SDKs.
- Prompts may request formatting, critique, or summarization, but not define roster legality, scoring rules, or transaction policy.
- Data model packages must be shared across adapters, engines, APIs, and tests.

## Primary Data Flow

1. Platform adapter imports raw platform data.
2. Ingestion validates and normalizes data.
3. Knowledge database stores league snapshot and provenance.
4. Rule engine evaluates league constraints.
5. Decision engine generates candidate decisions.
6. Optional AI provider explains, critiques, or summarizes decisions.
7. Recommendation engine validates output completeness.
8. UI/API returns recommendations to the user.

## MVP Runtime Boundaries

MVP allows:

- Read-only platform imports.
- Local or server-side analysis.
- Recommendation generation.
- Human-readable reports.

MVP forbids:

- League action execution.
- Credential sharing across users.
- Autonomous background changes.
- Hidden prompt-only decision rules.

## Future Agentic Architecture

```text
Coordinator
      |
      v
Planner
      |
      v
Worker Agents
      |
      v
Shared Memory
      |
      v
Recommendation Engine
```

The coordinator owns workflow orchestration. Worker agents produce bounded analyses. Shared memory stores facts, evidence, and prior outcomes. The recommendation engine remains the final authority for output shape and completeness.

## Error Handling

All components must return typed errors with:

- Error code.
- Human-readable message.
- Retryability.
- Source component.
- Correlation ID.
- Remediation guidance when available.

## Observability

Minimum telemetry:

- Import duration and freshness.
- Recommendation latency.
- Rule evaluation failures.
- Provider failures.
- Adapter rate limits.
- Data validation failures.
- Recommendation acceptance outcomes when available.

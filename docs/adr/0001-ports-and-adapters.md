# ADR-0001: Use Ports And Adapters Architecture

Status: Accepted  
Date: 2026-07-10

## Context

The platform must remain independent of fantasy platforms, AI providers, notification providers, and storage implementations.

## Decision

Use a ports-and-adapters architecture. Core domain logic depends on interfaces. Platform APIs, AI providers, notification channels, and persistence implementations live behind adapters.

## Consequences

- Vendor changes require adapter changes rather than core rewrites.
- Tests can use fixture adapters.
- Initial implementation requires more interface design.

## Alternatives Considered

- Direct platform SDK usage in services. Rejected because it creates vendor lock-in.
- Prompt-centric orchestration. Rejected because business logic would become hard to test and audit.

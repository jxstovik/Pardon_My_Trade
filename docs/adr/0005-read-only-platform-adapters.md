# ADR-0005: Start With Read-Only Platform Adapters

Status: Accepted  
Date: 2026-07-10

## Context

The roadmap requires human approval before league actions. Platform action APIs differ substantially and may carry account risk.

## Decision

Initial platform adapters are read-only. Action methods are reserved for future versions and require approval tokens, dry-run previews, audit records, and idempotency keys.

## Consequences

- MVP cannot accidentally change league state.
- Adapters can focus on import correctness.
- Later automation work has a cleaner safety boundary.

## Alternatives Considered

- Implement action methods as disabled stubs in MVP. Deferred to avoid normalizing a risky interface before approval workflow requirements are complete.

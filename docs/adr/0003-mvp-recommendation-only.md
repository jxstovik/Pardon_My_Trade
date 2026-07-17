# ADR-0003: MVP Is Recommendation Only

Status: Accepted  
Date: 2026-07-10

## Context

Automated fantasy transactions carry user trust, authorization, timing, and recovery risks.

## Decision

MVP will generate recommendations only. Users manually perform all league actions outside the system.

## Consequences

- Lower integration and safety risk.
- Faster path to useful MVP.
- Future action execution requires explicit approval workflows and additional audit controls.

## Alternatives Considered

- Include transaction submission in MVP. Rejected because approval, rollback, and platform-specific risk are too high for the initial release.

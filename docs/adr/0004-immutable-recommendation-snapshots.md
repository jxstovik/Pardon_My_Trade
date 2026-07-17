# ADR-0004: Use Immutable Recommendation Snapshots

Status: Accepted  
Date: 2026-07-10

## Context

Recommendations must be explainable and reproducible. League state, projections, and news can change frequently.

## Decision

Recommendation generation uses immutable input snapshots. New imports create new snapshots. Recommendation audits reference the exact snapshot and configuration version used.

## Consequences

- Recommendations can be reproduced and audited.
- Storage volume increases.
- Snapshot retention policy is required.

## Alternatives Considered

- Generate recommendations from mutable current state only. Rejected because it weakens auditability.

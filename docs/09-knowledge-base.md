# Knowledge Base Specification

Document ID: FDP-KB-001  
Status: Draft  
Milestone: Foundation

## Purpose

The knowledge base stores canonical league state, historical data, evidence, projections, recommendations, outcomes, and memory. It provides reproducible input snapshots to the decision engine.

## Storage Responsibilities

- League snapshots.
- Roster snapshots.
- Player snapshots.
- Platform raw payloads.
- Projection snapshots.
- News items.
- Recommendation records.
- Decision audits.
- Manager profiles.
- Outcome tracking.
- Configuration versions.

## Data Provenance

Every stored fact must include:

- source.
- source_type.
- observed_at.
- ingested_at.
- source_record_id when available.
- confidence when applicable.

## Snapshot Semantics

Recommendation generation operates on immutable snapshots. Refreshing data creates a new snapshot rather than mutating the prior recommendation context.

## MVP Storage Options

Acceptable MVP storage:

- Local SQLite.
- Postgres.
- JSON fixture store for development and tests.

The recommended MVP default is SQLite for local development and Postgres compatibility for production deployment.

## Memory Types

- Fact memory: durable facts from platform data.
- Recommendation memory: prior recommendation and outcome records.
- Manager memory: observed manager tendencies.
- User preference memory: explicit user settings.
- Agent memory: future agent notes with expiry and provenance.

## Retention

Default retention:

- Raw platform payloads: 90 days.
- League snapshots: full season.
- Recommendation audits: full season plus one year.
- Security logs: per deployment policy.

Retention policies must be configurable.

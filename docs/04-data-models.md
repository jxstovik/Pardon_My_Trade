# Data Model Specification

Document ID: FDP-DATA-001  
Status: Draft  
Milestone: Foundation

## Modeling Principles

- Domain models are canonical and platform-neutral.
- Raw platform payloads are stored separately from normalized records.
- Every imported fact carries source, timestamp, and confidence when applicable.
- Sport-specific extensions are explicit and versioned.

## Core Entities

### League

- league_id
- platform
- sport
- season
- name
- teams
- roster_settings
- scoring_settings
- waiver_settings
- trade_settings
- schedule
- import_metadata

### Team

- team_id
- league_id
- manager_id
- name
- roster
- standings
- transaction_history

### Manager

- manager_id
- display_name
- contact_preferences
- observed_behavior_profile

### Player

- player_id
- sport
- full_name
- team
- positions
- status
- injury_status
- eligibility
- external_ids

### RosterSlot

- slot_id
- slot_type
- allowed_positions
- locked
- player_id

### Roster

- team_id
- starters
- bench
- injured_reserve
- taxi
- last_updated_at

### ScoringRule

- rule_id
- category
- stat
- points
- conditions
- applies_to_positions

### Matchup

- matchup_id
- league_id
- scoring_period
- team_id
- opponent_team_id
- projected_points_for
- projected_points_against
- actual_points_for
- actual_points_against

### Projection

- projection_id
- player_id
- source
- scoring_period
- projected_stats
- projected_points
- floor
- ceiling
- confidence
- created_at

### NewsItem

- news_id
- player_id
- source
- headline
- summary
- impact
- published_at
- ingested_at

### Recommendation

- recommendation_id
- league_id
- team_id
- type
- title
- recommendation
- reasoning
- evidence
- confidence
- risk
- expected_benefit
- assumptions
- alternatives
- generated_at
- expiration
- status

### Evidence

- evidence_id
- source
- source_type
- observed_at
- claim
- value
- confidence
- link

### DecisionAudit

- audit_id
- recommendation_id
- inputs_hash
- config_version
- engine_version
- provider_calls
- validation_results
- generated_at

## Recommendation Types

- lineup
- bench
- waiver_claim
- drop
- trade
- weekly_report
- alert
- playoff_plan
- season_strategy

## Status Values

Recommendation status:

- draft
- ready
- viewed
- accepted
- rejected
- expired
- superseded

Player status:

- active
- questionable
- doubtful
- out
- injured_reserve
- suspended
- bye
- unknown

## Data Versioning

Each persisted aggregate must include:

- schema_version
- created_at
- updated_at
- source_system
- source_record_id where applicable

Breaking schema changes require an ADR and migration specification.

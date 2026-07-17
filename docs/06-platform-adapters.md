# Platform Adapter Specification

Document ID: FDP-ADAPTER-001  
Status: Draft  
Milestone: Foundation

## Purpose

Platform adapters isolate fantasy platform APIs, authentication, rate limits, payload formats, and platform-specific behavior from the core system.

## Supported Adapter Interface

Initial adapter methods:

- getLeague(leagueExternalId, season)
- getTeams(leagueExternalId)
- getRoster(leagueExternalId, teamExternalId)
- getScoringSettings(leagueExternalId)
- getRosterSettings(leagueExternalId)
- getStandings(leagueExternalId)
- getSchedule(leagueExternalId)
- getPlayers(sport, season)
- getFreeAgents(leagueExternalId)
- getWaiverState(leagueExternalId)
- getTransactions(leagueExternalId, since)

MVP adapters are read-only.

## Adapter Responsibilities

- Authenticate with platform.
- Respect rate limits.
- Normalize IDs.
- Map platform fields to canonical models.
- Preserve raw payloads for debugging and audit.
- Return typed errors.
- Provide fixture mode for tests.

## Adapter Non-Responsibilities

Adapters must not:

- Make recommendations.
- Evaluate scoring rules beyond mapping.
- Call AI providers.
- Execute transactions in MVP.
- Persist canonical data directly without ingestion layer coordination.

## Initial Platform Strategy

Sleeper is the recommended first MVP platform because it offers accessible league data APIs and lowers integration risk. ESPN and Yahoo should follow after adapter contracts stabilize.

This is an implementation recommendation, not a hard architectural dependency.

## Authentication Classes

- Public league access.
- OAuth.
- Cookie/session-based access.
- API key.
- Manual import fixtures.

Cookie/session-based adapters require additional security review before production use.

## Future Action Interface

Reserved for post-MVP:

- proposeLineupChange
- submitWaiverClaim
- cancelWaiverClaim
- addPlayer
- dropPlayer
- proposeTrade
- acceptTrade

Each action must require an approval token, audit record, dry-run preview, and idempotency key.

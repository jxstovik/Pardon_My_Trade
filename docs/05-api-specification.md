# API Specification

Document ID: FDP-API-001  
Status: Draft  
Milestone: Foundation

## API Principles

- APIs expose canonical models, not platform-specific payloads.
- All write-like league actions are disabled for MVP.
- Every request and response includes a correlation ID.
- Recommendation responses must satisfy the explainability contract.

## MVP Service Interfaces

### League Import

`POST /leagues/import`

Imports or refreshes a league snapshot through a configured platform adapter.

Request:

```json
{
  "platform": "sleeper",
  "leagueExternalId": "string",
  "season": "2026",
  "sport": "football"
}
```

Response:

```json
{
  "correlationId": "string",
  "leagueId": "string",
  "snapshotId": "string",
  "status": "imported",
  "importedAt": "2026-07-10T00:00:00Z"
}
```

### League Snapshot

`GET /leagues/{leagueId}/snapshot`

Returns normalized league, roster, schedule, scoring, standings, free agent, and waiver state.

### Generate Weekly Report

`POST /recommendations/weekly-report`

Request:

```json
{
  "leagueId": "string",
  "teamId": "string",
  "scoringPeriod": "2026-W01",
  "includeTrades": true,
  "includeWaivers": true
}
```

Response:

```json
{
  "correlationId": "string",
  "recommendations": []
}
```

### Generate Lineup Recommendation

`POST /recommendations/lineup`

Returns ranked starter and bench configuration candidates.

### Generate Waiver Recommendations

`POST /recommendations/waivers`

Returns ranked waiver claims with drop candidates and bid guidance when applicable.

### Generate Trade Recommendations

`POST /recommendations/trades`

Returns candidate trade opportunities and rationale.

## Recommendation Contract

Every recommendation item must include:

```json
{
  "recommendationId": "string",
  "type": "lineup",
  "title": "string",
  "recommendation": "string",
  "reasoning": ["string"],
  "evidence": [],
  "confidence": 0.0,
  "risk": {
    "level": "low",
    "factors": []
  },
  "expectedBenefit": {
    "metric": "projected_points",
    "value": 0.0,
    "range": [0.0, 0.0]
  },
  "assumptions": [],
  "alternatives": [],
  "expiresAt": "2026-07-10T00:00:00Z"
}
```

## Error Contract

```json
{
  "correlationId": "string",
  "error": {
    "code": "ADAPTER_RATE_LIMITED",
    "message": "string",
    "source": "platform_adapter",
    "retryable": true,
    "remediation": "string"
  }
}
```

## Action Safety

The following endpoint classes are reserved for future versions and must not exist in MVP:

- Submit lineup.
- Submit waiver claim.
- Drop player.
- Add player.
- Propose trade.
- Accept trade.
- Send platform message.

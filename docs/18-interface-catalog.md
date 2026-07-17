# Interface Catalog

Document ID: FDP-IFACE-001  
Status: Draft  
Milestone: Foundation

## Purpose

This catalog lists the interfaces that must be stable before MVP implementation begins.

## MVP Interface Freeze Candidates

### PlatformReader

Read-only fantasy platform access.

Methods:

- getLeague
- getTeams
- getRoster
- getScoringSettings
- getRosterSettings
- getStandings
- getSchedule
- getPlayers
- getFreeAgents
- getWaiverState
- getTransactions

### KnowledgeRepository

Snapshot and audit persistence.

Methods:

- saveLeagueSnapshot
- getLeagueSnapshot
- saveRecommendation
- getRecommendation
- saveDecisionAudit
- getDecisionAudit
- listRecommendations

### RuleEngine

Deterministic rule evaluation.

Methods:

- validateLineup
- calculateProjectedScore
- getEligibleSlots
- validateWaiverRecommendation
- validateTradeRecommendation
- validateRecommendationCompleteness

### DecisionEngine

Candidate recommendation generation.

Methods:

- generateLineupCandidates
- generateWaiverCandidates
- generateDropCandidates
- generateTradeCandidates
- generateWeeklyReportInputs

### RecommendationEngine

Final recommendation ranking and contract enforcement.

Methods:

- rankCandidates
- attachEvidence
- validateRecommendation
- generateWeeklyReport

### AIProvider

Provider-neutral model access.

Methods:

- completeStructured
- summarize
- critique
- classify
- embed

### NotificationProvider

Future notification delivery.

Methods:

- sendNotification
- getDeliveryStatus
- listUserPreferences

## Interface Freeze Rule

After Foundation approval, breaking interface changes require:

- ADR.
- Specification update.
- Migration note.
- Test fixture update.
- Version increment.

## MVP Safety Rule

No MVP interface may expose a method that executes a league action. Action interfaces are reserved for Version 4 or later approval workflows.

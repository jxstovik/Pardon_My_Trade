# Agent Specification

Document ID: FDP-AGENT-001  
Status: Draft  
Milestone: Foundation

## Agent Principle

Agents assist with analysis, planning, summarization, critique, and synthesis. Agents do not own fantasy business logic. Deterministic rules, typed models, and decision engines remain authoritative.

## MVP Agent Model

MVP may use a single recommendation assistant role through the AI provider interface. Its responsibilities are limited to:

- Summarize deterministic analysis.
- Improve explanation clarity.
- Identify missing evidence.
- Critique recommendation completeness.

## Version 2 Agent Roles

### Coordinator

Owns workflow execution, task ordering, time budgets, and final aggregation.

### Planner

Breaks high-level objectives into bounded analysis tasks.

### League Agent

Analyzes standings, schedule, scoring settings, roster constraints, and league tendencies.

### Player Agent

Analyzes player profiles, usage trends, injuries, depth chart status, projections, and risk.

### Trade Agent

Identifies trade opportunities, manager fit, asset values, fairness, and negotiation strategy.

### Waiver Agent

Identifies free agent priorities, bid guidance, streaming candidates, and drop pairings.

### Lineup Agent

Evaluates legal lineup combinations, upside, floor, matchup risk, and positional scarcity.

### News Agent

Monitors news and injury changes, deduplicates reports, classifies impact, and triggers alerts.

### Memory Agent

Maintains historical facts, manager profiles, prior recommendations, outcomes, and learned preferences.

### Projection Agent

Combines projection sources, evaluates confidence, and detects projection anomalies.

## Agent Communication Contract

Agent outputs must include:

- task_id
- agent_id
- input_refs
- claims
- evidence
- confidence
- uncertainty
- recommended_next_steps
- validation_status

## Guardrails

- Agents must cite data references from the knowledge base.
- Agents must not invent scoring rules or roster constraints.
- Agents must not request or execute league actions.
- Agents must return uncertainty when evidence is insufficient.
- Final recommendations must pass recommendation contract validation.

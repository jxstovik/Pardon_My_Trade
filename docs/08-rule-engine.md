# Rule Engine Specification

Document ID: FDP-RULE-001  
Status: Draft  
Milestone: Foundation

## Purpose

The rule engine evaluates deterministic fantasy constraints and configurable policies. It is the source of truth for legal roster construction, scoring interpretation, waiver eligibility, trade constraints, and recommendation validation.

## Rule Categories

- Roster slot legality.
- Position eligibility.
- Starter and bench limits.
- Injured reserve eligibility.
- Taxi squad eligibility.
- Scoring calculation.
- Waiver eligibility.
- Waiver priority or FAAB policy.
- Trade deadline and veto rules.
- Locked player handling.
- Bye week handling.
- Risk thresholds.
- Recommendation completeness.

## Configuration Format

Rules should be data-driven where practical:

```json
{
  "schemaVersion": "1.0.0",
  "sport": "football",
  "rosterSlots": [
    { "slot": "QB", "count": 1, "positions": ["QB"] },
    { "slot": "RB", "count": 2, "positions": ["RB"] },
    { "slot": "WR", "count": 2, "positions": ["WR"] },
    { "slot": "TE", "count": 1, "positions": ["TE"] },
    { "slot": "FLEX", "count": 1, "positions": ["RB", "WR", "TE"] }
  ],
  "scoring": [
    { "stat": "passing_yards", "points": 0.04 },
    { "stat": "passing_touchdowns", "points": 4 },
    { "stat": "interceptions", "points": -2 }
  ]
}
```

## Rule Evaluation Output

Each evaluation returns:

- valid
- violations
- warnings
- applied_rules
- calculated_values
- explanation

## MVP Required Rules

- Validate a lineup is legal.
- Score projected stats under league settings.
- Identify player eligibility for roster slots.
- Identify locked players.
- Validate waiver recommendation includes an add and drop when roster is full.
- Validate trade recommendation does not violate roster constraints.

## Testing Requirements

- Golden tests for common fantasy football scoring systems.
- Property tests for lineup legality where supported.
- Fixture tests for platform-specific roster settings.
- Regression tests for edge cases such as dual eligibility, IR, and locked games.

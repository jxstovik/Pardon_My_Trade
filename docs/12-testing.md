# Testing Specification

Document ID: FDP-TEST-001  
Status: Draft  
Milestone: Foundation

## Testing Goals

- Validate deterministic business logic.
- Prevent adapter regressions.
- Ensure recommendations satisfy explainability requirements.
- Verify no MVP code can execute league actions.
- Support reproducible simulation.

## Test Pyramid

### Unit Tests

Required for:

- Rule evaluation.
- Scoring calculations.
- Lineup legality.
- Recommendation ranking helpers.
- Data model validation.
- Error mapping.

### Integration Tests

Required for:

- Platform adapter fixture imports.
- Knowledge database persistence.
- Recommendation generation from snapshots.
- API contract validation.

### Contract Tests

Required for:

- Platform adapter interfaces.
- AI provider interfaces.
- Recommendation response schemas.
- Error response schemas.

### Simulation Tests

Required before release:

- Historical week replay.
- Waiver recommendation replay.
- Lineup recommendation replay.
- Trade analysis sanity checks.

## Fixtures

Fixtures must include:

- Standard redraft PPR league.
- Half-PPR league.
- Superflex league.
- Keeper or dynasty league.
- Injured reserve edge cases.
- Bye week edge cases.
- Locked player edge cases.

## AI Testing

AI provider calls must be mockable and replayable. Tests must validate structured outputs and schema compliance rather than exact prose.

## MVP Definition Of Test Done

- Unit tests pass.
- Integration tests pass against fixture adapter.
- Recommendation schema validation passes.
- At least one historical simulation is documented.
- Coverage report is generated.

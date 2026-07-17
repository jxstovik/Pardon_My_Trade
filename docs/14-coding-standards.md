# Coding Standards

Document ID: FDP-CODE-001  
Status: Draft  
Milestone: Foundation

## General Standards

- Keep business logic outside prompts.
- Depend on interfaces, not concrete vendors.
- Prefer explicit types and schemas for boundaries.
- Keep adapters thin and core logic platform-neutral.
- Fail with typed errors.
- Log structured events with correlation IDs.
- Keep functions small enough to test directly.
- Avoid hidden global state.
- Avoid time-dependent logic without injectable clocks.

## Repository Standards

Recommended future structure:

```text
src/
  core/
  rules/
  decisions/
  recommendations/
  adapters/
    platforms/
    ai/
    notifications/
  knowledge/
  api/
  config/
tests/
  unit/
  integration/
  contract/
  fixtures/
docs/
  adr/
```

## Interface Standards

Interfaces must document:

- Purpose.
- Inputs.
- Outputs.
- Error behavior.
- Idempotency behavior.
- Test fixture strategy.

## Error Standards

Errors must include:

- code.
- message.
- source.
- retryable.
- correlation_id.
- cause when available.

## Documentation Standards

Feature work requires updates to:

- Architecture when boundaries change.
- Specification when behavior changes.
- Interfaces when contracts change.
- Tests when risk changes.
- ADRs for significant decisions.
- Release notes for user-visible changes.

## Definition Of Done

A feature is complete only when:

- Architecture updated.
- Specification updated.
- Interfaces documented.
- Configuration documented.
- Tests written.
- Tests passing.
- Simulation completed when applicable.
- Documentation updated.
- Logging added.
- Metrics collected.
- Error handling documented.
- Release notes drafted.

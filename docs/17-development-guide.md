# Development Guide

Document ID: FDP-DEV-001  
Status: Draft  
Milestone: Foundation

## Development Lifecycle

Every feature follows this lifecycle:

```text
Idea
 |
 v
RFC
 |
 v
Specification
 |
 v
Architecture Review
 |
 v
Implementation
 |
 v
Testing
 |
 v
Simulation
 |
 v
Documentation
 |
 v
Release
```

No production code should be written without an approved specification.

## Required Context For Coding Agents

Each implementation task must provide:

- System vision.
- Current milestone.
- Architecture specification.
- Relevant API and interface contracts.
- Coding standards.
- ADRs.
- Acceptance criteria.
- Test requirements.
- Definition of done.

Agents should not infer missing requirements when the missing detail changes behavior, safety, or data contracts.

## Feature Workflow

1. Create or update an RFC.
2. Update the relevant specification.
3. Identify impacted interfaces and data models.
4. Add or update ADRs for significant decisions.
5. Implement behind interfaces.
6. Add unit, integration, and contract tests.
7. Run fixture simulations where applicable.
8. Update docs and release notes.

## Branch And Review Policy

Recommended future policy:

- One feature branch per approved feature.
- Pull request must link to the specification or RFC.
- Pull request must list impacted interfaces.
- Pull request must include test evidence.
- Architecture owner reviews boundary changes.
- Security owner reviews credential, approval, or action-related changes.

## Local Development Expectations

Future implementation should support:

- Fixture-only mode.
- Mock AI provider mode.
- Local database mode.
- Deterministic recommendation replay.
- No live credentials required for most tests.

## Definition Of Done Checklist

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

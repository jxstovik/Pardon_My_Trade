# ADR-0002: Keep Business Logic Out Of Prompts

Status: Accepted  
Date: 2026-07-10

## Context

AI models are useful for summarization and reasoning support, but prompts are hard to test as the authoritative source of fantasy rules.

## Decision

Fantasy business logic must live in the rule engine, decision engine, typed models, and configuration. Prompts may explain, critique, or summarize deterministic outputs.

## Consequences

- Recommendations are more reproducible.
- Rule behavior is testable.
- Prompt updates are less likely to change system policy unexpectedly.

## Alternatives Considered

- Encode scoring and lineup rules directly in prompts. Rejected because it is brittle and hard to verify.

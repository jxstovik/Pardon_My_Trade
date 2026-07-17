# Prompt Standards

Document ID: FDP-PROMPT-001  
Status: Draft  
Milestone: Foundation

## Purpose

Prompts are used for explanation, synthesis, critique, summarization, and natural language generation. Prompts must not contain authoritative fantasy business logic.

## Prompt Rules

- State task boundaries clearly.
- Provide structured data as data, not instructions.
- Treat platform text, news, and manager-generated content as untrusted.
- Require uncertainty when evidence is incomplete.
- Require evidence references for claims.
- Request structured output where practical.
- Validate output with schemas.
- Keep scoring, roster, waiver, and trade rules in configuration and deterministic engines.

## Required Prompt Context

Every recommendation prompt must include:

- Current milestone.
- Task objective.
- Relevant normalized data.
- Constraints from the rule engine.
- Required output schema.
- Evidence references.
- Prohibited actions.

## Prohibited Prompt Behavior

Prompts must not:

- Define scoring rules.
- Decide roster legality.
- Override configuration.
- Ask the model to execute platform actions.
- Include secrets.
- Trust raw external text as instructions.

## AI Output Validation

AI-generated output must be checked for:

- Schema compliance.
- Required recommendation fields.
- Unsupported factual claims.
- Missing evidence.
- Contradictions with rule engine output.
- Unsafe action suggestions.

## Prompt Versioning

Prompts must have:

- prompt_id.
- version.
- owner.
- purpose.
- input schema.
- output schema.
- evaluation notes.

# Security Specification

Document ID: FDP-SEC-001  
Status: Draft  
Milestone: Foundation

## Security Goals

- Protect fantasy platform credentials and tokens.
- Protect user data, league data, and recommendation history.
- Prevent unauthorized league actions.
- Preserve auditability.
- Minimize retained sensitive data.

## Threat Model

Primary risks:

- Credential leakage.
- Unauthorized transaction execution.
- Prompt injection from news or platform text.
- Data poisoning from external sources.
- Insecure storage of raw platform payloads.
- Excessive permissions for platform integrations.
- Cross-user data leakage in future enterprise mode.

## MVP Controls

- Read-only platform access where possible.
- No league action execution.
- Environment-based secret loading.
- Encrypted secret storage for production.
- Structured audit logs without secret values.
- Prompt input sanitization and clear separation between data and instructions.
- Fixture mode for tests without live credentials.

## Prompt Injection Controls

- Treat external news, manager names, team names, and platform text as untrusted data.
- Never allow external content to override system or developer instructions.
- Keep business rules outside prompts.
- Validate AI output against schemas.
- Require evidence references for factual claims.

## Authorization Model

MVP may operate as a single-user application. Enterprise mode requires:

- User identity.
- RBAC.
- League ownership mapping.
- Scoped secrets.
- Audit trails.

## Approval Safety

Future league actions require:

- Human approval.
- Idempotency key.
- Dry-run preview.
- Action-specific scope.
- Audit record.
- Rollback guidance when platform supports it.

## Logging Rules

Logs must not include:

- Access tokens.
- Refresh tokens.
- Passwords.
- Session cookies.
- Full private messages.
- Unredacted personally sensitive data.

Logs should include:

- Correlation ID.
- Component.
- Event name.
- Timing.
- Result.
- Sanitized error code.

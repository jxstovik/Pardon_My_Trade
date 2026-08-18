---
name: pmt-action-review
description: Review PMT's queued fantasy actions with exact scope, rationale, risk, expiry, validation, and audit state before a human approves or rejects them. Use for action-queue review and any possible live ESPN operation.
version: 1.0.0
metadata:
  hermes:
    tags: [pmt, fantasy-football, action-queue, approval, audit, live-actions, safety]
    requires_toolsets: [mcp-pmt-operator]
---

# PMT Action Review

## When to Use

Use this skill whenever PMT has queued a roster, add/drop, waiver, or trade
action, or whenever a user asks whether a proposed league move should be
approved.

## Non-Negotiable Boundary

This skill is the last review before a possible live action, not an execution
shortcut. A recommendation, notification, scheduler run, prior approval for a
different action, or vague user intent is not approval. Never call an ESPN write
tool directly.

## Review Procedure

1. Call `mcp_pmt_operator_pmt_list_pending_actions` and identify the exact league, team, action
   ID, action type, risk, rationale, creation time, and expiry time.
2. Call `mcp_pmt_operator_pmt_get_action` for the selected action. Confirm that it is still
   pending and that the action contains the intended player and team IDs.
3. Call `mcp_pmt_operator_pmt_preview_action` immediately before requesting a decision. Require
   current platform state, PMT validation, affected scope, expected side
   effects, expiry, and idempotency information when supported.
4. Present a concise decision record: what changes, why PMT proposed it, what
   evidence supports it, what is uncertain, what could be affected, and what
   happens if it expires.
5. Ask for an explicit decision on that exact action ID. Do not infer approval
   from "looks good" unless the user clearly identifies the action and authorizes
   the move.
6. If the user rejects it, call `mcp_pmt_operator_pmt_action_reject` for that exact pending ID.
   If the user approves it, re-check the preview and state, then call
   `mcp_pmt_operator_pmt_action_approve` only if the tool contract explicitly states that this is
   the approved execution path.
7. Call `mcp_pmt_operator_pmt_get_action_audit` and report the resulting status, timestamp,
   actor or approval source, and any execution or platform error. If the tool
   reports only approval and not execution, do not claim the move was made.

## Decision Rules

- **Expired:** do not revive or approve. Report that a new recommendation and
  fresh preview are required.
- **Already resolved:** do not mutate it. Show the terminal status and audit.
- **Changed preview:** stop and request confirmation again; approval applies to
  the current exact action, not the earlier version.
- **Stale or invalid platform state:** stop. Do not approve based on cached
  roster data.
- **High-risk action:** require explicit approval and keep it queued otherwise.
- **Low-risk roster action:** follow PMT's configured auto path only when the
  user explicitly enabled it; this skill's normal path is still review-first.

## Safety

- Never approve a batch by implication when the user named only one action.
- Never expose cookies, credentials, tokens, or unredacted private payloads.
- Never bypass TTL, validation, idempotency, audit, or platform-scope checks.
- Never change player IDs, teams, quantities, or action type while describing a
  confirmation.
- On timeout, error, or ambiguity, leave the action pending and explain the
  blocked state.

## Verification

After any decision, report the exact action ID, final status, action contents,
freshness check, validation result, audit record, and whether a platform write
was actually confirmed. A status of `approved` alone is not proof of execution.

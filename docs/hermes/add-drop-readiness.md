# Hermes add/drop readiness

The scoped acquisition adapter passed a real user-approved canary on October 8,
2026: action `act-1791464660329-bsshp3` added Brian Robinson Jr. (4241474) and
dropped Jauan Jennings (3886598) for ESPN league 98806880, team 7. Durable receipt
and a fresh ESPN roster both confirmed execution. No other roster change was made.

The read connection remains available. The user explicitly approved persistent
operator access on October 8, 2026. Hermes configuration now enables the separate
`pmt-operator` connection for league 98806880, team 7, with execution enabled only
in that process. Each future move still requires exact human approval. The local
`.env` retains read role and execution disabled. Cookies remain in the protected
project `.env`. MCP startup, all eight configured operator tools, and reading the
completed canary action were verified; verification made no ESPN writes. Existing
Hermes sessions may need a restart to load the updated MCP configuration.

The operator configuration example contains these steps:

1. `pmt_prepare_add_drop` checks the configured team, current roster, unlocked drop,
   free-agent ownership/status and scoring period. It queues one exact add/drop
   with a 30-minute expiry and roster fingerprint. It never approves or submits.
   Waiver players are refused; they require a separate waiver proposal.
2. `pmt_preview_action` presents the pending action for exact human approval.
3. `pmt_action_approve` records that approval; execution is a separate call.
4. `pmt_action_execute` revalidates fresh state and idempotency before using the
   authenticated member identity and ESPN write host. It records durable receipts.
5. `pmt_get_action_audit` plus fresh roster reads verify the result. Unknown outcomes
   are reconciled without an automatic retry.

Scheduled advisory workflows use `pmt-read`, whose server does not expose prepare,
approve, reject or execute tools. Do not enable the operator for scheduled jobs.
Activation requires a separate `pmt-operator` process with role `operator`, execution
enabled in that process only, project cwd and the same canonical data directory.
Keep the configuration secret-free; obtain cookies through PMT's environment loader.

## Lineup execution verified October 14, 2026

The user explicitly authorized the recommended Week 6 lineup. Action `act-1792006505177-1nilr7` executed at 19:35:15 UTC: Pollard FLEX to RB, Wan'Dale Robinson bench to FLEX, RJ Harvey RB to bench. Fresh ESPN reads confirmed all nine starters. Action `act-1792006374591-x87k1v` separately added Colts D/ST and dropped Raiders D/ST. Only one defense is owned.

`pmt_prepare_lineup` is operator-only. It validates complete slot counts, unique owned identities, ESPN eligibility and locks before queueing. The writer rechecks ownership and uses the authenticated ROSTER/LINEUP transaction contract on the write host; each changed player carries its own prior slot. Trades remain unvalidated for live use.

## Do-not-drop protection

Both the waiver scanner and deterministic add/drop recommendations build a current
roster protection set from league-wide model values. The default rule protects
rostered players in the top 100 by positive, finite value (position-adjusted
Bayesian value in the waiver scanner; league-scored projection value in the
deterministic engine). Missing, zero, negative or non-finite ranking data is
unknown and protected rather than interpreted as evidence that a player is
expendable. This is advisory-only and does not approve or submit a roster
transaction.

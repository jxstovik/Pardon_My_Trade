# Automated football lineups

The user enabled standing lineup permission on November 5, 2026 for ESPN league
98806880, team 7, season 2026. The scope is owned-player starter/bench assignments.
Add/drop, waiver and trade actions still require approval of each exact action.

`config/football-lineup-authorization.json` records this permission. Set `enabled`
to false to revoke it. A different league, team or season needs renewed scope.

After refreshing model outcomes, news and the live roster, prepare a complete
legal lineup with PMT's operator `pmt_prepare_lineup` tool. It records the exact
payload, period, roster fingerprint and short expiry. With Node 26, build and run:

```sh
npm run build
node scripts/execute-automatic-lineup.mjs <exact-queued-lineup-action-id>
```

The runner loads `.env` internally and requires matching ESPN/runtime scope.
It checks the standing permission, fresh league/season/period, unchanged roster,
slot eligibility and locks before attributing approval to the standing permission.
The regular ActionExecutor revalidates, reserves a durable receipt before I/O and
records its audit. The ESPN writer separately checks authenticated ownership and
legal full-lineup transitions using fresh state. The runner reads the roster again
and reports `verified: true` only when all requested starter assignments match.
An unknown submission must be reconciled; do not prepare a replacement to retry it.

This narrow runner does not enable the generic `ff-run --auto` route, whose legacy
routing result can label an action executed without actually submitting it.
The normal season daemon and advisory tools continue to queue proposals.

For a complete model-based live roster review, run
`node scripts/optimize-weekly-lineup.mjs` (preview), or append `--execute` to
apply and verify the maximum-scoring legal starter assignment. This uses the
current-week outcome-trained PMT artifact, exact ESPN eligible slot IDs and live
starter counts, preserves every locked player, fails on missing coverage or an
impossible full lineup, and leaves an already optimal lineup untouched. It does
not activate IR players into an over-capacity active roster. Questionable-player
forecasts are conditional; refresh when their designation changes and review
individual practice/injury reports before kickoff. The runner shares the
league/team lock with acquisitions and must be rerun after roster moves.

The November 5 roster review also enabled replacing a redundant second TE when
another owned TE dominates its weekly and remaining-season model value and a
legal-lineup improvement qualifies. It does not require carrying two TEs or
dropping one without a useful replacement. Individual source reports must check
addition availability and actual offensive role; a roster Active flag alone is
not evidence of a usable fantasy replacement.

The Codex thread automation runs Thursday, Saturday and Sunday at 1 a.m. Eastern.
Its Sol worker refreshes stale prior-week model inputs, checks weekly and ROS
value, prepares a validated lineup and invokes this runner when improvement is
supported by approved model evidence. Keep candidate models labeled advisory.
The desktop app and computer must remain running for local scheduled work.

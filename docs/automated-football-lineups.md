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

The Codex thread automation runs Thursday, Saturday and Sunday at 1 a.m. Eastern.
Its Sol worker refreshes stale prior-week model inputs, checks weekly and ROS
value, prepares a validated lineup and invokes this runner when improvement is
supported by approved model evidence. Keep candidate models labeled advisory.
The desktop app and computer must remain running for local scheduled work.

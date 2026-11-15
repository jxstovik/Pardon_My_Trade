# Authorized automated football transactions

On November 5, 2026 the user approved the reviewed automatic acquisition protocol
for ESPN league 98806880, team 7, 2026 fantasy season, and explicitly approved the
Saints/Commanders and Stevens/Butker swaps. Both were verified in ESPN.

`config/football/automatic-transactions.json` is the scoped standing permission.
Disable its `enabled` field to revoke it. Trades and standalone drops are excluded;
traditional priority waivers involve no FAAB spending. An add/drop pair counts once.
The five-transaction weekly limit is shared with the Tuesday workflow. Durable
receipts and external pending claims consume/reserve capacity. Submitted claims
remain conservatively counted until an operator reconciles a failed award; no
missing platform view automatically releases capacity. Unknown receipts stop writes.
Both execution paths hold the same exclusive league/team acquisition lock.

Refresh models using all completed prior-week games and current news. The scout
producer includes `healthyPlayers`, conditional healthy-availability forecasts
from the same fitted statistical models. This is a scenario, not a recovery-date
prediction or production-model promotion. Old artifacts without the required
healthy scenario must be rebuilt before an affected injury transaction can run.

For injury reports, record a source URL, publication time, exact supporting quote,
and earliest/latest NFL return week when the report supports those bounds. Do not
convert a concussion designation or an unsourced guess into a definite return date.
Use an early-return baseline for the owned player and a late-return baseline for an
injured acquisition. With uncertain duration, compare an active replacement against
the owned player's healthy-return baseline; require at least the existing six-point
next-three-week or twenty-point remaining-season benchmark plus the engine's
positive probability-margin/value test. These benchmarks are an uncertainty rule;
they remain soft suggestions for ordinary healthy-player moves. Offensive core
protection uses the resulting scenario's season value. Locked players remain protected.

Prepare one exact add/drop or prioritized waiver through PMT's operator workflow,
then run with Node 26 from this repository after building:

```sh
node scripts/execute-automatic-transaction.mjs <action-id> <news-evidence.json>
```

Example evidence (use actual current data, not these example values):

```json
{
  "modelVersion": "exact-current-manifest-modelVersion",
  "newsRefreshedAt": "actual-refresh-ISO-timestamp",
  "recoveries": [{
    "playerId": "exact-ESPN-id",
    "sourceUrl": "https://source.example/report",
    "publishedAt": "actual-publication-ISO-timestamp",
    "quote": "Exact source text supporting the return estimate",
    "earliestReturnWeek": 10,
    "latestReturnWeek": 11
  }]
}
```

Use `recoveries: []` when no sourced estimate exists. The runner recomputes the
exact improvement with PMT engines and current roster, validates model/code/source
hashes, scope, rules, availability, locks, fingerprint, TTL and capacity, attributes
approval to the standing policy, and submits through the durable ActionExecutor.
Re-read the roster after an immediate acquisition and prepare the next action
against that new state. A waiver submission must be found in pending moves; it is
not an award. An unknown result or failed confirmation must never trigger a retry.

The Codex Thursday/Saturday/Sunday 01:00 Eastern automation uses this path with a
Sol 6.1 Medium worker or greater. The prior Tuesday job remains a narrower
waiver-only path, sharing the same capacity gate and acquisition lock.

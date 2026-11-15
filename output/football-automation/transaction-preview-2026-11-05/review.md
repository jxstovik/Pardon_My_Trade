# Football transaction preview — November 5, 2026

ESPN league 98806880 / team 7, Bored Man Gets Paid. Week 9; fantasy season ends Week 17. Preview only: zero platform writes.

Live read: 2026-11-05T13:39:18.883Z. Models trained through Week 8: 121 completed games. Model status: candidate, not production-promoted. 437 modeled available players of 896; unmatched players excluded. Refreshed 74 ESPN and 112 Razzball news records with no feed degradation.

| Type | Add | Drop | This week | Next 3 weeks | Rest of fantasy season | Action ID |
|---|---|---|---:|---:|---:|---|
| Immediate add/drop | Saints D/ST (-16018) | Commanders D/ST (-16028) | +2.65 | +2.47 | -6.22 | act-1793885958594-e41ior |
| Immediate add/drop | Drew Stevens (5081335) | Harrison Butker (3055899) | +1.34 | +2.55 | +6.90 | act-1793885958880-ro513t |

No qualifying waiver claims. Current league waiver priority is 3; there are no pending ESPN claims. Both proposed actions are pending, high risk, and expire at about 09:09 a.m. Eastern today. Revalidation is required immediately before execution.

The Saints proposal qualifies only as a defense stream: keeping that defense through Week 17 loses modeled value. Switching back later is not guaranteed. Simulated probabilities are conditional model output, not calibrated success rates. Optional handcuff/covariance scenarios were omitted from this combined preview.

## Future authority — approved November 5, 2026

Use the existing Thursday/Saturday/Sunday 01:00 America/New_York checks for this exact league/team through the 2026 fantasy season. Use Sol 6.1 Medium or greater. Allow immediate free-agent add/drop and prioritized waiver claims, with at most five successful automated acquisitions per NFL scoring week across this workflow and the separate Tuesday job. One add/drop pair or awarded claim counts as one transaction; pending automatic claims reserve capacity within that five-transaction limit. No FAAB spending, trades, standalone drops, locked-player drops or unverified identities. Injured and reserve players are eligible for acquisition or conditional drop based on sourced expected missed games, return-window uncertainty, remaining fantasy schedule, roster/IR capacity and injury-adjusted model value versus replacement. Short absences with valuable returns favor holding or legal IR placement; long or season-ending absences may justify replacing the player. Protect the offensive core using injury-adjusted remaining-season value rather than a pre-injury rank. If the injury timeline or model coverage is unreliable, queue the injury-dependent move for review. There is no invented fixed missed-week cutoff. Rotate specialists only within their position, keeping one defense and kicker. Weekly specialist streaming may accept a disclosed season cost.

Use the freshly trained PMT artifacts after training coverage, validation, source/news freshness and provenance checks. Candidate status remains explicit; permission does not promote production models. Use only validated legal improvements, exact queued actions, fresh state, durable idempotency and audit. Replan after an acquired player changes the roster. Unknown receipts or conflicting claims block submissions pending reconciliation. Approval can be revoked by disabling the scoped policy.

The user explicitly approved this protocol after the preview. The active policy is config/football/automatic-transactions.json. The separate pre-existing Tuesday policy has not been modified.

The user explicitly approved both exact transactions and the standing future protocol; both immediate swaps were subsequently verified in ESPN.

Policy revision: the user requested five transactions and injury-duration-dependent eligibility. This revises the pending proposal only; it does not approve today’s moves or enable future transaction execution. The earlier two-move preview has not been recalculated under the revised injury policy.

Approved injury clarification: use sourced return windows when available. Unknown duration may still permit a high-value replacement supported against the conditional healthy-return baseline, rather than treating the injured player as permanently unavailable. Missing statistical identity or healthy-model coverage still prevents automated numerical comparisons. The standalone protocol documentation describes the six/twenty-point high-value uncertainty benchmarks.

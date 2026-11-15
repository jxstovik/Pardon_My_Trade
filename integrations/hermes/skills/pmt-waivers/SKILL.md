---
name: pmt-waivers
description: Read current ESPN waiver rules and review PMT-ranked claims for Bored Man Gets Paid, with exact individual approval before submission.
---

Use league 98806880/team 7/season 2026. Start with pmt_espn_read_waivers and preserve the timestamp, system, reset rule and team rank. Refresh projections/news before pmt_run_advisory_orchestration. Its waiver_claims are deterministic preferences, 1 first; waiver_candidates are immediate free agents. Do not invent FAAB bids or rewrite model rankings in the prompt.

The November 5, 2026 standing authorization allows only the existing Tuesday 02:00 New York job, pinned to Codex gpt-6.1-sol/medium, to run scripts/run-automatic-waivers.mjs --execute under config/football/automatic-waivers.json. Follow docs/hermes/automatic-waivers.md; that exact runner records policy approval and durable receipts. Do not infer authority for other action types or bypass its model freshness, starting-lineup probability/role evidence, identity, expiry or idempotency checks.

Other scheduled runs report exact candidates and pending IDs; they never approve or execute acquisitions. At a human decision, use pmt_prepare_waiver_claim with exact add, conditional drop and priority, then preview. Each exact claim requires individual approval and a separate execute call. Expired proposals require fresh preparation. Claim submission does not mean the player was awarded. Use action audit/receipt and ESPN Pending Moves to reconcile. Never retry unknown outcomes.

Inspect existing ESPN Pending Moves before submission. This capability supplies priority on new claims; it does not reorder or cancel existing ESPN claims. The league order is separate from your claim preferences. Successful claims move a team to the back; weekly resets follow current league settings. Shared conditional drops are fallback alternatives; a successful earlier claim may invalidate a later drop. Do not promise multiple successful acquisitions from one drop.

See docs/hermes/waiver-capability.md for verification and limitations.

The user clarified that +6/+20 points are suggestions, not minimums. Evaluate starter improvement, documented RB insurance and QB-WR covariance; use next-week D/ST/K streaming value even when season-hold value is negative. Do not infer benefits from same-team labels or bench roster totals. Read the probability/strategy evidence in the automatic plan.

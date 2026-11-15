# ESPN waiver capability

**November 5 update:** the existing Tuesday job now has scoped standing authority
for automatic qualifying claims. See [automatic-waivers.md](automatic-waivers.md).
The historical per-claim confirmation requirements below still describe manual
preparation; the authorized automatic runner records policy approval instead.

Scope: The Smaracko, ESPN league 98806880, season 2026, team 7, whose live name is
**Bored Man Gets Paid**. Read on October 27, 2026 at 12:59:02 UTC through PMT's
existing authenticated read client. No live claim was submitted during setup.

The authoritative `settings.acquisitionSettings` returned:

- `WAIVERS_TRADITIONAL`, `isUsingAcquisitionBudget: false` (the default budget
  field of 100 does **not** enable FAAB).
- `waiverOrderReset: true`: weekly inverse-standings reset. Winning a claim
  moves the team to the back during processing.
- `waiverHours: 24`; processing days Sunday, Wednesday, Friday, Saturday,
  Thursday and Monday (Tuesday is absent).
- Raw `waiverProcessHour: 11`. The API payload does not establish its timezone;
  PMT preserves it and does not schedule from this number or promise a deadline.
- Team 7's current rank: 4. Actual order was teams 5, 1, 10, 7, 2, 6, 3, 8, 4, 9.

Rules references: ESPN's [Waivers Overview](https://support.espn.com/hc/en-us/articles/360000041152-Waivers-Overview),
[order and tiebreakers](https://support.espn.com/hc/en-us/articles/360000093771-Waiver-Order-Overview-and-Salary-Cap-Tiebreakers),
and [claim management](https://support.espn.com/hc/en-us/articles/360000093791-Claim-a-Player-Off-Waivers).
League settings override generic timing examples. Immediate free-agent pickups do
not consume waiver rank. Manager claim preference and league-wide rank differ.

`pmt_espn_read_waivers` exposes current settings/rank. The advisory orchestration
classifies its short list using live acquisition status: WAIVERS become ranked
`waiver_claims`; FREEAGENT entries remain immediate `waiver_candidates`. Ranking
uses the existing deterministic position-adjusted projection scanner and its
do-not-drop protection. Unknown availability is excluded. FAAB claims are not
invented without explicit bids. All waiver actions remain high risk and pending.

`pmt_prepare_waiver_claim` is operator-only. Input: leagueId, teamId, addPlayerId,
optional dropPlayerId, priority (positive integer, 1 first), optional faabBid
(for budget leagues only). Preparation checks current scope, rules, availability,
owned unlocked drop or an active roster vacancy; creates a 30-minute proposal
with roster fingerprint and period; and blocks conflicting pending PMT player or
priority assignments. A repeated identical pending request returns its action.

Exact preview, individual human approval, and separate action execution are
required. The writer carries claim `priority` into the ESPN transaction; executor
revalidates acquisition status/rules, roster, budget, period and approval before
submission and retains the existing durable receipt/idempotency behavior.
A receipt means submission completed, not that ESPN awarded the player.

Existing ESPN claims are not canceled or reordered. Inspect Pending Moves before
submitting; preference conflicts with claims created outside PMT are not checked.
The priority wire contract has fixture coverage; live prioritized submission is
not canary-verified because no specific claim was authorized during setup.

The installer `scripts/install-waiver-capability.py` defaults to dry-run. With
`--apply` under the existing Hermes Python, it backs up configuration and the
Tuesday parent, adds only the new read/operator allowlist entries and appends a
waiver policy to parent 38da0b12383e. It preserves schedule, destination, model and
execution settings and reads the result back. It sends no message or league move.
Existing Hermes sessions need a reconnect to discover new tools. The next
scheduled run starts a new MCP process and loads the built implementation.

Verification on October 27, 2026:

- Installed the allowlists and Tuesday policy through the native Hermes job API;
  dry-run after installation reports no remaining changes. Schedule, delivery,
  model pins and execution settings were preserved; zero ESPN writes.
- A fresh stdio MCP process discovered the new read tool, hid the preparation
  tool in read role, and successfully read live team 7/rank 4/rules at
  13:07:07 UTC with execution explicitly disabled.
- 53 compiled tests passed across waiver context, MCP, controlled execution,
  ESPN reader/writer, orchestrator and action queue.
- Full `npm run build` is currently blocked by unrelated concurrent basketball
  errors in `src/basketball/draft-adaptive.ts` and `copilot-server.ts`. A scoped
  TypeScript build of MCP stdio and those seven test entrypoints completed and
  emitted into `dist/` before running the tests. No basketball files were changed
  as part of this capability.

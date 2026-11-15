# Automatic Tuesday waiver claims

The user's November 5, 2026 instruction grants standing authority for this scoped
workflow. It supersedes older per-claim confirmation requirements only here.
All moves still pass through exact queue preparation, recorded policy approval,
ActionExecutor revalidation, and durable receipts. General/manual action gates
remain intact. This authority does not include trades, immediate free-agent adds,
standalone drops, or lineup writes. It is not model promotion.

The existing Tuesday job `38da0b12383e` is updated rather than duplicated. It runs
at **02:00 America/New_York**, pinned to **gpt-6.1-sol / medium** through the
`openai-codex` provider. The installed Hermes scheduler suppresses fallback chains
for pinned routes; installation checks this. The old unconditional training
pre-run script is removed: the agent first runs the ordered check below. Preserve
its existing weekly destination and kickoff-review scheduling responsibilities.
The job's full prompt is `automatic-waivers-job.txt` in this directory.

From this repository, using its Node 26 runtime:

```sh
export PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH"
npm run build
node scripts/run-automatic-waivers.mjs --check-only # never trains/queues/submits
node scripts/run-automatic-waivers.mjs              # may refresh/train; no claims
node scripts/run-automatic-waivers.mjs --execute     # standing-authorized Tuesday path
```

The execute command is allowed to finish between 02:00 and 06:00 New York on
Tuesdays. Its first scheduled check is 02:00. This is a completion window, not
hourly polling or permission to resubmit. Scope is ESPN league 98806880, team 7,
2026 season. Credentials stay in the existing environment loader; no global
execution flag is changed. Disable by setting `enabled` false in
`config/football/automatic-waivers.json` or pausing the existing job.

An explicit human request to run and submit now can use `--execute
--manual-authorization <json-file>` outside the scheduled window. The JSON records
`leagueId: "98806880"`, `teamId: "7"`, `season: 2026`, ISO `requestedAt` and
`expiresAt` timestamps (valid for at most two hours), and the exact request
`Run the modeling and waiver priorities workflow, then submit appropriate waiver claims.`
This is an attended invocation, never a scheduler fallback. The authorization is
copied into the durable attempt journal; expiry is checked before each claim.
All model, scope, weekly journal, shared acquisition lock, pending-claim,
capacity, exact-action and receipt checks still apply. The scheduled invocation
without this file retains its Tuesday 02:00–06:00 restriction.

1. Read the live league and published NFL schedule to identify the next whole
   NFL week. Refresh NFLverse games/statistics. Require every published game
   through the preceding week to be complete and present in the source stats.
   At 02:00, Monday results may not yet be published: submit nothing if missing.
2. Check the fitted manifests first: exact game IDs, cutoff, current-season
   fitted rows for all six positions, build age no more than 20 hours, source
   and producer hashes. Stale/missing candidates trigger the existing verified
   weekly-planning pipeline only after source coverage passes. Recheck afterward.
   A projection-prior refresh alone is insufficient proof of outcome training.
3. The candidate trainer emits a hashed `waiver-horizon.json` with per-week fitted
   quantiles and means under the full published schedule and frozen completed-outcome
   feature state. Byes contribute zero. Current Q status uses a disclosed 50% planning
   haircut, not a calibrated active probability; D/O/IR contribute zero. These are
   conditional model scenarios, not calibrated season probabilities. No promotion.
4. The user's follow-up makes **+6 near-term / +20 season points soft suggestions**.
   Neither is a minimum for a claim. Compare pregame-selected optimized starting
   lineups using paired common score draws, before versus after the acquisition.
   Report P(improvement), P(worsening), ties, expected lineup gains and the chance
   the added player actually starts. Lineups are selected from means and observable
   availability scenarios before sampled scores; no hindsight best-ball selection.
   A bench-only roster-total improvement cannot qualify. The point suggestions
   are recorded and used only as a final prioritization signal, never a gate.

   - Ordinary adds: a positive expected near-term or season **starting-lineup**
     gain with more simulated benefit than harm, beyond Monte Carlo sampling noise.
   - RB handcuffs: assess actual lineup insurance when an owned lead back has no
     offensive touches. At least two completed same-team backup opportunity games
     are required; use the observed conditional game-score distribution and observed
     frequency as explicit historical scenarios, not predicted future injury rates.
     Without that evidence, sharing a backfield grants no numerical insurance bonus.
     Ambiguous multi-back relationships are not assigned a fabricated joint role model.
   - QB-WR pairs: use paired completed-game residual covariance (minimum four paired
     games), a Gaussian single-QB-factor scenario, and the verified opponent lineup
     when available. A pairing gets no expected-points bonus. It may qualify through
     a supported matchup-win-probability improvement even with a modest lower mean;
     an ordinary valuable WR can also qualify without covariance. A matching team
     label alone cannot justify an automatic acquisition or a probability claim.
   - D/ST and kicker streams: evaluate next-week starting-lineup probabilities and
     positive expected next-week gain. Negative season-hold value does not disqualify
     a stream. Rotate the same specialist position rather than adding a second one.
     Top-100 offensive-player protection is retained; specialist rotation does not
     bypass explicit injury, missing-data or roster-lock protection.

   Use 256 deterministic paired samples with interpolated fitted quantiles and
   clamped 5th/95th percentile tails by default. Report sampling precision
   separately from model uncertainty; these estimates are not claimed calibrated.
   Maximum two disjoint claims. Recompute marginal probabilities after the first
   choice; the second must still qualify independently if the first fails.
5. Only healthy currently confirmed WAIVERS qualify. Traditional waivers only;
   a change to FAAB blocks automatic bidding. Existing ESPN pending claims block
   the batch rather than being canceled or reprioritized. Read current roster,
   positions, locks, rules and scoring and compare all evidence again before
   each action. Model/horizon/status/eligibility changes stop submission.
6. Persist a one-attempt weekly journal before queue approval. Prepare an exact
   scoped 30-minute action with stable week/player idempotency; record the standing
   authority date, policy hash, model version, lineup probability/strategy rationale and horizon hash
   in rationale/approval actor. Submit in priority order through ActionExecutor,
   then require the exact add/drop/priority to appear in ESPN pending claims.
   Unknown/blocked/unconfirmed outcomes stop the batch. Never retry automatically,
   remove an attempt journal or turn a claim into an immediate pickup.

The live league settings read on November 5 report `status.finalScoringPeriod = 17`.
The evaluator truncates the forecast horizon to that live league boundary; Week 18
cannot create qualifying season value. A later boundary change stops an in-flight batch.

Read reports under `data/automatic-waivers/`: target-week attempt, dry-run or
no-claims record, plus `last-failure.json` for a blocking exception. Execution
receipts/audit remain in the canonical SQLite store. Submission is not an award.
A human can reconcile ambiguous outcomes against ESPN before changing the journal.
The attempt record is retained even if the process crashes midway. No automatic
recovery clears it. Older pending advisory proposals can block exact preparation;
review those rather than rejecting unrelated proposals by implication.

Private pending-claim reads require ESPN's `x-fantasy-role` response header to
confirm an authenticated session. Public league/roster reads can keep working
after the saved cookies cease to authenticate. A missing role or `NONE` stops
submission and requests a local credential refresh; it is never an empty-queue
signal. Dry-run evaluations can still finish and record the submission blocker.

On November 10, the 02:00 run failed on a stale SQLite migration lock. The attended
recovery archived that unowned November 1 lock, completed the Week 10 projection
refresh and six candidate position fits with all 136 completed games through
Week 9, and produced two prioritized specialist streams. Submission was blocked
because ESPN reported the saved session as `NONE`; no claim was prepared or sent.
The build and 37 targeted compiled tests passed after adding explicit scoring
periods, private-view authentication checks and attended-run authorization expiry.

Installation: `scripts/install-automatic-waivers.py` defaults to dry-run. Under
the existing Hermes Python, `--apply` backs up and updates only job 38da0b12383e,
uses the native locked job API, verifies the next New York trigger and model/
effort/provider pins, and preserves destination/history/other job settings.
It creates no additional automation and makes no ESPN write. The earlier
`install-waiver-capability.py` is a historical advisory installer; do not reapply
its older parent policy over this one.

## November 5 verification

- Existing job readback: Tuesday November 10 at `2026-11-10T02:00:00-05:00`,
  `gpt-6.1-sol`, `openai-codex`, `medium`; old pre-run script removed; destination
  and other schedule identities preserved. A second installer dry-run is unchanged.
  Pinned-route fallback suppression was verified against the installed scheduler.
- Build passed. All 39 targeted compiled checks and five Python horizon/coverage
  tests passed. The broader suite ran 426 checks: 425 passed; the unrelated
  existing Hermes kickoff bridge test expects Luna while that bridge currently
  pins Sol. No kickoff model pins were changed for this waiver task.
- Live check-only execution resolved the upcoming target to Week 9 and blocked
  on its absent trained manifest. It created no proposal, approval or weekly
  attempt journal and made no ESPN write. The next scheduled run may fit a fresh
  target only if complete latest-game source coverage is available.
- Authenticated ESPN settings report fantasy final scoring week 17. The pending
  transaction view was readable and empty during setup. This is not a live
  submission canary; exact submission/priority confirmation will occur on a
  qualifying authorized Tuesday run and will stop on any ambiguity.


The probability/role refinement preserves the same Tuesday 02:00 New York job,
Codex Sol 6.1 / medium minimum, scope, expiry, fresh-training gate and durable
submission protections. `suggestedNearTermLineupGain` / `suggestedSeasonLineupGain`
replace the earlier minimum fields. Role evidence and score distributions are
hashed with the horizon; old mean-only artifacts require a refresh before use.

Refinement verification: the build, 46 compiled targeted checks and six Python
coverage/distribution/relationship checks passed. Regression cases include gains
below both suggestions, D/ST/K streams with negative season-hold value, empirical
RB insurance, unsubstantiated same-team pairings, covariance-dependent matchup
upside without a mean-points bonus, and excluding hindsight bench selection/byes.
The existing job's revised prompt was installed and read back with the same
Tuesday 02:00 New York trigger and Sol 6.1 / medium pin. No claim was submitted
while making this refinement.

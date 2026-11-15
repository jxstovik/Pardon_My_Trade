# Deterministic T-60 reviews

The October 18 repair removes a mandatory terminal file read that unattended Hermes could not approve. The old job also asked the model to join player IDs to names, assemble a complete lineup, interpret partial league-wide news pages, and compose the report. One prior run described Wan'Dale Robinson as “player 4569587”; another failed before fetching data.

Kickoff jobs now call a bounded application workflow, prepare any exact proposed lineup by report identifier, and return the finalizer's report verbatim. The installed inference policy is `gpt-6-luna`, provider `openai-codex`, reasoning `xhigh`. Existing kickoff times, Tuesday schedule, weekly-thread delivery, completed-job history, and approval boundaries are preserved.

## Tools

| Tool | Behavior |
| --- | --- |
| `pmt_get_nfl_kickoff_schedule` | Reads the ESPN published NFL schedule; groups identical timestamps and calculates T-60 in America/New_York, including DST. Returns canonical prompts and schedule keys. |
| `pmt_schedule_kickoff_reviews` | Reconciles future Hermes one-shots through its locked storage API using the installed model policy and Tuesday parent's current delivery thread. Idempotent by kickoff key/canonical name; pauses only obsolete future children. No arbitrary model or destination arguments. |
| `pmt_run_kickoff_review` | Syncs once; resolves current platform fantasy period separately from NFL week; reads game injury designations and individual ESPN/Rotowire reports for owned affected players and unlocked bench alternatives; computes a legal lineup using PMT's optimizer. No queue mutation or platform submission. |
| `pmt_prepare_kickoff_lineup` | Operator only. Takes only the saved report ID. Requires complete, changed, unexpired evidence and an unchanged roster. Rechecks live period, eligibility and locks; queues the exact lineup with stable idempotency. No approval or submission. |
| `pmt_finalize_kickoff_report` | Renders names, statuses, evidence and timestamps, exact slot changes, complete proposed starters, action state, verification and limitations. An executed claim requires a matching payload receipt, execution audit and fresh full-roster read-back. Unknown outcomes explicitly forbid retry. |

The review and finalizer persist/read content-addressed, integrity-checked JSON in `PMT_DATA_DIR/kickoff-reviews/`. Review validity ends after ten minutes or at kickoff, whichever comes first. The saved report is bound to league, team, season, fantasy period, full roster fingerprint and exact lineup. A changed roster requires a fresh review.

## Evidence and completion

Schedule/roster/source failures, unresolved identities, missing names, missing current-period projections, unresolved affected-player availability, stale roster data, incomplete legal lineups, expired reviews and failed execution verification produce an explicit incomplete report with `[CRON_FAILURE]`. Other usable evidence is retained when a read fails. Ambiguous IDs never fall back to names. ESPN's `fullName`/`displayName` fields now populate normalized player names; compact persisted news includes its resolved full name too.

The live feeds are public GET-only ESPN scoreboard, game summary and athlete overview endpoints. Safe requests use bounded timeouts, at most one retry and four concurrent scoped reads. There is no league-wide news scan or model-facing pagination in the kickoff path. Individual Rotowire stories are attributed reporting; a roster `Active` flag, absent news, optimistic prediction or an old report never becomes confirmed game-day clearance. Only explicit recent personal active/inactive reporting can clear a questionable designation. Snapshot injury status remains visible separately. Numeric news adjustments are not invented.

The lineup optimizer retains locked players and freezes starters from other kickoff groups while considering legal owned bench alternatives. IR/taxi and unavailable/unresolved alternatives cannot enter the proposal. A review with no affected owned players is a no-op. The report labels model-only expected gain and preserves source caveats. Scheduled lineup-only standing authority still requires exact preparation, preview, approval, execution and verification; acquisitions, waivers and trades require individual human approval.

## Installation and verification

Build first with Node 26. The installer is a dry run unless `--apply` is supplied:

```sh
python3 scripts/hermes-kickoff-jobs.py --install
# Use the installed Hermes environment's Python for --apply, so its native storage dependencies resolve.
/absolute/path/to/hermes/venv/bin/python -B scripts/hermes-kickoff-jobs.py --install --apply
```

It backs up affected jobs and config under `~/.hermes/backups/pmt-kickoff-<UTC timestamp>/` with private permissions, adds only the kickoff tool allowlist entries, updates the pending one-shots and Tuesday creator, and records the explicit Hermes Python executable in ignored `data/hermes-kickoff-runtime.json`. It does not change terminal approval policy. Newly started cron workers discover the built runtime and updated allowlist; no gateway restart is necessary for those workers.

Hermes's model-facing cron tool does not expose provider/model/reasoning pins. The scoped scheduler bridge sets those fields through Hermes's native API under the user-installed policy. This avoids asking Luna to run terminal commands to pin its own future jobs. The bridge preserves the current parent thread after weekly thread rotation.

```sh
npm test
# Local read-only MCP canary; writes report artifacts, never queues/executes/delivers actions.
node scripts/verify-kickoff-review.mjs --season 2026 --week 6 --kickoff 2026-10-18T17:00:00Z
```

Regression tests cover exact names/swaps, injury uncertainty, source failures, stale/future evidence, stable identities, locks, missing coverage, report integrity/expiry, deterministic action preparation, execution audit/read-back, DST, schedule deduplication, partial scheduler recovery, thread rotation and preservation of unrelated jobs. The read-only live canary resolved all 16 owned identities and explicit current Freiermuth active reporting, with zero platform writes. Network/source failure remains possible; the intended behavior is an actionable incomplete report rather than an unsupported success claim.

On October 18 the full suite passed all 312 tests. The installed Hermes agent also completed the live review/finalizer flow using `gpt-6-luna` with `xhigh` reasoning and returned the deterministic report verbatim. The local canary made zero fantasy writes and zero message deliveries. Evidence is saved in ignored `data/kickoff-verification/hermes-canary.json` and `.md`. `scripts/verify-hermes-kickoff.py --verify-saved` repeats the exact report comparison without another model request; a fresh live canary accepts the same season/week/kickoff arguments as the Node check and should run with Hermes's environment Python.

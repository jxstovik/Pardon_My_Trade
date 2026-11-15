> October27 update: the user subsequently authorized a live rank import.2,196 model-ordered rows were saved and fully read back;12 rows did not match. [Import result](../../artifacts/basketball/2026-10-27/rank-import/result.md). No autopick setting or pick was changed. Prior no-upload statements below are historical; the local copilot implementation is documented in [runbook](copilot-runbook.md).

# Banging 3s draft: forecast and automation plan

**New detailed extension:** [live browser copilot execution and validation plan](live-draft-copilot-plan.md) now specifies adaptive strategy paths, browser mocks, latency targets and separate action gates. That extension is planned; the delivered static board and CLI described below remain the current implementation.

Prepared October 27, 2026 for jxstovik. Balanced remains selected. The authenticated league scheduled **Wednesday, October 28 at 9:00 PM EDT**, eight teams, 14 snake rounds, one minute per pick, slot six. Recheck the order/time before starting. The user's own overall selections are **6, 11, 22, 27, 38, 43, 54, 59, 70, 75, 86, 91, 102, 107** if this order holds.

## Delivered now

- [Readable forecast](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.md), [sortable CSV](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.csv), [full manifest/scenarios](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.json): 2,209 experimental per-game forecasts from 5,687 named Fantrax identities. No turnover penalty. All eight categories contribute equally through standardized values; FG/FT use modeled makes/attempts and percentage impact, not simple averages.
- [RotoWire supplement](provider-supplement.md): 29 targeted current-season MIN/PTS/REB/AST projections. Other fields remain modeled. Its Power Conference points ranking is a benchmark with different coverage/scoring, not an independent eight-category model or consensus. Publication is October 20; retrieval is October 27. The earliest component observation is preserved.
- Historical minutes/rates shrink toward position cohorts. Freshmen covered by the provider use explicit cohort shooting/steals/blocks priors; uncovered missing-history players go into a [named review list](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/unmodeled-review.csv), not a zero-value ranking. All rows expose current-status limitations. Minutes stress cases are sensitivity scenarios, not probability intervals.
- Separate category rank and proposed draft priority. Priority subtracts a transparent positional replacement proxy; it is not a solved opponent-aware allocation. Known JT Toppin injury status blocks default recommendations while preserving conditional stats.
- A local draft advisor removes selected players, verifies contiguous snake selections and owner IDs, and checks completion of four G/four F-C/two Flx active slots plus four reserves with dual eligibility. It proposes choices and never submits them. No pick-survival model or adaptive category-deficit optimizer is claimed.

This is a usable **manual draft decision aid**. It is not a cleared unattended pick list. Historical-only transfer roles and high-value missing-history players remain the largest input risks; no chronological accuracy/calibration evidence exists yet. Full weekly lineup optimization remains a separate milestone.

## How to use it at slot six

1. Open the CSV sorted by Draft priority, keeping Category rank, ADP, provider rank, basis and flags visible. Consult the provider-covered lane alongside the model order. Provider-uncovered means missing coverage, not a negative opinion.
2. For the first two picks, review Tyler Tanner, Jeremy Fears, Pryce Sandfort, Amari Allen and Motiejus Krivas when still available; each has both a current forward projection and a high model priority. Their relative order remains a judgment under the displayed category/role assumptions. These are conditional candidates, not predictions about who survives to pick six or eleven.
3. Do not blindly spend an early pick on a historical-only outlier. For example, Javontae Campbell's high category estimate and much later cached ADP require current-role and opportunity-cost review. Conversely, Jordan Smith's cold-start estimates can rank him far below RotoWire; that is a signal to investigate missing shooting/stocks information, not justification to ignore a high external rank.
4. Build a mix of assists/threes/FT contributions and rebounds/blocks/FG contributions. Keep the legal remaining slot check active. Balanced does not require a rigid round-by-round position recipe or guarantee category wins.
5. Recheck status/eligibility before each short-listed pick. Toppin is outside the default list; any deliberate stash needs a separate manual decision because there is no IR slot. Provider publication notes about fifth-year eligibility are time-bound evidence, not clearance.

## Fastest automation path: Fantrax's own rank list

Read-only inspection of [Fantrax Draft Ranking](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/draft-ranking) and its Help on October 27 established:

- CSV import accepts first-name/last-name in column one and team abbreviation in column two. The import dialog warns that importing **replaces existing rankings**. Autosave applies to rank edits.
- The manager's ranking supplies the top remaining player for automated/live online drafts. An empty/exhausted list falls through to Fantrax defaults.
- Exclude prevents a player from being drafted; Position rankings supersede player rankings. Help also describes queue/pre-ranked inputs before default Fpts/Score/ADP fallback. Verify exact queue/position interaction in the draft room before relying on it.
- Ranking and Exclude were observed empty; Position overrides were not fully reconciled. No rank, queue, exclude or position setting was edited.

The generated [proposed import CSV](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/fantrax-rank-import.PROPOSED.csv) uses exact saved Fantrax names/team abbreviations and omits known blocked statuses. It is a **review artifact**, not an uploaded or validated production import. Import matching, all high-priority statuses and omitted freshmen still need review.

Recommended sequence before enabling native autopick:

1. Refresh the official pool/ADP/eligibility export and targeted status evidence on draft day; retain original bytes and observation times. Re-read the provider article without pretending retrieval changes its publication date. Recompute the board and inspect changes, especially transfer minutes and cold starts.
2. Curate the first 112-plus plausible candidates, adding reviewed missing-history prospects and ordering serious provider disagreements deliberately. A long low-confidence historical tail does not substitute for a curated early queue. Preserve a backup of any existing Fantrax rankings, exclusions and position overrides.
3. Present the exact final CSV, blocked players, fallthrough behavior and league/team for approval to upload/apply. The present request asks for an automation plan; it does not authorize changing the live list or submitting picks.
4. After that separate authorization, import using the supported UI and read back the matched ordered list, mismatches, duplicates, exclusions and position overrides. A successful file selection alone is not evidence of a correct ranking. Verify draft-room behavior before leaving the system unattended.
5. Prefer native Fantrax autopick as the clock-sensitive fallback once the list is cleared. It works inside the platform; a daily app heartbeat cannot react to a one-minute clock. No native autopick setting has been enabled by this work.

## Local copilot: implemented and next work

After building with Node 26, regenerate the board when source inputs change. A regeneration creates a new board revision: reconcile the manual session against the actual league order/picks, then update its boardRevision to the new board before running draft-recommend or the rehearsal. Do not relabel simulated selections as real picks. The bundled pre-draft session is already matched to the saved board:

```sh
node dist/src/basketball/cli.js draft-recommend --board artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.json --state artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/session.pre-draft.json
node scripts/basketball/draft-rehearsal.mjs artifacts/basketball/2026-10-27/check-in-1201/draft-forecast
```

Use the bundled Node 26 binary if `node` on PATH is older. The session is explicitly manual/local. During a real live draft, record actual picks with stable IDs in order and their observation time; do not simulate selections into the real session. The current pre-draft file has no picks. The advisor blocks live advice if the session is over 20 seconds old or the board/pool/provider retrieval is over 24 hours old; those are declared operational limits, not measured reliability thresholds. Projection publication age is displayed separately. No absence-of-injury clearance is inferred.

Next bounded implementation, after input review:

- Build a read-only observer from permitted browser views or documented responses. Authenticate normally; HTTP clients previously returned 403, so do not extract cookies, bypass controls or promise unattended acquisition. Distinguish unselected API shells from a real active clock.
- Validate league/team/order/phase and stable player identities; append observations with receipt times. Detect missing/reordered/duplicate picks, user changes, disconnects and source conflicts. Reconcile before emitting fresh advice.
- Run a dedicated foreground loop on draft night with a visible latest-pick receipt, recommendations, input ages and manual fallback. Measure end-to-end latency and reconnect behavior against the one-minute clock before making operational claims.
- Add roster-aware marginal category value, unresolved-role review controls and prospective forecast archiving. Test stale status and pick races. These are not delivered features yet.
- Keep pick submission manual until a supported writer, precise execution policy and separate authorization exist. Future writers need fresh state, one-pick idempotency/receipt verification and no blind retry after unknown success. Claims/drops/trades retain their separate exact approval rules.

## Draft-day checkpoints — proposed, not scheduled monitoring

- **By 8:00 PM EDT October 28:** refresh pool, role/status evidence and board; resolve top-candidate omissions and review source age.
- **8:30 PM:** curate/import only after authorization and verify readback; confirm slot/order, exclusions, position overrides and fallback.
- **8:45 PM:** enter the draft room, confirm current state and rehearse manual access. If the observer has not passed a live read/latency check, use a reviewed native list and manual oversight.
- **9:00 PM:** draft. One-minute picks require foreground attention or verified native autopick. The existing daily heartbeat is only an interim research/check-in schedule.
- **After the draft:** reconcile all 14 actual IDs/slots, archive draft decisions, and prepare waiver priorities respecting undrafted-player waivers and weekly activation. No automatic post-draft claim is implied.

No purchase, new account, paid feed, external message, live rank upload, pick or model promotion occurred. See [validation/rehearsal](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/validation.json) and [implementation review](committee/10-draft-implementation-review.md).

# Basketball copilot — runbook and next gates

October 27, 2026. The local browser simulator and explicit read-only Coach are implemented. Fantrax live following and every Fantrax writer remain unvalidated. [Sol medium source review](committee/12-sol-copilot-implementation-review.md), [validation report](../../artifacts/basketball/2026-10-27/copilot-build/validation/report.md).

## Try it on the desktop

The current local mock is at **http://127.0.0.1:38417/**, reset to a fresh Balanced session. While its foreground process is running:

1. Click **Start mock**, then **Burst to my turn**. A burst advances at most eight opponents, so a longer snake interval needs two bursts.
2. Choose a player from the adaptive table with **Queue**, or choose **Candidate → Queue candidate**. Review the roster slot, then **Confirm own pick**.
3. Change **Opponent scenario** to stress guard or F/C demand. The three cards compare the same available inputs; **Use this profile** explicitly changes your selected construction. Suggested profile does not switch it automatically.
4. Watch selected players disappear, opponent needs change, the snake board fill and exact local receipts appear. Picks and opponents here are synthetic; the forecast inputs come from the saved real baseline.
5. **Pause** survives reload and clean restart. **Advance clock 60s** tests expiry; confirmation must fail. **Reset session** makes a separate synthetic session. It retains the selected profile; select Balanced to restore the starting preference.

The separate current Coach is at **http://127.0.0.1:44151/**. It displays the explicitly captured real pre-draft grid. Its queue/pick controls are disabled. It does not watch Fantrax automatically, and its source age must increase until another actual browser capture is supplied.

If either process stops, restart from the repository root using Node 26. Build first:

```bash
export PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH"
npm run build
node dist/src/basketball/cli.js copilot \
  --board artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.json \
  --state artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/session.pre-draft.json \
  --mode mock --port 38417 \
  --copilot-data data/basketball/mmioj1mvmvgsc3io/copilot/browser-rehearsal-20261027
```

Use a different data directory and `--mode coach --port 44151` for Coach. The current Coach directory is `data/basketball/mmioj1mvmvgsc3io/copilot/coach-preflight-20261027`. Never reuse synthetic journal storage as Coach. Stop with Ctrl-C for a clean lease release. Neither mode has a Fantrax writer. The root CLI prints the actual loopback URL; `--port 0` selects an available port.

## What the rankings mean

Balanced, Guards and Bigs use fixed, experimental construction weights. Every completed path is evaluated with the same eight-category reference metric. FG% and FT% use summed makes/attempts, and turnovers have no penalty. The engine chooses the best legal active ten within each constructed fourteen-player roster. Roster construction and opponent choices remain bounded heuristics: at most 24 starting candidates, a per-profile completion pool capped at 160 and an opponent pool capped at 112, drawn from the full available forecast board.

Off-turn scenarios simulate opponents before the first own selection, remove those players, and then compare the next two own picks. ADP/guard-demand/big-demand cases are conditional stress tests. They are not survival probabilities, category-win odds or evidence that a profile wins more often. The forecast covers 2,209 of 5,687 identities, including 29 targeted provider supplements; 3,478 identities remain unmodeled. Current availability/role flags remain material. Saved history/provider ages never renew when a mock advances or an old capture is replayed. The real forecast has not been refreshed or promoted during this build.

## Read-only Fantrax preflight bridge

[`read-fantrax-dom.js`](../../scripts/basketball/read-fantrax-dom.js) is a rendered-DOM reader for the supported browser tool. It does not access cookies, hidden state or network endpoints. Capture its returned fields to a new JSON file. The strict decoder currently accepts only the observed empty pre-draft grid, exact eight-team order and 112 snake cells. Unknown live content fails closed.

Immediately send a fresh capture to a running Coach using the bounded helper:

```bash
node scripts/basketball/ingest-fantrax-preflight.mjs \
  --board artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.json \
  --state artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/session.pre-draft.json \
  --capture /absolute/path/to/new-browser-capture.json \
  --team-directory artifacts/basketball/2026-10-27/copilot-build/validation/confirmed-team-directory.json \
  --target http://127.0.0.1:44151/ --out /absolute/path/to/new-receipt.json
```

Capture-to-ingest age must be at most 20 seconds. Do not edit timestamps to pass it. The team directory links the earlier observed header order to the previously confirmed session order; it is not a fresh platform-ID lookup. The helper verifies the local Coach scope and preserved board hash, posts only to loopback and creates a new receipt without overwriting an existing one. October 27's real capture at 17:57:14Z reached Coach at 17:57:27Z. This 13.6-second manual handoff does not pass the proposed three-second live-ingestion target.

## Journal recovery

Each data directory has one exclusive `journal/.writer-lease`. Clean shutdown releases it; an abrupt crash leaves it behind and startup refuses a second writer. If startup reports an existing lease, inspect that exact lease and its PID, then inspect the process. If it is alive or its identity is uncertain, stop and use a different isolated mock directory. Do not remove a lease because it is old. After confirming the former process has exited, archive a copy of the entire journal and the lease before removing only that stale lease. Restart replays hashed complete JSONL entries; a trailing partial entry can be discarded, while a bad complete entry fails closed. No automatic stale-lease stealing or tested crash-recovery command is delivered. Keep the native Fantrax/manual draft available.

## Next steps for actual Fantrax following and picking

1. Obtain a suitable free practice room. NCAAB, NBA and All lobbies were empty during this task; All was rechecked at 13:54 EDT. If NBA becomes available, use separate NBA identities/rules for transport testing. It cannot establish college projections or the college identity crosswalk. A user-chosen private free practice league is another possible test venue. No paid contest, account creation or terms acceptance is part of this implementation.
2. Verify a complete live pick history, stable player identity (or an exact independently checked name/school crosswalk), current picker and displayed clock. Handle virtualized rows, missed batches, reconnects and commissioner corrections against fresh complete browser evidence. Do not infer a live selection from initials, a shell or a correction flag alone.
3. Measure the supported foreground browser → observer → engine → rendered advice loop with at least 100 changing observations and a sustained ten-minute run, including actual tool/orchestration time. Targets remain p95 ≤3s ingestion and ≤5s visible advice. The local tests passed 105 changing-pick observations in under five minutes; they do not pass the ten-minute or external transport gates. The manual preflight hop exceeded the ingestion target. This integration must be improved or retained as explicit advisory ingestion.
4. Only after transport tests, implement a separately scoped practice-room actor: just-read board/turn, exact player and roster slot, state revision, single writer, ≥15s clock buffer, one dispatch, exact receipt and no blind retry. Test queue-versus-position/ranking precedence, autopick, races, undo, stale capture, disconnect and acknowledgement failure in three full platform practice drafts. Local simulator receipts are not platform receipts.
5. Review a per-capability go/no-go before real use. Queue edits, rank imports, an approved individual pick and automatic picks are different scopes; none is enabled by the current build or scheduled workflow. Real selections require their own concrete authorization after validation.

The league room still says **Wednesday October 28 at 9:00 PM EDT**, with jxstovik in slot six and no picks as of the 13:57 EDT read. Suggested draft-day checkpoints remain 8:00 PM source/roster preflight, 8:30 PM order/fallback review and 8:45 PM room readiness. These checkpoints are not configured jobs. The existing daily morning heartbeat is not the one-minute-clock runner or a continuously running Fantrax watcher.

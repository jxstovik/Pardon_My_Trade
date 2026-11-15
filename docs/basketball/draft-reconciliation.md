# Draft ranking reconciliation

This workflow produces two separate local candidates: an eight-category statistical board and a provider-first rank-only fallback. Neither output promotes a model or changes Fantrax.

## Evidence and current limits

The frozen October27 board revision is `e3298d4ba837c70fabc3256b5856eb669c2da77ae06e31a62a814febbc71520b`. Its original historical/player/provider observations remain separate from current retrievals. The October28 official Standard export contains5,680available IDs (19removed,12added); all5,668shared IDs have unchanged historical rates and12have changed position eligibility. A source's absence does not establish why a player disappeared.

The newly retrieved public RotoWire projections expose ten rows with MIN/PTS/REB/AST/ST/BLK/3PTM/TO and displayed double/triple-double rates, but no FG/FT components. The full article now displays a FantasyPass access boundary in the supported browser. The prior29partial projection/global-rank records retain their original retrieval times; fuller indexed extractor text was not used to bypass that boundary. No second independent current college-fantasy projection provider was verified. NBA rankings, individual talent rankings and copies of RotoWire are not a fantasy consensus.

Manifest: [frozen evidence](../../artifacts/basketball/2026-10-28/reconciliation/evidence-manifest.json). [Acquisition notes](../../artifacts/basketball/2026-10-28/reconciliation/acquisition-notes.json), [role/status notes](../../artifacts/basketball/2026-10-28/reconciliation/role-status-evidence.json), [membership differences](../../artifacts/basketball/2026-10-28/reconciliation/fresh-pool-diff.json). The manifest points to hashed structured source records and their upstream artifacts; a structured transcription hash is not a raw HTTP-response hash.

## Interpretation

The league awards each-category W/L/T across PTS,REB,AST,ST,BLK,3PTM,FG%,FT%, with no turnover penalty. Eight equal standardized contributions remain a draft heuristic, not an expected category-win model. Percentages use makes/attempts and modeled volume; they are not averaged across players. All estimates are per game conditional on playing. Schedule, weekly counted starts and availability probabilities are not inferred.

Separate player identity/pool, statistical projections, scoring format, normalization cohort and positional replacement effects. Compare common identities before interpreting global rank gaps. The expert's ranking includes upside and role judgment; it may intentionally differ from the expert's own conservative point projection. Our use of the same provider's four projected fields means agreement is not independent validation.

The original board’s static priority subtracts a40th-eligible-player proxy, shifting guards down and frontcourt players up. Corrected candidate static ordering removes that adjustment;32nd/40th/48th alternatives remain labeled diagnostics, while actual roster construction is checked by the existing legal-slot logic.

## Sensitivity experiments

Versioned configuration controls category ablations (each category, percentages together, defensive categories together), reference normalization, positional proxies, current minutes stress cases and0/current/2x shrinkage priors. Hold estimates and normalization fixed for isolated scoring tests, then report recomputed-cohort experiments separately. Exact marginal FG/FT changes use legal active-ten roster scenarios. Historical-only transfers and cold starts stay explicitly uncertain.

Sourced PTS and3PTM must survive coherent shooting reconciliation. Complete directly supplied shooting components must be checked, never silently repaired. Missing/unsupported partial components cannot be marked as sourced. Provider-described DraftKings scoring is a separate diagnostic; missing turnover or bonus-event inputs must be explicit, not assumed zero or reconstructed from marginal means. Stress scenarios are not probability intervals and are never optimized to force agreement with external ranks.

## Execution and safeguards

Use Node26. Build before compiled tests. Run the basketball `draft-reconcile` CLI with the frozen board, explicit evidence manifest, versioned scenarios, output directory and as-of time. Every candidate, explanation, rehearsal and session must identify the same board/evidence hashes. Artifacts are versioned and prior revisions remain intact.

Verify baseline reproduction, source/upstream hashes and record derivation, scoring arithmetic, shooting coherence, identity collisions, rank-only fallback, timestamps, roster completion and stale gates. Rehearse112synthetic selections for each candidate with all eight rosters checked. Browser-test the read-only candidate selector without changing active strategy/session. No mock result proves Fantrax transport, pick latency or model accuracy.

Luna/xhigh owns implementation; Sol/medium independently reviews. Main orchestration remains Sol/High. Draft-day source limitations remain visible even when software checks pass. The previously saved2,196-row Fantrax list remains unchanged; proposed CSVs are local review artifacts only. All league writes, model promotion and live picks are out of scope for this execution.


## Delivered execution

[Final findings and candidate links](../../artifacts/basketball/2026-10-28/reconciliation/result.md). Build and 59 compiled basketball tests passed; two synthetic full-draft rehearsals and final read-only browser checks passed. See the linked independent review for its scope. The eight remaining provider-top20/model-outside112 cases remain unresolved.

Run from the repository root (Node26):

```bash
PATH="$PWD/data/runtime/node-v26.11.1-linux-x64/bin:$PATH" npm run build
data/runtime/node-v26.11.1-linux-x64/bin/node --test --test-isolation=none dist/tests/basketball-*.test.js
data/runtime/node-v26.11.1-linux-x64/bin/node dist/src/basketball/cli.js draft-reconcile \
  --board artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.json \
  --evidence artifacts/basketball/2026-10-28/reconciliation/evidence-manifest.json \
  --out artifacts/basketball/2026-10-28/reconciliation \
  --as-of <explicit-offset-instant>
```

Use the returned immutable revision directory with `copilot --reconciliation <revision-directory>` alongside the original `--board` and `--state`, `--mode coach`, a private local `--copilot-data` path and `--port 0`. This exposes candidates for comparison only. Loopback tests/server binding may need the environment’s normal approval mechanism. A newer execution time never changes source field observation times.

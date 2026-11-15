# Historical player export review

Reviewed 2026-10-27. Read-only review of `src/basketball/history.ts`, its CLI routes, tests, source metadata, the official standard-view CSV, and the saved history manifest. No build or tests were run for this review.

## Result

No blocking provenance, scope, precision, or quarantine defect found. The export metadata identifies the configured Banging 3s league, the Fantrax players page, 2025-26 Reg Season YTD per-game data, the all-available-player filter, the standard stat view, and one-decimal count display precision. The CSV has 5,687 named rows, 5,687 unique IDs, 24 columns, and uniform row widths. Its GP values are nonnegative integers; 3,218 rows have positive displayed GP and 2,469 have zero displayed GP. The per-game count fields required by the importer are present and use no more than one decimal place. No zero-GP row has positive displayed count rates.

The saved manifest and current-history pointer agree with the normalized revision. The original CSV SHA-256 is `71e31bdff0b388fded25d9abd8781e8a3097f277a867016a16ecb554e949912f`. The importer retains those original bytes and rechecks both the manifest revision and raw-file hash when reading history. It also re-runs normalization on read, validating source scope and ensuring the saved normalized rows still match the raw file.

The points identity screen uses `PTS − (2 × FGM + 3PTM + FTM)` and an explicitly labeled ±0.25 nearest-tenth envelope. Only two rows exceed it: Vinny Sigona at −0.300 and Anakin Brown at +0.700. Both values remain unchanged in the saved history with a quarantine flag and `usableForBaselineResearch: false`; neither row is repaired. Those rows are excluded from the bounded screen count, leaving 3,216 rows marked as passing it. Zero-GP rows remain explicitly unresolved and are also excluded. This is a soft quarantine in the returned data: flagged rows remain available for audit, so any future research consumer must honor the usability flag.

The output remains historical research evidence. It warns against multiplying rounded per-game values by GP and calling the results exact totals, identifies missing coverage and role context, and reports zero current-season forecasts. No player rankings, model promotion, or live action are introduced. The `history-import` and `history-report` commands are now also listed in CLI help.

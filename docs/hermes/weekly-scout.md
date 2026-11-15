# Reproducible weekly scouting from Hermes

Gateway or terminal-chat prompt:

> Generate my Week 6 scouting report using pmt-weekly-scout. Refresh models with completed Week 5 NFLverse data, current ESPN lineups/free agents and news. Show current and recommended lineups, compare against the opponent's optimized lineup, and give HTML, PDF and Obsidian outputs. Do not execute roster actions; keep only one defense.

MCP starts the fixed local weekly workflow with `pmt_generate_scout_report` and polls status through `pmt_get_scout_report`. Both tools are exposed by the existing pmt-read connection. The read role and disabled transaction execution are forced in the worker.

The terminal command is `npm run scout:weekly -- --week 6` from the project using Node 26. Dependencies are persisted in `data/scout-pydeps`; NFLverse source files are persisted in `data/nflverse`. The Python executable can be configured with `PMT_SCOUT_PYTHON`, and its module path with `PMT_SCOUT_PYTHONPATH`. Defaults use this computer's bundled Python runtime and project dependencies.

Artifacts are isolated by week under `artifacts/week6-2026-scout` and `output/pdf/week6-scout`. The current site reads public/scout-data.json; archived standalone reports embed their own data. Models use a strict requested-week-minus-one cutoff. News does not manually rewrite model values. Ambiguous names are excluded and an unmatched roster identity fails the workflow. Unmatched free agents are counted and omitted.

Only current or next-week forecasts are accepted. Read timestamps, calendar state, validation metrics, source hashes and candidate status remain visible. Persistent production models are not promoted. High-risk roster actions still require exact human authorization through the separate operator workflow.

## Verified on October 14, 2026

The full workflow read the live Week 6 matchup and 892 available players, ingested 62 ESPN and 86 Razzball news items without degraded feeds, retrained all six candidate position models through Week 5, and produced the report. Unique matching covered all 32 roster entries and 391 free agents; 501 available identities without a unique current-season row were omitted. All 281 compiled tests passed. Hermes terminal chat successfully called `pmt_get_scout_report` through the configured read connection and returned the expected 108.55 recommended points and 52.96% win probability against an optimized opponent. Gateway uses the same connection; its live messaging transport was not exercised.

For an explicit terminal-chat verification, use `hermes chat --oneshot --toolsets pmt-read -q "Use pmt_get_scout_report for week 6 and summarize the completed report."` The bare server alias `pmt-read` is required when filtering startup; `mcp-pmt-read` does not match Hermes's server filter.

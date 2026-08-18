---
name: pmt-projection-refresh
description: Run and inspect PMT's in-season projection refresh across configured sources, cache, roster matching, persistence, and model rebuild outputs. Use for current-week projections, source degradation, or refresh provenance.
version: 1.0.0
metadata:
  hermes:
    tags: [pmt, fantasy-football, projections, refresh, cache, provenance]
    requires_toolsets: [mcp-pmt-read]
---

# PMT Projection Refresh

## When to Use

Use this skill for a PMT projection refresh, a current scoring-period lookup, a
source/cache investigation, or a check that fresh projections reached the
roster and model layers.

## Operating Contract

- Resolve season and scoring period with PMT's calendar tool.
- Use only sources configured by PMT or explicitly selected by the user.
- Keep source, fetch time, cache state, projection horizon, player-match status,
  and model version attached to the result.
- Missing or degraded data is not zero data and is not evidence against a
  player.
- Projection retrieval does not authorize a league action.

## Procedure

1. Identify the league and season. Call `mcp_pmt_read_pmt_get_current_scoring_period` unless
   the user supplied an explicit period that PMT can validate.
2. Call `mcp_pmt_read_pmt_get_projection_status` before refreshing. Record the last successful
   run, configured sources, cache age, prior scoring period, and any degraded
   source state.
3. Call `mcp_pmt_read_pmt_refresh_projections` with the validated season, scoring period,
   source selection, and force-refresh intent only when explicitly requested.
4. Inspect the result for per-source counts, skipped sources, errors, cache
   behavior, roster matching, persistence, and runtime model rebuild status.
5. Call `mcp_pmt_read_pmt_get_projection_provenance` for requested players or material
   discrepancies. Compare like-for-like periods and sources; do not merge rows
   with different horizons or silently resolve a name collision.
6. Report the refresh as fresh, partial, skipped, or failed according to PMT's
   status. Include the exact period and every degraded source.

## Source and Cache Handling

- Respect PMT's configured cache policy. Do not bypass it merely to obtain a
  newer-looking answer.
- Use a force refresh only when the user explicitly asks for it or PMT's
  procedure requires it.
- Preserve optional-source failures so downstream users know the data is
  incomplete.
- If no candidate matches the imported roster, report zero matched rows rather
  than inventing an ID or attaching by approximate name.
- If a source is unavailable, continue only as PMT's refresh result directs and
  label the fallback or missing coverage.

## Safety

- Do not manually alter projection values, confidence, floor, ceiling, or source
  provenance in the response.
- Do not promote an unapproved artifact or retrain a production model from a
  chat request.
- Do not use projections as a substitute for current ESPN roster state before a
  live-action review.
- Do not call any platform-write operation from this skill.

## Verification

A successful report identifies the season, scoring period, sources attempted,
sources skipped or failed, matched and persisted coverage, cache decision,
model status, and provenance availability. If any of those are absent, mark the
refresh incomplete.

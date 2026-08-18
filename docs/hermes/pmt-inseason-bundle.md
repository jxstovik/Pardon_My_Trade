# PMT Hermes Skill Bundle

Status: project-local skills, a versioned PMT MCP contract, and a
PMT/Hermes compatibility baseline are checked in; the bundle remains a
profile-level convenience.

The repository contains project-local Hermes/Agent Skills under `.agents/skills/`
and a PMT stdio MCP server under `src/mcp/`. Hermes discovers the skills after
the project is trusted. Hermes skill bundles, however, are profile resources under
`~/.hermes/skill-bundles/*.yaml`, and this repository has no bundle loader or
profile configuration. The YAML below is therefore documentation for a future
profile-level bundle, not a file that Hermes will load from this repository.

## Intended Bundle

```yaml
name: pmt-inseason
description: PMT in-season league operations, refreshes, model review, and human-gated actions.
skills:
  - pmt-inseason
  - pmt-espn-league-operations
  - pmt-news-and-injuries
  - pmt-projection-refresh
  - pmt-model-operations
  - pmt-action-review
instruction: |
  Use PMT MCP tools as the authority for league state, rules, calculations,
  provenance, and action status. Keep live actions review-first and require
  explicit approval for the exact queued action. Never call a direct platform
  write tool from the workflow skills.
```

## Tool Contract

The skill files use the versioned `pmt_*` MCP contract implemented by
`src/mcp/server.ts`. The read configuration in
`integrations/hermes/mcp-config.example.yaml` exposes league reads, source
refreshes, deterministic recommendations, model inspection, and queue previews.
The operator configuration is disabled by default and exposes the separately
gated, audited executor only when explicitly enabled. The exact release boundary is recorded in
`integrations/hermes/pmt-hermes-compatibility.yaml`.

The bundle does not grant write permission. In particular, action approval must
remain an explicit, auditable PMT operation, and an approval result must not be
reported as execution unless the PMT tool confirms execution.

For secret-free installation, upgrades, rollback, and release pinning, see
`docs/hermes/install-upgrade.md` and `docs/hermes/release-versioning.md`.

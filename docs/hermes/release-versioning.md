# Hermes Release And Versioning

Hermes is an integration surface, not a second PMT package. A release must pin
the PMT source, generated MCP runtime, Node runtime, Hermes gateway, model
selection, and any generated model or projection artifacts as one compatible
set.

## Version Authorities

| Item | Authority | Pinning rule |
| --- | --- | --- |
| PMT release | `package.json` version | Use the release version plus an immutable git tag or full commit SHA. |
| MCP contract | `PMT_MCP_CONTRACT_VERSION` in `src/mcp/contracts.ts` | Record the exact value in the compatibility manifest. |
| MCP server | `PMT_MCP_SERVER_VERSION` in `src/mcp/contracts.ts` | Record the exact value; it is independent of the package version. |
| Node runtime | `.nvmrc` and the package engine | Build and run with the `.nvmrc` runtime, currently Node 26. |
| npm dependency graph | `package-lock.json` | Install with `npm ci`; do not release an untracked dependency resolution. |
| Hermes gateway | Operator environment | Record the exact installed Hermes gateway version. PMT does not publish a Hermes version. |
| Hermes model | Operator release record | Record exact provider and immutable model IDs; never use a floating alias. |
| MCP configuration | `integrations/hermes/mcp-config.example.yaml` | Use the config matching the MCP contract and keep `pmt-operator` disabled by default. |
| Integration baseline | `integrations/hermes/pmt-hermes-compatibility.yaml` | Update when any PMT/Hermes contract, pin, or safety boundary changes. |

The manifest's `manifest_version` identifies the manifest format. It is not a
replacement for the PMT package, MCP contract, MCP server, or Hermes gateway
version.

## Release Artifacts

A Hermes-compatible PMT release should identify these artifacts and their
checksums:

- the PMT release tag and full source commit SHA;
- the generated `dist/src/mcp/stdio.js` runtime and its imported `dist/` files;
- the matching `package-lock.json` and `.nvmrc`;
- the compatibility manifest and MCP configuration example;
- the Hermes pre-check and job installer scripts;
- the trusted project skills and the release notes;
- any intentionally shipped model/projection artifact, including its model
  version, source version, feature set, data cutoff, and checksum.

Do not ship `.env`, ESPN cookies, `ESPN_S2`, `SWID`, service credentials, local
SQLite databases, notification logs, or unreviewed `data/` contents in a release
artifact.

For a built release, generate file hashes from the immutable checkout, for
example:

```bash
sha256sum \
  dist/src/mcp/stdio.js \
  integrations/hermes/mcp-config.example.yaml \
  integrations/hermes/pmt-hermes-compatibility.yaml \
  integrations/hermes/pmt-hermes-precheck.sh \
  integrations/hermes/install-example-jobs.sh
```

Record those values in the private or published release record as appropriate;
do not replace the checked-in manifest's policy placeholders with secrets.

## Release Procedure

1. Start from a clean checkout at the intended release commit and record
   `git rev-parse HEAD`.
2. Confirm the package version, `.nvmrc`, MCP contract/server versions, and
   compatibility manifest agree with the release record.
3. Run `npm ci`, `npm rebuild better-sqlite3`, `npm run build`, `npm run lint`,
   and `npm test` using the pinned Node runtime.
4. Run `bash -n` against both Hermes shell scripts and validate the YAML files
   with an available YAML parser.
5. Generate checksums for the exact generated runtime and checked-in Hermes
   integration files.
6. Verify that no release file contains credential values and that the operator
   server remains `enabled: false`.
7. Publish the release notes with migration/configuration changes, test
   results, known limitations, rollback revision, and every runtime/provider/
   model pin.

## Compatibility Changes

Treat an MCP tool removal, renamed tool, changed required argument, changed
response envelope, or changed safety meaning as an incompatible contract change.
Update the MCP contract version, compatibility manifest, config example, skills,
release notes, and smoke checks together. A new optional tool or documentation
change still requires the manifest and release record to identify the exact
server version that Hermes was tested against.

The operator surface now includes a separately gated write executor. It remains
disabled by default and must not be enabled merely because the approval tool
appears in the MCP tool list. Enabling it requires a reviewed canary, durable
receipt/audit storage, and confirmation that unknown outcomes are reconciled
before retrying.

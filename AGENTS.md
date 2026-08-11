# AGENTS.md — Pardon My Trade

A fantasy-football General Manager CLI/library. Think of it as the fantasy
advice desk that never sleeps and, more importantly, never rage-drops your
studs without asking first.

## The one rule that will bite you
- **Tests are run from compiled output, not source.** `tsc` emits to `dist/`
  and `npm test` runs `node --test dist/tests/`. There is no test runner that
  watches `src/`. If you edit a test and run `node --test tests/...` directly,
  you are testing stale code from the last build.
- **Always build before running a single test:**
  `npm run build && node --test dist/tests/<file>.test.js`
  (`npm test` already does `build && node --test dist/tests/`.)

## Commands (the whole cheat sheet)
- `npm install` — then `npm rebuild better-sqlite3` if you're on a fresh box or
  CI. `better-sqlite3` is a native addon and will throw a loader error if it
  wasn't built for your Node version (CI does this explicitly — you should too).
- `npm run build` — `tsc`. Output lands in `dist/`.
- `npm run lint` — this is just `tsc --noEmit`. No ESLint, no Prettier config
  in the repo. Type errors = lint errors.
- `npm test` — build + run all tests.
- `npm run pmt -- <cmd>` — run a CLI command (`pmt` resolves to
  `node dist/src/cli.js`).
- `npm run serve` — build + start the local GUI at `http://localhost:3000`
  (backed by SQLite under `data/`).
- `npm run refresh` — build + run the full V1 refresh pipeline against the demo
  fixture league.

## CLI entrypoints worth knowing
Main CLI is `src/cli.ts`. Subcommands: `import-fixture`, `weekly-report`,
`refresh`, `import-sleeper`, `import-espn`, `build-models`, `ff-run`,
`action-queue`, `action-approve`, `action-reject`, `razzball-login`,
`season-refresh`, `projections`, `daemon`, `serve`, `draft-pick`,
`draft-watch`. Full list: `npm run pmt -- help`.

## Architecture in one breath
- Ports-and-adapters (ADR-0001). Business logic lives in `src/rules`,
  `src/decisions`, `src/recommendations`, `src/probabilistic` — **never in
  prompts** (ADR-0002). The `FF_Orchestrator` (DraftKat) is advisory only.
- Platform adapters (`src/adapters`) are **read-only by default** (ADR-0005);
  the ESPN adapter adds write actions but those are gated behind human
  approval.
- Knowledge layer is the `KnowledgeRepository` interface with `InMemory` (tests)
  and `Sqlite` (real runs) implementations. `serve`/imports persist to
  `data/*.db` (gitignored).

## Gotchas that are not obvious
- **Snapshots are immutable (ADR-0004).** Re-saving an existing `snapshot_id`
  throws. `serve` swallows this and reuses the prior snapshot — don't "fix" that
  try/catch thinking it's a bug.
- **High-risk moves never execute automatically.** Trades and drops are queued
  (`action-queue`) and wait for `action-approve`. Low-risk `setRoster` only
  applies automatically with `ff-run --auto`. The in-season daemon behaves the
  same way — it will never push a move to ESPN on its own.
- **Everything is fixture-first and credential-free by design.** Live ESPN
  writes need `ESPN_S2` + `SWID` (and `ESPN_LEAGUE_ID`) in the environment.
  Sleeper reads are public and need no creds. Don't add live-logins to MVP
  flows; that's intentionally out of scope.
- Env is loaded from `.env` via `loadEnv()`. Copy `.env.example` to `.env`.
  Key knobs: `PMT_DATA_DIR`, `PMT_FIXTURE_PATH`, `PMT_PROJECTION_SOURCES`
  (`espn,razzball,fftoday` to opt in — unset = ESPN only, deterministic tests).
- Node 26 required (`.nvmrc` = `26`). `type: "module"` — ESM with NodeNext
  resolution, so imports must include the `.js` extension even for `.ts` files.

## Where the docs actually live
The `docs/` folder is the spec, not the README. When unsure about intended
behavior, prefer `docs/03-architecture.md`, `docs/12-testing.md`,
`docs/14-coding-standards.md`, and `docs/adr/`. If prose conflicts with the
code, trust the code — the docs run a few milestones ahead of reality.

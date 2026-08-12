# 25 — Draft Harness Run Guide

Document ID: FDP-RUN-002
Status: Guide
Applies to: `draft-harness` branch (post `pmt draft-harness` implementation)

This guide covers the **Draft Harness**: a live, browser-based draft-day
dashboard you run locally. It tracks the draft in real time, keeps a
"best available at my next pick" queue with expected-points / upside
justification, shows your roster and positional needs, and includes an
**advisory-only** Ollama chat line for talking through strategy.

It is an extension of the pre-draft scaffolding in `docs/24-run-guide.md`
(section 1.D). The harness adds the valuation engine, the `DraftState`
reducer, the pick advisor, and the web dashboard on top of that feed.

> **Recommendation-only, by design.** The dashboard never auto-picks. The chat
> is advisory only — it discusses the board using computed context; it cannot
> record picks or act (ADR-0002/0003/0005). You make every pick. The
> `draft_pick` output is a `Recommendation`, not an action.

---

## 0. Requirements & setup

- **Node 26** (see `.nvmrc`). CI and `npm test` run on Node 26.
- **`ws`** is now a runtime dependency (WebSocket server). It is in
  `package.json`; `npm install` pulls it.
- `better-sqlite3` is a native addon — rebuild it after install:

```bash
npm install
npm rebuild better-sqlite3
npm run build            # compiles TypeScript to dist/ (required before any command)
```

Copy `.env.example` to `.env` and fill what you need (see section 4 for the
full env table).

---

## 1. Start the harness

```bash
npm run pmt -- draft-harness
# or:
node dist/src/cli.js draft-harness
```

On startup it prints:

```
Pardon My Trade draft harness running at http://localhost:3000/draft
Feed: manual | seat 1 of 12
```

Open **http://localhost:3000/draft** in your browser. The page connects over
WebSocket (`/ws/draft`) and stays live as picks land.

Stop with `Ctrl+C`. The harness runs in the foreground.

### Modes (how to run it)

| Mode | What it does | How to enable |
|------|--------------|---------------|
| **Manual (default)** | You record every pick via the dashboard form or `pmt draft-pick`. No external calls, fully credential-free. | `PMT_DRAFT_FEED=manual` (default) |
| **ESPN live feed** | Streams real picks from your ESPN draft; falls back to manual automatically if the live endpoint errors. | `PMT_DRAFT_FEED=espn` + `PMT_DRAFT_ESPN_ID=<espnDraftId>` + `ESPN_S2`/`SWID` |
| **Headless / API-only** | No browser needed — drive everything over REST (`curl`/scripts). The page is optional. | Run the server; call `/api/draft/*` (section 3) |
| **Local chat** | Ollama chat runs on your own box instead of the cloud. | `OLLAMA_BASE_URL=http://localhost:11434` |
| **Custom seat/league size** | Match your draft's shape. | `PMT_DRAFT_TEAMS`, `PMT_DRAFT_POSITION`, `PMT_DRAFT_TEAM_ID` |
| **Custom port** | Avoid a port clash. | `PMT_PORT=3999 npm run pmt -- draft-harness` |

You can combine these: e.g. ESPN live feed + local Ollama + custom port.

---

## 2. The four panels

1. **Live board** (left) — every pick as it arrives (`pickNo`, team, player,
   source), plus a status line: your seat, the next overall pick, and how many
   picks until you are on the clock again. Includes a **Record pick** form.
2. **Best available** (center, widest) — ranked queue at your next pick:
   - expected points (horizontal bar, scaled to the list max)
   - upside as three bars for **P(points > 8 / 12 / 18)**
   - a **Tier N** badge (value cliffs)
   - a **survival %** — the model's estimate the player is still on the board
     when your seat is next
3. **My roster & needs** (right) — slot-by-slot requirements vs. what your team
   already has; slots you still need are highlighted red, filled slots green.
4. **Chat** (bottom/right) — advisory conversations with Ollama about needs,
   tier stacks, and trade-offs. Purely conversational; it never picks for you.

All four update from a single `renderSnapshot()` on every WebSocket message
and on the initial REST load.

---

## 3. Endpoints (for headless / scripting)

| Method & Path | Body | Returns |
|---|---|---|
| `GET /api/draft/state` | — | full `draft-snapshot` (board, myRoster, needs, bestAvailable, nextPick, picksUntilMyNext, mySeat) |
| `POST /api/draft/pick` | `{ round, roundPick, teamId, playerExternalId, pickNo? }` | `{ ok: true, snapshot }` |
| `POST /api/draft/chat` | `{ messages: [{ role: "system"\|"user"\|"assistant", content }] }` | `{ reply: string }` (502 if Ollama is unreachable) |
| `WS  /ws/draft` | — | pushes `draft-snapshot` on connect and after every pick |

Example — record a pick and ask the chat, no browser:

```bash
curl -s -X POST localhost:3000/api/draft/pick \
  -H 'content-type: application/json' \
  -d '{"round":1,"roundPick":1,"teamId":"team-001","playerExternalId":"player-qb-001"}'

curl -s -X POST localhost:3000/api/draft/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"I need a WR and a TE. Who should I take next?"}]}'
```

The `draft-pick` CLI command (docs/24 §1.D) writes into the same durable
manual feed the harness reads, so you can run `pmt draft-pick ...` in a second
terminal and watch it appear on the dashboard.

---

## 4. Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PMT_DRAFT_FORMAT` | `snake` | Draft type (snake order is implemented; `auction` is a stub). |
| `PMT_DRAFT_TEAMS` | `12` | Number of teams (drives snake seat math). |
| `PMT_DRAFT_TEAM_ID` | `team-001` | **Your** team id in the loaded league — used for roster/needs. |
| `PMT_DRAFT_POSITION` | `1` | Your draft seat (1-based). |
| `PMT_DRAFT_FEED` | `manual` | `manual` or `espn` (live poll). |
| `PMT_DRAFT_POLL_MS` | `15000` | Live-feed poll cadence. |
| `PMT_DRAFT_ESPN_ID` | — | ESPN draft id; required when `PMT_DRAFT_FEED=espn`. |
| `ESPN_S2` / `SWID` | — | ESPN cookie credentials for the live draft feed. |
| `OLLAMA_BASE_URL` | `https://ollama.cloud` | Ollama API base (no trailing `/api`); use `http://localhost:11434` for local. |
| `OLLAMA_MODEL` | `llama3` | Model name to chat with. |
| `OLLAMA_API_KEY` | — | Bearer token for Ollama Cloud. |
| `PMT_FIXTURE_PATH` | `tests/fixtures/sample-football-league.json` | The league snapshot that supplies the **player pool, projections, and roster/needs**. |
| `PMT_DATA_DIR` | `./data` | Where `draft-state.json` (board) and the manual pick JSONL live. |
| `PMT_PORT` | `3000` | Harness/GUI port. |

---

## 5. Integrating with your ESPN draft

Two things are happening, and it helps to keep them separate:

1. **The player pool, projections, and your roster/needs** come from the league
   snapshot at `PMT_FIXTURE_PATH`. Out of the box this is the bundled demo
   fixture, which has 16 rostered players, 3 free agents, and only **2**
   projections. So the best-available board ranks mostly by **position
   baselines** until a snapshot with real projections is supplied.
2. **The live pick feed** can stream real picks from ESPN when
   `PMT_DRAFT_FEED=espn` + `PMT_DRAFT_ESPN_ID` + `ESPN_S2`/`SWID` are set.

To run against your real league today:

```bash
export PMT_DRAFT_FEED=espn
export PMT_DRAFT_ESPN_ID=<your-espn-draft-id>
export ESPN_S2=<...> SWID=<...>
# point the player pool at a snapshot that represents your league:
export PMT_FIXTURE_PATH=/path/to/your-league-snapshot.json
export PMT_DRAFT_TEAM_ID=<your-team-id-in-that-snapshot>
export PMT_DRAFT_TEAMS=12 PMT_DRAFT_POSITION=<your-seat>
npm run pmt -- draft-harness
```

The live ESPN feed is **unverified** (the parser is best-effort): if it errors
or returns nothing, it silently contributes nothing and the manual feed carries
the board — just record picks via the form or `pmt draft-pick`.

> **Honest limitation.** The harness valuation reads `projections` embedded in
> the `PMT_FIXTURE_PATH` snapshot (or position baselines). The external
> projection sources wired elsewhere (`PMT_PROJECTION_SOURCES=espn,razzball,
> fftoday`) are **not** yet merged into the harness board — set them on a
> supplied snapshot instead. Treat the current best-available as a sound
> ordering by scarcity-adjusted prior, not live consensus.

---

## 6. Troubleshooting

**Page is blank / `http://localhost:3000/draft` 404**
- You must build first: `npm run build`. The server only serves compiled
  assets. Confirm the startup log printed the `/draft` URL.

**WebSocket never connects**
- Open the page from the **same host:port** the server listens on (default
  `localhost:3000`). The socket path is `/ws/draft` on that origin.
- A proxy or `https` front-end that doesn't upgrade WebSocket will break the
  live feed; the REST `/api/draft/state` still works as a fallback.

**Best-available is empty or全是 baselines (no real projections)**
- The loaded snapshot has few/no `projections`. Supply a richer snapshot via
  `PMT_FIXTURE_PATH`. The fixture demo has only 2 projections by design.
- This is expected with the default fixture — the board still ranks by
  position-adjusted priors.

**My picks aren't showing up**
- In **manual** mode you must record them: use the dashboard **Record pick**
  form, or `npm run pmt -- draft-pick ...`. The harness does not invent picks.
- In **ESPN** mode, verify `PMT_DRAFT_ESPN_ID` and `ESPN_S2`/`SWID`; check the
  startup log (`Feed: espn (espn <id>)`). If the live feed is unhealthy it
  falls back to manual — record picks yourself.

**Chat returns a 502 / "ollama chat failed"**
- The board keeps working; only chat is down. Check `OLLAMA_BASE_URL`,
  `OLLAMA_MODEL`, and `OLLAMA_API_KEY`. For local Ollama,
  `OLLAMA_BASE_URL=http://localhost:11434` and no key. Confirm the model is
  pulled (`ollama pull llama3`). The chat client posts to
  `${OLLAMA_BASE_URL}/api/chat`.

**Wrong seat / needs look off**
- `PMT_DRAFT_TEAM_ID` must match a team in the loaded snapshot, and
  `PMT_DRAFT_POSITION` / `PMT_DRAFT_TEAMS` must match your league. The roster
  panel shows the team whose `team_id` equals `PMT_DRAFT_TEAM_ID`.

**Port already in use**
- `PMT_PORT=3999 npm run pmt -- draft-harness` (then open `:3999/draft`).

**`better-sqlite3` loader error on start**
- `npm rebuild better-sqlite3` (native addon must match your Node version).

**Board state won't reset**
- Picks persist to `PMT_DATA_DIR/draft-state.json` and the manual feed at
  `PMT_DRAFT_STORE` (default `./.pmt/draft-manual.jsonl`). Delete both to
  start a fresh board.

**Tests / CI**
- `npm test` runs `node --test dist/tests/*.test.js` on **Node 26**. The
  `draft-harness.test.ts` suite is hermetic (temp dir), so it does not depend
  on `./data`.

---

## 7. Deferred to V1 (not in this build)

Per the agreed scope, the chat is advisory only. Planned next:
- Ollama-driven **view/visualization queuing** (let the chat re-arrange or
  highlight panels),
- **Autodraft recommendations** (the advisor proposes a pick that you still
  approve — no silent auto-pick).

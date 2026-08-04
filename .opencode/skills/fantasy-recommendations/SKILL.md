---
name: fantasy-recommendations
description: Use ONLY when the user asks for fantasy football draft rankings, start/sit advice, weekly projections, waiver targets, ROS rankings, ADP, auction values, sleepers, buy-low/sell-high candidates, or any player recommendation sourced from football.razzball.com, FFToday, ESPN, or FantasyPros. Trigger keywords: "fantasy football", "start/sit", "who should I start", "waiver wire", "rankings", "projections", "buy low", "sell high", "sleeper", "ADP", "ROS rankings", "DFS", "Pigskinonator", "start em sit em". Do NOT trigger for general NFL news, real-life sports questions, or basketball/baseball/hockey.
---

# Fantasy Football Recommendations

Pull fantasy football player recommendations from `football.razzball.com`,
`www.fftoday.com`, and (optionally) `api.fantasypros.com` and ESPN. Render
results as a markdown ranking table in chat AND (default) save a dated file
to `data/recommendations/`.

## When to use this skill

- The user asks for rankings, projections, start/sit, waiver, ADP, auction,
  sleepers, busts, buy-low, sell-high, DFS, or "who should I pick".
- The user mentions a specific source by name: Razzball, Pigskinonator,
  FFToday, FantasyPros.
- The user says "fantasy football" followed by any of: this week, next
  week, week N, draft, preseason, playoffs, dynasty, ROS.

Do NOT use for: real NFL news (use `news` skill if available), non-football
fantasy sports, betting odds, general sports chat.

## Source cookbook

All public URLs are server-rendered HTML — `webfetch` returns them as
markdown tables that you can pass through directly. No login is required
for the free tier.

### Razzball (free tier)

| Query | URL |
|---|---|
| Pre-season / ROS projections, QB | `https://football.razzball.com/projections-qb-restofseason/` |
| Pre-season / ROS projections, RB | `https://football.razzball.com/projections-rb-restofseason/` |
| Pre-season / ROS projections, WR | `https://football.razzball.com/projections-wr-restofseason/` |
| Pre-season / ROS projections, TE | `https://football.razzball.com/projections-te-restofseason/` |
| Pre-season / ROS projections, K | `https://football.razzball.com/projections-pk-restofseason/` |
| Pre-season / ROS projections, DST | `https://football.razzball.com/projections-teamdefense-restofseason/` |
| Pre-season / ROS projections, IDP | `https://football.razzball.com/projections-idp-restofseason/` |
| Weekly rankings, RB PPR | `https://football.razzball.com/weekly-rankings-rb-ppr/` |
| Weekly rankings, WR PPR | `https://football.razzball.com/weekly-rankings-wr-ppr/` |
| Weekly rankings, TE PPR | `https://football.razzball.com/weekly-rankings-te-ppr/` |
| Weekly rankings, QB | `https://football.razzball.com/weekly-rankings-qb/` |
| Weekly rankings, DST | `https://football.razzball.com/weekly-rankings-teamdefense/` |
| Positional rankings (pre-season), QB | `https://football.razzball.com/2025-fantasy-football-quarterback-rankings/` |
| Positional rankings (pre-season), RB | `https://football.razzball.com/2025-fantasy-football-running-back-rankings/` |
| Positional rankings (pre-season), WR | `https://football.razzball.com/2025-fantasy-football-wide-receiver-rankings/` |
| Positional rankings (pre-season), TE | `https://football.razzball.com/2025-fantasy-football-tight-end-rankings/` |
| Dynasty rankings | `https://football.razzball.com/dynasty-fantasy-football-rankings/` |
| Rookie dynasty rankings | `https://football.razzball.com/dynasty-rookie-rankings-for-2024-fantasy-football-leagues/` |

### Razzball premium (requires login, see "Optional login" below)

| Query | URL |
|---|---|
| Weekly projections, QB | `https://football.razzball.com/pigskinonator-qb/` |
| Weekly projections, RB | `https://football.razzball.com/pigskinonator-rb/` |
| Weekly projections, WR | `https://football.razzball.com/pigskinonator-wr/` |
| Weekly projections, TE | `https://football.razzball.com/pigskinonator-te/` |
| Weekly projections, K | `https://football.razzball.com/pigskinonator-k/` |
| Weekly projections, DST | `https://football.razzball.com/pigskinonator-def/` |
| Weekly projections, IDP | `https://football.razzball.com/pigskinonator-idp/` |
| Next-week projections | `https://football.razzball.com/pigskinonatornextweek/` |
| DFS DraftKings | `https://football.razzball.com/dfsbot-draftkings/` |
| DFS FanDuel | `https://football.razzball.com/dfsbot-fanduel/` |
| DFS Yahoo | `https://football.razzball.com/dfsbot-yahoo/` |

### FFToday (free, no login)

Positional `PosID` codes: 10=QB, 20=RB, 30=WR, 40=TE, 50=DL, 60=LB, 70=DB,
80=K, 99=DST.

| Query | URL pattern |
|---|---|
| Pre-season projections | `https://www.fftoday.com/playerproj.php?PosID={10\|20\|30\|40\|80\|99}` |
| Pre-season rankings | `https://www.fftoday.com/playerrank.php?o=1&PosID={posid}` |
| Pre-season rankings + outlooks | `https://www.fftoday.com/playerrank.php?o=2&PosID={posid}` |
| Weekly rankings | `https://www.fftoday.com/playerwkrank.php?PosID={posid}&Season={season}&GameWeek={N}` |
| Weekly projections | `https://www.fftoday.com/playerwkproj.php?Season={season}&GameWeek={N}&PosID={posid}` |
| Rest of week | `https://www.fftoday.com/rotw.php?o=1&PosID={posid}` |
| ADP PPR | `https://www.fftoday.com/26-adp-ppr.html` |
| ADP Half-PPR | `https://www.fftoday.com/26-adp-half-ppr.html` |
| ADP Non-PPR | `https://www.fftoday.com/26-adp-standard.html` |
| Dynasty rankings | `https://www.fftoday.com/dynasty.php?o=1&PosID={posid}` |
| Rookie rankings | `https://www.fftoday.com/rookie.php` |

### ESPN (public, no cookies)

| Query | URL |
|---|---|
| Weekly projections, current week | `https://site.web.api.espn.com/apis/site/v3/sports/football/nfl/projections?seasontype=1&season={year}&week={N}` |

### FantasyPros (requires `FANTASYPROS_API_KEY` env var, see "Optional login")

The FantasyPros public API requires a paid key. If the key is absent, say
so and fall back to Razzball/FFToday consensus. If present, the API base is
`https://api.fantasypros.com/v2/json/nfl/{season}/consensus-rankings` —
sign up at `https://www.fantasypros.com/api-data/` for the key.

## How to fetch and format

1. **Pick the URL(s).** Use the cookbook above. For broad queries ("who
   should I start at RB this week"), default to Razzball weekly rankings +
   FFToday weekly rankings and present both side-by-side.

2. **Check the cache first.** Before calling `webfetch`, check
   `data/recommendations/cache/` for a file matching the URL + a mtime
   less than 1 hour old. If present, read the cached markdown and skip the
   fetch. Cache files are named `cache-{sha1(url)}.md` with a sidecar
   `cache-{sha1(url)}.json` containing `{"url": "...", "fetched_at": "..."}`.
   The CLI helper `npm run pmt -- projections <source> <position> [--week N]`
   handles caching automatically.

3. **Fetch.** Use `webfetch` with the URL. Razzball and FFToday both return
   clean markdown tables — pass the rendered markdown straight through.

4. **Parse (only when feeding the TypeScript pipeline).** If the user asks
   you to seed the local SQLite store (`npm run pmt -- import-espn` or
   `pmt refresh` with `PMT_PROJECTION_SOURCES=razzball,fftoday,espn`), the
   `RazzballProjectionSource` and `FFTodayProjectionSource` classes under
   `src/projections/` parse the rendered markdown into `ProjectionCandidate[]`.
   You do not need to invoke them yourself in chat mode.

5. **Render the table.** Present the top N rows as a markdown table. Always
   include: rank, player, team, position, projection/ranking, and the source.
   For projections, show `Floor / Projection / Ceiling` if Razzball provides
   them.

6. **Cite the source.** Always include the URL under the table.

7. **Cross-source consensus.** If the user asks "consensus" or asks for
   multiple sources, fetch 2-3 and align by player name. Highlight where
   sources disagree (delta > 15%).

## Output mode

Default: **save + chat summary**.

- Save the full markdown table to `data/recommendations/{YYYY-MM-DD}-{source}-{query}.md`.
  The date is today in the user's local timezone. Example:
  `data/recommendations/2026-08-02-razzball-rb-ros.md`.
- The file header is:

  ```markdown
  ---
  source: razzball
  query: rest-of-season rb projections
  url: https://football.razzball.com/projections-rb-restofseason/
  fetched_at: 2026-08-02T15:42:00Z
  cached: false
  ---

  # Razzball ROS RB Projections (2026)

  (markdown table)
  ```

- In chat, show the table directly plus the saved file path.

To switch to **chat-only** mode (no file write), the user can prefix with
`/tmp` or say "don't save" or "just chat". In that case, still cache to
`data/recommendations/cache/` so repeat queries are fast.

## Optional login (Razzball premium)

If `RAZZBALL_USERNAME` and `RAZZBALL_PASSWORD` are present in `.env`, run:

```bash
npm run pmt -- razzball-login
```

This stores a session cookie at `data/razzball-cookies.json`. Subsequent
`webfetch` calls to Razzball premium pages must include
`Cookie: $(cat data/razzball-cookies.json | jq -r '.cookies' | ...)` via
`opencode`'s `MCP` or `provider` HTTP fetch config — or, more simply, use
the CLI helper:

```bash
npm run pmt -- projections razzball-premium rb --week 1
```

which uses Node's built-in `fetch` with the saved cookies. The CLI also
writes the result to `data/recommendations/`.

If the login fails, surface the error and fall back to the free tier —
never abort the request.

For FantasyPros, set `FANTASYPROS_API_KEY` in `.env` and the CLI
automatically adds it as a `Bearer` header.

## Edge cases

- **Offseason.** Razzball still serves 2026 projections in July; FFToday
  serves pre-season. If both are empty (404 / "no rows"), say so and offer
  dynasty rankings as a fallback.
- **Position aliases.** `RB` and `rb` are equivalent. `DST` == `DEF` ==
  `teamdefense`. `PK` == `K`. Normalize before matching.
- **Player name collisions.** When merging two sources, prefer the more
  recent timestamp. Tie-break by team abbreviation.
- **Rate limits.** Cache for 1 hour by default. If a fetch fails with 429,
  wait 60s and retry once; if still failing, surface to the user.
- **Disagreement.** Always show both sources side-by-side when there is
  more than 15% delta on a player's projection. Never silently pick one.
- **Premium gates.** If a Razzball premium URL returns a login wall, do
  not surface the error to the user — silently fall back to the
  equivalent free page (pigskinonator → projections-{pos}-restofseason,
  dfsbot → weekly-rankings-{pos}).
- **The skill does NOT make roster moves.** It only fetches and renders.
  Any actual lineup/trade/waiver moves go through `FF_Orchestrator` via
  the existing `pmt ff-run` / `pmt import-espn` commands, gated by the
  human-approval action queue.

## Companion TS pipeline (for power users)

The TypeScript projection sources ship with the repo:

- `src/projections/razzball-projection-source.ts`
- `src/projections/fftoday-projection-source.ts`

Both implement `ProjectionSource` and feed `DefaultProjectionEngine` for
consensus. To opt in:

```bash
PMT_PROJECTION_SOURCES=razzball,fftoday npm run pmt -- import-espn <leagueId>
PMT_PROJECTION_SOURCES=razzball,fftoday,espn npm run refresh
```

When `PMT_PROJECTION_SOURCES` is unset, only ESPN is registered — keeping
the existing test suite deterministic.

## Cache maintenance

- Cache TTL: 1 hour (configurable via `PMT_CACHE_TTL_MS`).
- Cache directory: `data/recommendations/cache/`.
- Manual eviction: `npm run pmt -- projections --clear-cache`.
- Cache misses are silent; cache hits should print "served from cache" in
  the CLI but never in chat.

## Verification checklist before responding

- [ ] URL came from the cookbook above (or was explicit in the user's prompt).
- [ ] Cache was checked before fetching.
- [ ] Output table is sorted by rank or projected points.
- [ ] Source URL is cited under the table.
- [ ] Saved file path is reported in chat when save-mode is active.
- [ ] For consensus queries, disagreements > 15% are flagged.
- [ ] Premium-only URLs silently fell back when no auth was present.

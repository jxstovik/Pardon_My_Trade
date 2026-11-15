# Banging 3s: verified league evidence

Observed 2026-10-25. League `mmioj1mvmvgsc3io`. This is a field-level transcription of browser-rendered official JSON, not a saved complete raw API response. Recheck before recommendations. Public HTTP clients in this environment received HTTP 403; the Codex browser could read the endpoints.

## Sources and verified facts

- [Fantrax developer documentation, v1.8 Beta](https://www.fantrax.com/developer): documented read endpoints and meanings of scoringSystem, rosterPeriods, scoringPeriods, rosters, draftState and playoffs.
- [League information](https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=mmioj1mvmvgsc3io&excludePlayerInfo=true): name **Banging 3s**, seasonYear **2026**, snake draft, eight teams, `HEAD_TO_HEAD_ROTI_MULTI_WIN` (one W/L/T per category).
- Eight equal-weight categories: `PTS`, `REB`, `AST`, `ST`, `BLK`, `3PTM`, `FG%`, `FT%`. Turnovers are absent. The `1.0` weights do not make this a fantasy-points sum.
- Roster maxima: 14 total, 10 active, 4 reserve; positionConstraints 4 `G`, 4 `F/C`, 2 `Flx`. These maxima are not evidence of minimum starter requirements or a per-player game cap.
- Player pool: all teams; no duplicate players. Full league information provides Fantrax player IDs, eligible positions and status, but does not provide player names in the observed playerInfo rows.
- [Period-one rosters](https://www.fantrax.com/fxea/general/getTeamRosters?leagueId=mmioj1mvmvgsc3io&period=1): all eight teams returned an empty `rosterItems` array. Do not rank or recommend pickups from an empty roster.
- [Draft results](https://www.fantrax.com/fxea/general/getDraftResults?leagueId=mmioj1mvmvgsc3io): `draftState: running`, snake, 112 pick entries (14 rounds x 8 teams), no player selections visible. This does not prove a completed draft, a currently active clock, or the user's next pick. Order: NorseUppers, CatsByAtLeast1, JakeMess, Perks, Connormcl12, Sjdedden, JeffWischer, jxstovik. If order remains final, jxstovik is eighth in the snake.
- [Standings](https://www.fantrax.com/fxea/general/getStandings?leagueId=mmioj1mvmvgsc3io): every team has 0-0-0. Preseason displayed rank is not a performance assessment.
- Team **jxstovik**, ID `wwc1n3o4mvn1c6hk`, confirmed by the user in this conversation. User chose **Balanced** as the initial strategy; pivots remain available.

## Calendar and playoffs

The API returns 19 explicit roster periods and the same 19 scoring periods. Use their offsets and exact timestamps; do not calculate NFL weeks or assume a fixed Monday hour. Period boundaries are not proven lineup-lock deadlines.

- P1 starts `2026-11-01T09:30:00.0-0500`, ends `2026-11-09T10:59:59.0-0500`.
- P2 starts Nov 9 11:00 ET; P3 Nov 16 11:00; P4 Nov 23 11:00; P5 Nov 30 12:00.
- P6 Dec 7 11:00; P7 Dec 14 11:00; P8 Dec 21 11:00; P9 Dec 28 12:00.
- P10 Jan 4 13:00 ET; P11 Jan 11 13:00; P12 Jan 18 13:00; P13 Jan 25 13:00; P14 Feb 1 13:00; P15 Feb 8 13:00; P16 Feb 15 13:00; P17 Feb 22 13:00.
- Four playoff teams, last regular period 17, first playoff period 18. P18 starts `2027-03-01T13:00:00.0-0500`; P19 starts `2027-03-08T12:00:00.0-0500`, ends `2027-03-15T11:59:59.0-0400`. Playoff periods are not merged.
- Top-level startDate is Nov 1; endDate is March 14, whereas the final period extends into March 15. Preserve this discrepancy and inspect UI semantics; do not silently replace the period endpoint.
- P1 opponent for jxstovik is JeffWischer (`rlfm3uhjmvk7q70x`); P2 CatsByAtLeast1 (`2rc1dg43mvgsurtp`).

## Still requires signed-in rules evidence

Exact lock policy and offset, whether lineup changes are permitted within each roster period, minimum active slots/games/shot attempts, games caps and cap accounting, waivers/FAAB/budget/deadlines, acquisition and trade limits, injury slots, eligibility changes, playoff qualification/tiebreaks and 4-4 playoff treatment, draft clock/status, and explicit sport/gender/competition/season identity. The user describes a college basketball league; the API subset above does not expose a sport/gender field.

The home link redirected to login. The user will sign in when available. No password, cookie, token or secret is stored in this document. No live league change has been made.

## Additional verified rules summary (public browser access succeeded)

[Exact league rules summary](https://www.fantrax.com/newui/fantasy/leagueRulesSummary.go?leagueId=mmioj1mvmvgsc3io) was rendered in the Codex browser on 2026-10-25. It identifies **2026-27 Banging 3s**. This supersedes the unknowns above only for explicitly listed fields; omitted settings remain unverified.

- Lineups: managers enter changes; **executed weekly every Monday**; lock offset **0:00 before scheduled game start**. The combination does not yet prove per-player versus all-roster lock scope, effective activation semantics, or league IANA timezone. No daily streaming lineup assumption.
- Total/active roster minimum 0, per-slot active minimum0; total maximum14, active10, reserve4; IR and minors not used. Illegal-roster transactions prevented **Always**. IR enforcement none.
- Claims: unlimited per week and per season. Free agents first come, first served. Waiver wire used, **Automated Priority Order**, priority rotates after each claim; players remain on waivers **2 days**, minimum23+hour waiver period enforced. New pool entrants do not bypass waivers. Anti-churning enabled. No FAAB system is shown; this is priority, not budget bidding.
- Claims/drops before draft: **No**; drops during draft: **No**. No platform can't-drop list, but PMT protected-player policy remains separate. Pending/failed claims visible only to own team. Undrafted players go to waivers, so immediate post-draft FA pickup assumptions are wrong.
- Trades: manager proposed, all year, unlimited, no trade deadline; manager voting **2 days**, **4 objections** required. Trading claim budget/salary space/draft picks disallowed. Proposed availability must account for review delay.
- Draft: live online standard, **14 rounds**, manual snake order as above, **1 minute per pick**, immediately picks for absent managers, legal roster filling enforced. No draft date/time rendered, so still unresolved; do not infer current on-clock from public shell rows.
- Playoffs: start P18 (March1–7), last2 periods;4 qualify; **no reseeding**. **Highest seed wins playoff ties**. Standings ties: head-to-head record against all tied teams, then most season wins, then random. Regular matchup tiebreakers None/None/None. The actual category equality/percentage rounding and displayed W/L/T accounting still require validation.
- Stat corrections: applied only within **168hours after game end**; subsequent official corrections do not change league scores/standings. Model outcomes should distinguish official statistical truth from Fantrax frozen fantasy outcomes.
- Accumulation dates explicitly Nov1,2026 through **March14,2027**, even though final imported period ends March15. Treat March15 as administrative period boundary, not automatically an additional counted game date.
- Players traded out of the league's pool continue accumulating stats: Yes. Player pool all teams.
- No prizes configured (or not used). No cap/minimum shot-attempt or game-count rule is displayed, which is not sufficient evidence that no cap/minimum exists.

Remaining crucial unknowns: explicit sport/gender and school/competition scope, slot lock scope, timezone/effective activation, exact draft start/current clock, real roster/player identities, minimum attempts/game-cap semantics, current waiver priority and processing instants. User login remains useful for personalized state, but is no longer required for reading this rules summary.

## Authenticated league and draft readiness

Observed by the lead agent in the user's authenticated Codex browser at **2026-10-25T13:40:00Z**. This is a field-level UI transcription; it does not include session material or a complete raw response.

- [League home](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/home) displays the header **2026-27 NCAAB Banging 3s**. The NCAAB league identity is now positively observed. Actual athlete gender, precise eligible competition/school coverage and a prospective source's pool coverage still need verification before choosing or activating data feeds.
- The authenticated home explicitly states: **“Draft has not yet taken place. The date has not yet been set.”** The current state is therefore **pre-draft, date unset**. This supersedes the earlier uncertainty about whether the API's `running` shell represents an actual live clock. Preserve that earlier API observation as historical evidence, but do not treat it as a current active draft or a completed draft.
- The authenticated view for the user's **jxstovik** team shows **Active 0/10** and **Reserve 0/4**, consistent with the undrafted state. There are no drafted players from which to produce a personal lineup or pickup recommendation.
- The authenticated [modern rules page](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/rules) corroborates the exact public rules summary recorded above. No additional lock-scope, timezone, game/attempt-cap, player-identity or source-coverage inference follows from that corroboration.

The next draft task is to monitor for a date being set and prepare the scoring-specific framework. A named player board still requires verified player identities, pool scope, lawful source coverage and projections. No league change was submitted during this inspection.

## Pre-report refresh and per-position limits (18:18 UTC)

On 2026-10-25 around 18:18 UTC, the authenticated home was re-read and still explicitly said the draft had not yet taken place and its date was not set. The own roster still showed Active0/10 and Reserve0/4, and a fresh documented period-one roster API read again returned all eight empty roster arrays. A fresh draft API read still returned snake order,112 entries,zero selected playerIds and `running`. The explicit home statement governs readiness; the API status remains ambiguous rather than an active-clock signal. Config/capture observation times were updated only for these resources actually re-read; league-info and rules retain their earlier timestamps.

The roster's [Min/Max view](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/team/roster;view=GAMES_PER_POS) displayed **Games Played Per Position**: Guard GP0/MINNo min/MAXNo max; Forward/Center GP0/MINNo min/MAXNo max; Flex GP0/MINNo min/MAXNo max. These are positive per-position observations. Team-wide/per-player rules, selected-game semantics and shooting minimums still need independent verification; do not generalize this into unlimited counted games.

## October 26 scheduled-run refresh and official export

The morning home read still said date unset. Re-reading authenticated [home](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/home) and [rules](https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/rules) around **19:39 UTC** revealed a material change: **draft not held; Wednesday October 28, 2026, 9:00 PM EDT** (`2026-10-29T01:00:00Z`). Rules corroborate 14 rounds, live online standard, manual snake/serpentine, one minute per pick, immediate autopick for absent managers and legal roster filling. Current order: CatsByAtLeast1, NorseUppers, JeffWischer, JakeMess, Perks, **jxstovik**, Connormcl12, Sjdedden. Own slot is **sixth**, superseding the historical eighth-slot assumption. If unchanged, overall picks are 6, 11, 22, 27, 38, 43, 54, 59, 70, 75, 86, 91, 102, 107 (arithmetic from the displayed order, not an observed pick log).

The own roster UI still shows Active 0/10 and Reserve 0/4. The eight categories, Monday cadence, roster limits, waiver/trade rules and playoff/tie settings shown on the rules page agree with the prior recorded settings. The lock/activation/minimum/rounding gaps remain. These are fresh UI transcriptions, not raw API responses. League-info, all-team roster API and draft-shell API were **not refreshed**; their October 25 timestamps remain unchanged and the doctor labels them stale.

At **2026-10-26T19:29:41.573603+00:00**, the authenticated Players view's official CSV download produced **5,689 unique named IDs**, 5,678 FA and 11 waiver rows. Selected filters: **All Available Players**, **2025-26 Reg Season - YTD**, **Tracked (Per-Game)**. Original 606,921 bytes are retained privately in `data/basketball/mmioj1mvmvgsc3io/exports/2026-10-26/` and immutable `player-pools/`. SHA-256: `b5f622b956838a2628b8db6f19724719587e93437ca5edc76314eb72dcdc91ec`. Unlike the earlier API transcriptions, this hash covers the original official export bytes. See [audit](../../artifacts/basketball/2026-10-26/player-pool-audit.md) and [summary](../../artifacts/basketball/2026-10-26/player-pool-summary.json).

The export contains 3,159 rows with some nonzero displayed history; zero rows remain ambiguous. GP, minutes, FGM/FGA/FTM/FTA are absent. 38 rostered percentages and 5,272 ADP values are unavailable; unknowns remain null. Current school labels do not prove historical school stints. This all-available export does not prove complete owned/ineligible coverage. Waiver weekdays are not processing instants. Rank/score/ADP are provider fields, not our recommendations. No current-season forecast, probability or player ranking was created.

The legitimate UI export succeeds despite a download-event timeout; ordinary HTTP access remains unverified after prior 403s. A hidden desktop-only control stalled a browser call, extending this run substantially; this is further evidence that unattended acquisition/latency is not validated. Temporary viewport changes are reset after acquisition.

## October 27: draft unchanged; Standard history and raw schedule

Fresh authenticated home at **08:08:48.716 UTC** still shows draft not held, scheduled October 28 at 21:00 EDT. Rules were re-read during the **07:57:19–08:00:08 UTC** observation window and retain snake slot six, 14 rounds, one minute per pick, immediate absent-manager autopicks and all previously known scoring/roster/transaction/playoff settings. The configuration's rules timestamp uses the conservative window start, not an invented exact read time. Own roster at **08:08:11.034 UTC** remains period one, Active 0/10 and Reserve 0/4. See [UI transcription](../../artifacts/basketball/2026-10-27/ui-observations.json). API league-info, all-team rosters and draft-shell sources were not refreshed; doctor keeps their October 25 observations stale.

The official **Standard** CSV, downloaded at **08:00:08.452079 UTC**, contains **5,687 unique available IDs**, with GP, MIN, FGM/FGA, FTM/FTA and TO in addition to the tracked categories. GP is a season count; Standard's other counts are rounded per-game values. Raw SHA-256 `71e31bdff0b388fded25d9abd8781e8a3097f277a867016a16ecb554e949912f` (see the machine summary for the authoritative exact hash). **3,218** rows have positive GP, **2,469** have unresolved zero-GP coverage. Two rows fall outside the explicit nearest-tenth points-coherence envelope and remain quarantined: Vinny Sigona (064uk, residual −0.300) and Anakin Brown (06qfh, +0.700). No source values were repaired. The remaining **3,216** pass this bounded screen, not a validated forecast or current-role gate. [Audit](../../artifacts/basketball/2026-10-27/history-audit.md), [summary](../../artifacts/basketball/2026-10-27/history-summary.json), [Luna review](committee/08-luna-history-review.md).

The available-export membership changed: Pablo Tamba, Marquel Sutton, RJ Luis and Mantas Rubstavicius are absent from today's export; Tae Davis and Charles Johnston newly appear. All shared named IDs retain identical tracked historical stat fields. The cause is unknown; this is **not** evidence of draft picks or a transaction. [Exact diff](../../artifacts/basketball/2026-10-27/available-pool-diff.json). The old pool snapshot remains intact and is not relabeled fresh.

The Schedule view exports 5,687 rows for displayed November 1–8 dates. Original bytes are archived privately with SHA-256 `dd644c8486abfeb4ac264fa3577447be476107b06c5392debde1399e1e3fa7dd`. The CSV has month/day headers and textual game labels but no verified year/timezone or game IDs. Rivera-Torres has a game under Sun 11/1 labeled Mon 12:00AM. Blank cells and midnight labels require reconciliation, not inferred no-game/UTC assignments. No counted starts or lineup locks were derived. [Schedule metadata](../../artifacts/basketball/2026-10-27/schedule-summary.json). The Stats selector exposed season YTD/period/dates/history choices and no projection option; this does not prove that no other Fantrax projection product exists.

A [current official Vanderbilt profile](https://vucommodores.com/sports/mbball/roster/player/tyler-tanner) names Tyler Tanner as a junior on the 2026–27 men's basketball roster, matching Fantrax 06n46 / Vand / Jr. This supports one manually verified men's identity match, not full league/provider coverage or injury clearance. Its 2025–26 bio totals (702 points, 19.5 PPG) differ from the Fantrax regular-season export (649 points, 19.1 PPG, 34 GP). Scope must reconcile before joining those statistics; no reason for the difference is assumed. [Identity sample](../../artifacts/basketball/2026-10-27/identity-sample.json). The October 26 watch-list article failed to open; no current availability or role claim comes from its search snippet.

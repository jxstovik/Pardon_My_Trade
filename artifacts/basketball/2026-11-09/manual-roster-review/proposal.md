# Manual roster and availability review — November 9, 2026

League mmioj1mvmvgsc3io; team wwc1n3o4mvn1c6hk, Board Man Gets pAId. Period 2, November 9–15, against CatsByAtLeast1. Authenticated Fantrax browser reads completed approximately 15:50–16:10 UTC (10:50–11:10 EST); retrieval window, not article publication times. No platform writes, pending claims, model promotion or settings changes were made.

## Availability and role findings

- Javontae Campbell, Cincinnati (06n8t): current player-card injury report says expected return November 9, **game-time decision**. Latest article remains November 2, 9:12 PM EST, foot-related DNP. Zero games played. Hold on reserve; do not equate an expected-return date with clearance.
- Jack Karasinski, Northwestern (065mj): current player-card injury report also says November 9 **game-time decision**. November 6, 7:08 PM EST article reports concussion and absence against Stony Brook. Hold on reserve unless actual clearance is confirmed; one-game 24-point/seven-three performance is not a stable forecast.
- Cade Tyson (064gk): Fantrax November 6 says season ineligible after appellate decision. Independent November 6 Pioneer Press reporting also says currently ineligible, with possible further legal avenues. Treat as unavailable now, rather than certainty that no future ruling is possible. Primary drop candidate in this no-IR league.
- Quion Williams (064kr): Fantrax school N/A, zero GP and no listed games. RealGM and Zerozero list matching former Oklahoma State/Abilene Christian/Arkansas-Pine Bluff player with KK Sloga in 2026–27. External roster evidence, not an official NCAA eligibility declaration. Bench and prioritize replacement; do not project Arkansas-Pine Bluff's schedule onto him.
- Jalen Cox, USC (06h14): two appearances, zero starts, 6.5 minutes per game. Actual minutes were 10 on November 2 and three on November 8. Current role contradicts the historical Colgate production used in the old board; third replacement priority.
- Michael James, **Alabama State** (0729c; ASU): verified school identity, one start/36 minutes, 16 points at Texas A&M. Three listed games this week, two unknown opponents. Counted eligibility of those two remains unverified. Not Arizona State.

## Available shortlist

All four were observed as Claim/FA in the authenticated All Available Players view. These are early-season **actual averages**, not projections. Provider Score was used for discovery only; it is not our eight-category objective. Expanded UI to 500 rows per page, but did not validate every candidate or claim exhaustive model-ranked coverage. Four player cards were inspected for stable IDs, starts, minutes, shooting volume and upcoming games.

| Priority | Player / Fantrax ID | Pos | GP / starts / MPG | PTS / REB / AST / ST / BLK / 3PTM | FG / FT | This week's listed games |
|---|---|---|---|---|---|---|
| 1 | Keshawn Fisher / 071jm, Winthrop | G, F/C | 2 / 2 / 30.0 | 23.5 / 5.5 / 2.0 / 2.5 / 2.0 / 3.5 | .680 / .750 | Nov 10 at Kennesaw State; Nov 14 Jackson State |
| 2 | Max Weisbrod / 06nff, Northern Illinois | G | 3 / 3 / 32.7 | 16.7 / 3.7 / 8.0 / 1.3 / 0.0 / 4.0 | .483 / .714 | Nov 11 unknown; Nov 14 at Bellarmine |
| 3 | Jayden Reid / 06dsp, Memphis | G | 2 / 2 / 31.5 | 29.0 / 1.0 / 4.0 / 2.5 / 0.0 / 2.5 | .531 / .826 | Nov 10 at Vanderbilt; Nov 15 Louisville |
| Alternate | Caleb Sanders / 070mu, Tennessee Tech | F/C | 3 / 3 / 28.7 | 18.7 / 7.3 / 2.7 / 1.0 / 1.0 / 1.0 | .514 / .773 | Nov 12 at Indiana; Nov 15 unknown |

Fisher supplies multi-category production and dual eligibility, addressing frontcourt depth without abandoning balance. Weisbrod's eight assists in each of three games and 31–36 minutes are useful role evidence; regress his .545 three-point shooting. Reid's 26 and 32 points came against Iowa State and VCU; official Memphis/VCU recaps corroborate the latter game. Do not extrapolate 29 PPG or Fisher's .680 FG unchanged. Sanders is the frontcourt alternative if Fisher disappears or a stronger rebound emphasis is desired.

## Exact proposed roster changes — not submitted

1. Add Keshawn Fisher (071jm), drop Cade Tyson (064gk).
2. Add Max Weisbrod (06nff), drop Quion Williams (064kr).
3. Add Jayden Reid (06dsp), drop Jalen Cox (06h14).

These are recommendations based on current availability, roles and category fit, not a promoted model or proven global optimum. Each acquisition must be rechecked for availability and actual FA/waiver processing. A Claim button plus FA label does not prove immediate activation. Do not drop someone first and assume the add will succeed. Exact human approval and a separately validated execution/readback are required before claims/drops.

## Proposed legal lineup after successful additions

- G: Markus Burton, Tavari Johnson, Max Weisbrod, Jayden Reid.
- F/C: Keyshawn Hall, Pryce Sandfort, Kyle Evans, Keshawn Fisher.
- Flex: Daeshun Ruffin, Jaiden Feroah.
- Reserves: Javontae Campbell, Jack Karasinski, Michael James, Trevan Leonhardt.

Feroah is the conservative Flex choice for rebounds/blocks and two named opponents. If James's two N/A games are confirmed counted and his role holds, use **James instead of Feroah** for the three-game scoring/three-point/FT-volume case. No invented category-win probability. If Campbell clears before a valid lock, reevaluate him against the Flex choices; no automatic switch based on an expected-return label.

Without acquisitions, recommended available-player arrangement is G Burton/Johnson/Ruffin/James; F/C Hall/Sandfort/Evans/Feroah; Flex Leonhardt/Cox; reserve Campbell/Karasinski/Tyson/Quion. This is a risk-aware fallback, not endorsement of Cox's current role. Quion's visible Flex button was disabled in the refreshed UI, so do not claim this fallback can be submitted without checking that concrete blocker.

The prior reply's “complete lineup” meant 10 occupied active slots, not ten verified contributing players. The current lineup still starts Campbell, Cox and Quion; it is not optimized. No lineup was changed during this review.

### Reproducible lineup sensitivity

`lineup-sensitivity.mjs` runs the existing exact 4G/4F-C/2Flex optimizer against the frozen board's category normalizations, using newly observed actual-season lines. Build passed before importing compiled output. `lineup-sensitivity.json` preserves inputs, exclusions and four results. This is an actual-rate sensitivity, not a forecast or model promotion; some season shooting/count totals are reconciled from rounded YTD displays.

After the three hypothetical additions, the **named-opponents-only** scenario selects the same ten players as the proposed conservative lineup (slot assignment can differ because Fisher is dual eligible). With every listed N/A game counted, it replaces Burton with James. Thus that last choice depends materially on James's two unresolved games; keep Burton in the conservative proposal. Both scenarios select Fisher, Weisbrod and Reid. The no-acquisition scenario has only ten usable players after conservative GTD/ineligibility exclusions and mechanically includes low-role Cox; this does not make Cox valuable. No calibration, strategy benefit or win probability is claimed.

## Timing and limits

Burton's verified tip is November 9 at 6:30 PM EST. Whole-roster versus player-level weekly lock and new-acquisition activation remain unresolved. Prepare before that game, but do not represent it as a verified universal deadline. These recommendations can guide roster repair even if current-week activation is unavailable. Approved baseline remains October 27; this review uses fresh status/role evidence and small actual-stat samples, not a new trained forecast. No tests were required: evidence/report only, no code change.

## Sources

- Authenticated league home and current roster: https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/home and https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/team/roster;teamId=wwc1n3o4mvn1c6hk
- Available pool and player cards: https://www.fantrax.com/fantasy/league/mmioj1mvmvgsc3io/players (exact player IDs above; player card URLs follow the observed Fantrax player links).
- Memphis official November 7 recap: https://gotigersgo.com/news/2026/11/7/mens-basketball-memphis-rallies-behind-reids-career-night-for-home-opening-thriller-over-vcu
- VCU official November 7 recap: https://vcuathletics.com/news/2026/11/7/mens-basketball-reid-memphis-clip-rams-in-final-seconds-89-88.aspx
- Tyson November 6 Pioneer Press report: https://staging-aws.sports.yahoo.com/articles/court-ruling-leaves-gophers-wing-172600283.html
- Quion professional roster: https://basketball.realgm.com/international/league/13/Serbian-KLS/team/705/KK-Sloga/rosters and https://www.zerozero.pt/jogador/quion-williams/3561339
- Additional status corroboration: https://www.actionnetwork.com/ncaab-game/minnesota-cincinnati-score-odds-november-9-2026/297667 and https://www.covers.com/sport/basketball/ncaab/matchup/390832 . These report questionable, not clearance.

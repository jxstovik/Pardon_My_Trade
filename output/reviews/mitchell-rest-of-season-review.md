# Mitchell replacement decision — October 14, 2026

**Executed: add Pat Freiermuth (4361411), drop Adonai Mitchell (4597500), league 98806880 / team 7.** ESPN execution receipt and an independent fresh roster read confirmed Freiermuth on the bench and Mitchell absent. Action: `act-1792019193280-zb8269`; confirmed 2026-10-14T23:06:48.118Z. Nine starters and the one-defense roster construction were preserved.

The user explicitly delegated execution if the replacement provided longer-term value. The assessment treats long-term as rest of the 2026 season: captured league settings show zero keepers and zero IR slots. No production model or experimental calibration was promoted.

## Why Freiermuth

- You previously had one TE, George Kittle. San Francisco's Week 8 bye leaves a known TE coverage need; Pittsburgh plays in Week 8 and has its bye in Week 9.
- Freiermuth has 26 targets across five games, with 4–7 targets every week, 19 catches and 169 receiving yards. His four touchdowns are a regression risk, rather than a pace to extrapolate.
- The current candidate model gives Freiermuth a Week 6 active-state mean of **9.94 PPR points**, with a 10th–90th percentile band of **3.01–18.68**. This is a weekly model output, not a rest-of-season forecast.
- Mitchell's mean is **9.39 conditional on playing** (2.09–19.78 band). He remains doubtful on ESPN and week-to-week after a hand procedure. That conditional mean is not an availability-adjusted expectation.
- Mitchell's 12-target Week 2 shows real healthy upside. The replacement is a roster-fit and availability judgment, not a claim that Mitchell has lost his role permanently.

[Jets injury update](https://www.newyorkjets.com/news/adonai-mitchell-week-to-week-after-hand-procedure-jets-injury-updates-10-14-2026). [Steelers official Freiermuth game log](https://www.steelers.com/team/players-roster/pat-freiermuth/logs/). Usage and bye data were independently checked in the NFLverse 2026 weekly stats and schedule files; current league/ownership/status were read from authenticated ESPN.

## Alternatives considered

| Player | Week 6 model mean | Rest-of-season tradeoff |
|---|---:|---|
| Darren Waller | 11.03 | Higher conditional weekly mean, but currently questionable and dealing with a toe injury; less reliable availability hedge. |
| Jake Ferguson | 9.58 | Also fills TE depth; lower recent receiving production and model mean than Freiermuth. |
| Blake Corum | 8.79 | RB upside, but recent rushing workload fell to five carries in Weeks 4–5; you already carry six RBs. |
| Courtland Sutton | 7.86 | Five targets per game and only 104 receiving yards through five games; less compelling than addressing TE depth. |
| Chris Godwin Jr. | 8.69 | Usable WR depth, but adds another player at a position with five remaining rostered options. |

[Waller toe-injury report](https://www.rotowire.com/football/headlines/darren-waller-injury-tending-to-toe-injury-642426). Model intervals remain candidates and have known calibration limitations. No formal calibrated rest-of-season superiority probability was computed or claimed.

## Execution controls

PMT verified ownership, immediate FREEAGENT status, the unlocked drop player, configured league/team, current scoring period and roster fingerprint. One exact high-risk action was queued, previewed, approved under the user's conditional delegation, executed with a durable idempotent receipt, and checked independently afterward. A reused MCP cache initially returned the old roster; it was not accepted as verification. The roster read tool was repaired to refresh ESPN state before reporting rosters.

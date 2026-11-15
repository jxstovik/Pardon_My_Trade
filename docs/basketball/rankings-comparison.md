# Experimental forecast versus external ranks — October 27, 2026

The first PMT draft baseline now exists. This supersedes the earlier status below. It covers 2,209/5,687 IDs with 29 targeted [RotoWire supplements](provider-supplement.md); no second independent prospective provider was verified. It has no held-out accuracy/calibration result. Fantrax ADP remains a separately labeled market reference.

| Player | PMT category rank | Proposed positional draft priority | RotoWire points rank |
|---|---:|---:|---:|
| Tyler Tanner | 1 | 1 | 2 |
| Jeremy Fears | 5 | 8 | 1 |
| Pryce Sandfort | 16 | 2 | 10 |
| Motiejus Krivas | 27 | 9 | 5 |
| Jordan Smith | 274 | 364 | 4 |
| Rodney Rice | 95 | 132 | 25 |

These ranks describe different scoring/pool assumptions. PMT uses all eight categories, modeled shot-volume impact and a broader historical pool; RotoWire's board covers five power conferences and primarily points scoring. PMT is partly dependent on the same provider for four projected fields, so this is not an independent model-versus-consensus accuracy test. Jordan Smith is a provider-backed cold start with imputed shooting/stocks: the large disagreement is a review requirement, not proof of overvaluation. Draft priorities additionally apply a declared positional replacement proxy; they do not model survival to the next pick.

Dra Gibbs-Lawhorn illustrates why forward role supplementation matters: the historical input is 20.7 PPG, the provider's current-season projection is 10.5; PMT uses the latter where covered. All remaining historical-only roles require review. Missing provider ranks are uncovered, not rejected. [Full board/methods](../../artifacts/basketball/2026-10-27/check-in-1201/draft-forecast/board.md), [draft guide/automation plan](draft-automation-plan.md).

---

# Earlier external ranking check — October 27, 2026

The implemented system has data import, identity/history auditing, scoring arithmetic and readiness reporting. No PMT basketball forecast, draft rankings, trained/calibrated model, historical performance evaluation or legal weekly optimizer exists yet. Nineteen passing tests verify implemented software behavior, not forecast skill. Balanced is a saved construction preference, not a fitted model.

## Illustrative external comparison

[Source: RotoWire preseason Power Conference Top-200](https://www.rotowire.com/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463), checked October 27. Five rows only; this is not a full source import or consensus. Matched unique names and schools against the October 27 official Fantrax Standard export. Saved RkOv/ADP belong to Fantrax, not PMT. Their exact calculation/basis has not been validated.

| Player | Fantrax display rank in saved history view | RotoWire preseason overall rank |
|---|---:|---:|
| Jeremy Fears | 110 | 1 |
| Tyler Tanner | 3 | 2 |
| Thomas Haugh | 31 | 3 |
| Motiejus Krivas | 201 | 5 |
| Tyran Stokes | 5,371 | 7 |

Scopes differ: Fantrax's selected statistics are 2025–26 regular-season per-game history across all available schools. RotoWire's article is a 2026–27 preseason board restricted to ACC/Big 12/Big East/Big Ten/SEC and primarily uses DraftKings points scoring. This league uses eight categories including percentages and threes, without turnovers. RotoWire's separate rankings page also describes a five-conference pool and all-around production including turnovers. Neither source is a ready-made league-specific PMT ranking.

The freshman Stokes has zero displayed historical GP in our export; his low display position does not justify a low future value. Likewise, the Fears/Krivas differences are investigation candidates, not demonstrated bargains or validated PMT disagreements. We have not established which board will prove more accurate. Do not calculate model rank correlation or claim an edge from this sample.

[Machine-readable sample](../../artifacts/basketball/2026-10-27/ranking-comparison-sample.json).

## Immediate model priority

Build an explicit experimental minutes/rates baseline with coherent shooting volume and documented current-role, transfer and freshman assumptions, then calculate eight-category value and positional replacement costs. Keep research-only or missing-input rows distinct. Use this RotoWire sample as an independent sanity check; expand benchmarks only on permitted, comparable inputs. Waiver/lock ambiguities constrain execution and weekly optimization, but do not need to delay all preseason per-game forecast research. Validate forecast skill separately through chronological evaluation and prospective outcomes before any accuracy claim.

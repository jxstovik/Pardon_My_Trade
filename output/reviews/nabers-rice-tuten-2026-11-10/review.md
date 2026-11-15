# Nabers trade review — November 10, 2026

Recommendation: keep Nabers over Rice + Tuten. Opening counter: send Malik Nabers + Tony Pollard for Jahmyr Gibbs + Rashee Rice. This is an ambitious negotiating ask supported by improvement to Jordan's lineup, not a claim Elliott should accept.

## Evidence

- League 98806880, season 2026, Jordan team 7, Elliott team 1. Authenticated read-only ESPN roster refresh: 2026-11-10T17:23:07.240Z. All proposed trade participants ACTIVE. No ESPN writes.
- Week 10 candidate: `weekly-2026-W10-a5f6795d8f00-368dedd8bda2-d1284c4271e7`, built 2026-11-10T13:23:43.197336Z. Outcome cutoff Week 9: 136 completed games including all 15 Week 9 games and BUF–MIN. Source stats and schedule hashes and model code match saved manifest.
- Candidate status: not promoted. Its 2025 holdout WR MAE 4.26 versus baseline 4.38; RB MAE 4.42 versus baseline 4.37. These are not current-week or trade-level error guarantees. No model retraining, rebuild or promotion in this review.
- Saved scout forecasts omitted Elliott's roster, including Rice/Tuten. Extended inference uses existing saved model heads and unchanged as-of feature construction. Six comparable healthy Jordan player means reproduce saved scout means exactly. All scoped RB/WR identities uniquely matched.
- The separate `data/models.json` runtime store was saved 2026-11-10T13:22:46.867Z. The trade participants have zero observed weeks and no last observed result; those projection-seeded runtime means are not substituted for the outcome-trained candidate.

## Week 10 active-state PPR means

| Player | Mean |
|---|---:|
| Jahmyr Gibbs | 21.27 |
| Malik Nabers | 18.34 |
| Ashton Jeanty | 14.11 |
| Rashee Rice | 13.66 |
| Drake London | 12.88 |
| Tony Pollard | 12.74 |
| Bhayshul Tuten | 12.04 |
| Wan'Dale Robinson | 10.62 |
| Ollie Gordon II | 10.03 |

## Starting lineup scenarios

Existing PMT scout lineup optimizer; baseline exactly reproduces published Week 10 total. Extra roster spot can be freed by Michael Wilson for these hypothetical two-for-one scenarios; no drop performed or validated.

| Scenario | Week 10 total | Week 10 change | Weeks 10–17 scenario change | Weeks 15–17 scenario change |
|---|---:|---:|---:|---:|
| Keep | 111.30 | 0 | 0 | 0 |
| Nabers for Rice + Tuten | 108.03 | -3.26 | -21.79 | -6.17 |
| Nabers + Pollard for Gibbs + Rice | 115.14 | +3.85 | +21.81 | +5.44 |
| Nabers for Gibbs | 114.22 | +2.92 | +18.15 | +5.12 |
| Nabers for London + Tuten | 107.25 | -4.04 | -31.81 | -9.44 |
| Nabers for Rice + Gordon | 106.61 | -4.68 | -34.94 | -12.31 |

Original offer replaces Nabers with Rice (-4.68) and Robinson at FLEX with Tuten (+1.42); Jeanty and Pollard remain RB starters. Counter replaces Nabers with Rice (-4.68) and Pollard with Gibbs (+8.53).

Multiweek outputs use the existing frozen-completed-outcome horizon model, schedule/opponent context and weekly reoptimization. They are unvalidated planning scenarios, not calibrated ROS confidence intervals; they do not forecast injury recovery, future role changes or waiver replacements. Current O/IR/D players excluded; Q players conditional on active. Active-state candidate does not price legal/suspension risk or keeper value. ESPN ACTIVE is a current designation, not a medical guarantee. No live trade validation tool was available. No action queued, approved, submitted or executed.

## Reproducibility

`model-comparison.json` contains inference, causal coverage, matching, parity and horizon results. `lineup-scenarios.json` contains weekly optimized lineups. `live-rosters.json` is the scoped ESPN read. The two Python scripts reproduce inference and scenario selection without modifying saved model weights.

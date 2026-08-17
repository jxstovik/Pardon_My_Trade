# ChatPFT 2024 RB Walk-Forward Replay

This report is generated from real nflverse outcomes and archive-first source attempts.

- Position: `RB`
- Checkpoints: `19`
- Bootstrap seed: `20260817`
- Source records: `91`
- Promotion decision: **pass**

## Weekly Metrics

| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2024-W1 | frozen_preseason | 77 | 4.721 | 6.049 | 0.870 | 2.361 |
| 2024-W1 | frozen_weights_adaptive_features | 77 | 4.641 | 5.991 | 0.870 | 2.321 |
| 2024-W1 | adaptive_expanding | 77 | 4.641 | 5.991 | 0.870 | 2.321 |
| 2024-W2 | frozen_preseason | 80 | 4.377 | 6.349 | 0.887 | 2.188 |
| 2024-W2 | frozen_weights_adaptive_features | 80 | 4.087 | 6.131 | 0.887 | 2.043 |
| 2024-W2 | adaptive_expanding | 80 | 4.087 | 6.129 | 0.887 | 2.043 |
| 2024-W3 | frozen_preseason | 81 | 5.484 | 7.076 | 0.790 | 2.742 |
| 2024-W3 | frozen_weights_adaptive_features | 81 | 5.265 | 6.917 | 0.802 | 2.632 |
| 2024-W3 | adaptive_expanding | 81 | 5.256 | 6.911 | 0.802 | 2.628 |
| 2024-W4 | frozen_preseason | 75 | 5.882 | 7.851 | 0.800 | 2.941 |
| 2024-W4 | frozen_weights_adaptive_features | 75 | 5.302 | 7.228 | 0.840 | 2.651 |
| 2024-W4 | adaptive_expanding | 75 | 5.286 | 7.214 | 0.853 | 2.643 |
| 2024-W5 | frozen_preseason | 64 | 4.912 | 6.551 | 0.828 | 2.456 |
| 2024-W5 | frozen_weights_adaptive_features | 64 | 4.870 | 6.232 | 0.859 | 2.435 |
| 2024-W5 | adaptive_expanding | 64 | 4.880 | 6.231 | 0.859 | 2.440 |
| 2024-W6 | frozen_preseason | 73 | 6.016 | 7.743 | 0.726 | 3.008 |
| 2024-W6 | frozen_weights_adaptive_features | 73 | 5.588 | 7.335 | 0.808 | 2.794 |
| 2024-W6 | adaptive_expanding | 73 | 5.588 | 7.337 | 0.808 | 2.794 |
| 2024-W7 | frozen_preseason | 76 | 5.534 | 7.083 | 0.803 | 2.767 |
| 2024-W7 | frozen_weights_adaptive_features | 76 | 5.594 | 6.887 | 0.842 | 2.797 |
| 2024-W7 | adaptive_expanding | 76 | 5.597 | 6.881 | 0.842 | 2.798 |
| 2024-W8 | frozen_preseason | 81 | 4.868 | 6.014 | 0.864 | 2.434 |
| 2024-W8 | frozen_weights_adaptive_features | 81 | 4.569 | 5.636 | 0.852 | 2.285 |
| 2024-W8 | adaptive_expanding | 81 | 4.586 | 5.649 | 0.852 | 2.293 |
| 2024-W9 | frozen_preseason | 73 | 5.383 | 7.165 | 0.808 | 2.692 |
| 2024-W9 | frozen_weights_adaptive_features | 73 | 5.021 | 6.448 | 0.808 | 2.510 |
| 2024-W9 | adaptive_expanding | 73 | 5.025 | 6.435 | 0.822 | 2.512 |
| 2024-W10 | frozen_preseason | 70 | 4.493 | 5.788 | 0.900 | 2.247 |
| 2024-W10 | frozen_weights_adaptive_features | 70 | 4.113 | 5.047 | 0.914 | 2.057 |
| 2024-W10 | adaptive_expanding | 70 | 4.153 | 5.071 | 0.914 | 2.076 |
| 2024-W11 | frozen_preseason | 71 | 5.201 | 6.713 | 0.845 | 2.601 |
| 2024-W11 | frozen_weights_adaptive_features | 71 | 4.687 | 6.080 | 0.887 | 2.344 |
| 2024-W11 | adaptive_expanding | 71 | 4.705 | 6.072 | 0.887 | 2.353 |
| 2024-W12 | frozen_preseason | 62 | 5.883 | 8.081 | 0.774 | 2.941 |
| 2024-W12 | frozen_weights_adaptive_features | 62 | 5.089 | 6.993 | 0.806 | 2.545 |
| 2024-W12 | adaptive_expanding | 62 | 5.095 | 6.986 | 0.806 | 2.547 |
| 2024-W13 | frozen_preseason | 74 | 5.300 | 6.789 | 0.811 | 2.650 |
| 2024-W13 | frozen_weights_adaptive_features | 74 | 4.417 | 5.553 | 0.865 | 2.208 |
| 2024-W13 | adaptive_expanding | 74 | 4.435 | 5.576 | 0.865 | 2.217 |
| 2024-W14 | frozen_preseason | 63 | 5.764 | 7.705 | 0.810 | 2.882 |
| 2024-W14 | frozen_weights_adaptive_features | 63 | 4.952 | 6.863 | 0.857 | 2.476 |
| 2024-W14 | adaptive_expanding | 63 | 4.959 | 6.874 | 0.857 | 2.480 |
| 2024-W15 | frozen_preseason | 78 | 5.219 | 6.817 | 0.808 | 2.610 |
| 2024-W15 | frozen_weights_adaptive_features | 78 | 4.801 | 6.394 | 0.846 | 2.401 |
| 2024-W15 | adaptive_expanding | 78 | 4.808 | 6.404 | 0.846 | 2.404 |
| 2024-W16 | frozen_preseason | 83 | 6.122 | 7.780 | 0.735 | 3.061 |
| 2024-W16 | frozen_weights_adaptive_features | 83 | 5.318 | 7.018 | 0.795 | 2.659 |
| 2024-W16 | adaptive_expanding | 83 | 5.313 | 7.011 | 0.795 | 2.657 |
| 2024-W17 | frozen_preseason | 83 | 5.112 | 6.598 | 0.783 | 2.556 |
| 2024-W17 | frozen_weights_adaptive_features | 83 | 4.030 | 5.198 | 0.855 | 2.015 |
| 2024-W17 | adaptive_expanding | 83 | 4.041 | 5.213 | 0.855 | 2.021 |
| 2024-W18 | frozen_preseason | 79 | 5.151 | 7.530 | 0.810 | 2.576 |
| 2024-W18 | frozen_weights_adaptive_features | 79 | 4.780 | 6.977 | 0.848 | 2.390 |
| 2024-W18 | adaptive_expanding | 79 | 4.776 | 6.985 | 0.835 | 2.388 |

## Takeaways

- Adaptive expanding weighted MAE was `4.840` versus frozen preseason `5.295`.
- Adaptive P10-P90 coverage was `0.847` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.595` with bootstrap upper bound `-0.425`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

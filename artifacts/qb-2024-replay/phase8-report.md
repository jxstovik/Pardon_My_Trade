# ChatPFT 2024 QB Walk-Forward Replay

This report is generated from real nflverse outcomes and archive-first source attempts.

- Position: `QB`
- Checkpoints: `19`
- Bootstrap seed: `20260817`
- Source records: `91`
- Promotion decision: **pass**

## Weekly Metrics

| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2024-W1 | frozen_preseason | 39 | 5.209 | 6.500 | 0.821 | 2.605 |
| 2024-W1 | frozen_weights_adaptive_features | 39 | 5.274 | 6.547 | 0.795 | 2.637 |
| 2024-W1 | adaptive_expanding | 39 | 5.274 | 6.547 | 0.795 | 2.637 |
| 2024-W2 | frozen_preseason | 38 | 5.116 | 6.291 | 0.816 | 2.558 |
| 2024-W2 | frozen_weights_adaptive_features | 38 | 5.215 | 6.260 | 0.789 | 2.608 |
| 2024-W2 | adaptive_expanding | 38 | 5.215 | 6.257 | 0.789 | 2.608 |
| 2024-W3 | frozen_preseason | 41 | 7.338 | 8.826 | 0.805 | 3.669 |
| 2024-W3 | frozen_weights_adaptive_features | 41 | 7.141 | 8.350 | 0.756 | 3.571 |
| 2024-W3 | adaptive_expanding | 41 | 7.140 | 8.355 | 0.756 | 3.570 |
| 2024-W4 | frozen_preseason | 36 | 6.464 | 8.045 | 0.722 | 3.232 |
| 2024-W4 | frozen_weights_adaptive_features | 36 | 5.793 | 7.272 | 0.833 | 2.897 |
| 2024-W4 | adaptive_expanding | 36 | 5.778 | 7.268 | 0.833 | 2.889 |
| 2024-W5 | frozen_preseason | 36 | 6.815 | 8.527 | 0.750 | 3.408 |
| 2024-W5 | frozen_weights_adaptive_features | 36 | 6.435 | 8.125 | 0.750 | 3.218 |
| 2024-W5 | adaptive_expanding | 36 | 6.417 | 8.130 | 0.750 | 3.208 |
| 2024-W6 | frozen_preseason | 33 | 6.330 | 7.803 | 0.788 | 3.165 |
| 2024-W6 | frozen_weights_adaptive_features | 33 | 5.750 | 6.893 | 0.848 | 2.875 |
| 2024-W6 | adaptive_expanding | 33 | 5.744 | 6.896 | 0.848 | 2.872 |
| 2024-W7 | frozen_preseason | 42 | 6.248 | 7.577 | 0.762 | 3.124 |
| 2024-W7 | frozen_weights_adaptive_features | 42 | 5.885 | 7.103 | 0.833 | 2.943 |
| 2024-W7 | adaptive_expanding | 42 | 5.878 | 7.089 | 0.833 | 2.939 |
| 2024-W8 | frozen_preseason | 37 | 6.587 | 8.459 | 0.757 | 3.293 |
| 2024-W8 | frozen_weights_adaptive_features | 37 | 5.981 | 7.783 | 0.784 | 2.990 |
| 2024-W8 | adaptive_expanding | 37 | 5.965 | 7.782 | 0.784 | 2.983 |
| 2024-W9 | frozen_preseason | 34 | 6.898 | 8.046 | 0.765 | 3.449 |
| 2024-W9 | frozen_weights_adaptive_features | 34 | 5.790 | 6.982 | 0.853 | 2.895 |
| 2024-W9 | adaptive_expanding | 34 | 5.748 | 6.952 | 0.853 | 2.874 |
| 2024-W10 | frozen_preseason | 32 | 6.170 | 7.469 | 0.781 | 3.085 |
| 2024-W10 | frozen_weights_adaptive_features | 32 | 6.503 | 7.617 | 0.688 | 3.251 |
| 2024-W10 | adaptive_expanding | 32 | 6.489 | 7.617 | 0.688 | 3.244 |
| 2024-W11 | frozen_preseason | 33 | 8.487 | 10.098 | 0.636 | 4.244 |
| 2024-W11 | frozen_weights_adaptive_features | 33 | 7.276 | 8.991 | 0.697 | 3.638 |
| 2024-W11 | adaptive_expanding | 33 | 7.289 | 8.986 | 0.697 | 3.644 |
| 2024-W12 | frozen_preseason | 32 | 7.235 | 9.161 | 0.656 | 3.618 |
| 2024-W12 | frozen_weights_adaptive_features | 32 | 5.847 | 7.349 | 0.719 | 2.924 |
| 2024-W12 | adaptive_expanding | 32 | 5.863 | 7.355 | 0.719 | 2.931 |
| 2024-W13 | frozen_preseason | 36 | 7.653 | 9.995 | 0.667 | 3.827 |
| 2024-W13 | frozen_weights_adaptive_features | 36 | 6.778 | 8.792 | 0.722 | 3.389 |
| 2024-W13 | adaptive_expanding | 36 | 6.836 | 8.834 | 0.694 | 3.418 |
| 2024-W14 | frozen_preseason | 32 | 7.147 | 9.726 | 0.781 | 3.574 |
| 2024-W14 | frozen_weights_adaptive_features | 32 | 5.475 | 8.057 | 0.844 | 2.737 |
| 2024-W14 | adaptive_expanding | 32 | 5.466 | 8.020 | 0.844 | 2.733 |
| 2024-W15 | frozen_preseason | 43 | 8.308 | 10.191 | 0.581 | 4.154 |
| 2024-W15 | frozen_weights_adaptive_features | 43 | 8.053 | 9.654 | 0.698 | 4.027 |
| 2024-W15 | adaptive_expanding | 43 | 8.061 | 9.600 | 0.698 | 4.030 |
| 2024-W16 | frozen_preseason | 35 | 6.980 | 9.054 | 0.743 | 3.490 |
| 2024-W16 | frozen_weights_adaptive_features | 35 | 5.385 | 6.854 | 0.829 | 2.692 |
| 2024-W16 | adaptive_expanding | 35 | 5.414 | 6.896 | 0.829 | 2.707 |
| 2024-W17 | frozen_preseason | 42 | 7.806 | 10.004 | 0.714 | 3.903 |
| 2024-W17 | frozen_weights_adaptive_features | 42 | 6.772 | 8.663 | 0.762 | 3.386 |
| 2024-W17 | adaptive_expanding | 42 | 6.727 | 8.645 | 0.762 | 3.363 |
| 2024-W18 | frozen_preseason | 43 | 7.506 | 9.540 | 0.674 | 3.753 |
| 2024-W18 | frozen_weights_adaptive_features | 43 | 8.199 | 9.714 | 0.651 | 4.099 |
| 2024-W18 | adaptive_expanding | 43 | 8.155 | 9.692 | 0.651 | 4.077 |

## Takeaways

- Adaptive expanding weighted MAE was `6.347` versus frozen preseason `6.915`.
- Adaptive P10-P90 coverage was `0.767` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.800` with bootstrap upper bound `-0.509`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

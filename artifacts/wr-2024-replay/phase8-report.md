# ChatPFT 2024 WR Walk-Forward Replay

This report is generated from real nflverse outcomes and archive-first source attempts.

- Position: `WR`
- Checkpoints: `19`
- Bootstrap seed: `20260817`
- Source records: `91`
- Promotion decision: **pass**

## Weekly Metrics

| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2024-W1 | frozen_preseason | 125 | 5.113 | 6.585 | 0.864 | 2.556 |
| 2024-W1 | frozen_weights_adaptive_features | 125 | 5.108 | 6.583 | 0.864 | 2.554 |
| 2024-W1 | adaptive_expanding | 125 | 5.108 | 6.583 | 0.864 | 2.554 |
| 2024-W2 | frozen_preseason | 124 | 5.236 | 6.710 | 0.798 | 2.618 |
| 2024-W2 | frozen_weights_adaptive_features | 124 | 5.246 | 6.713 | 0.823 | 2.623 |
| 2024-W2 | adaptive_expanding | 124 | 5.242 | 6.712 | 0.831 | 2.621 |
| 2024-W3 | frozen_preseason | 128 | 5.394 | 7.575 | 0.828 | 2.697 |
| 2024-W3 | frozen_weights_adaptive_features | 128 | 5.089 | 7.190 | 0.828 | 2.544 |
| 2024-W3 | adaptive_expanding | 128 | 5.089 | 7.194 | 0.828 | 2.544 |
| 2024-W4 | frozen_preseason | 126 | 5.342 | 6.595 | 0.817 | 2.671 |
| 2024-W4 | frozen_weights_adaptive_features | 126 | 4.796 | 5.977 | 0.865 | 2.398 |
| 2024-W4 | adaptive_expanding | 126 | 4.796 | 5.976 | 0.865 | 2.398 |
| 2024-W5 | frozen_preseason | 102 | 5.981 | 8.148 | 0.755 | 2.991 |
| 2024-W5 | frozen_weights_adaptive_features | 102 | 5.695 | 7.718 | 0.814 | 2.848 |
| 2024-W5 | adaptive_expanding | 102 | 5.692 | 7.716 | 0.814 | 2.846 |
| 2024-W6 | frozen_preseason | 114 | 5.057 | 6.443 | 0.842 | 2.529 |
| 2024-W6 | frozen_weights_adaptive_features | 114 | 4.910 | 6.211 | 0.825 | 2.455 |
| 2024-W6 | adaptive_expanding | 114 | 4.920 | 6.218 | 0.825 | 2.460 |
| 2024-W7 | frozen_preseason | 118 | 5.172 | 6.341 | 0.814 | 2.586 |
| 2024-W7 | frozen_weights_adaptive_features | 118 | 4.921 | 5.990 | 0.831 | 2.461 |
| 2024-W7 | adaptive_expanding | 118 | 4.921 | 5.985 | 0.831 | 2.460 |
| 2024-W8 | frozen_preseason | 124 | 5.570 | 7.111 | 0.806 | 2.785 |
| 2024-W8 | frozen_weights_adaptive_features | 124 | 5.027 | 6.510 | 0.847 | 2.514 |
| 2024-W8 | adaptive_expanding | 124 | 5.023 | 6.504 | 0.855 | 2.511 |
| 2024-W9 | frozen_preseason | 123 | 5.206 | 6.834 | 0.789 | 2.603 |
| 2024-W9 | frozen_weights_adaptive_features | 123 | 4.708 | 6.451 | 0.829 | 2.354 |
| 2024-W9 | adaptive_expanding | 123 | 4.714 | 6.459 | 0.829 | 2.357 |
| 2024-W10 | frozen_preseason | 106 | 5.041 | 7.432 | 0.840 | 2.520 |
| 2024-W10 | frozen_weights_adaptive_features | 106 | 4.619 | 6.912 | 0.887 | 2.310 |
| 2024-W10 | adaptive_expanding | 106 | 4.622 | 6.913 | 0.896 | 2.311 |
| 2024-W11 | frozen_preseason | 116 | 5.635 | 7.275 | 0.802 | 2.818 |
| 2024-W11 | frozen_weights_adaptive_features | 116 | 5.121 | 6.679 | 0.810 | 2.561 |
| 2024-W11 | adaptive_expanding | 116 | 5.112 | 6.673 | 0.810 | 2.556 |
| 2024-W12 | frozen_preseason | 107 | 5.045 | 6.437 | 0.841 | 2.523 |
| 2024-W12 | frozen_weights_adaptive_features | 107 | 4.507 | 6.006 | 0.879 | 2.254 |
| 2024-W12 | adaptive_expanding | 107 | 4.507 | 6.011 | 0.879 | 2.254 |
| 2024-W13 | frozen_preseason | 121 | 5.314 | 6.942 | 0.851 | 2.657 |
| 2024-W13 | frozen_weights_adaptive_features | 121 | 4.558 | 6.228 | 0.884 | 2.279 |
| 2024-W13 | adaptive_expanding | 121 | 4.562 | 6.234 | 0.884 | 2.281 |
| 2024-W14 | frozen_preseason | 95 | 6.430 | 8.924 | 0.758 | 3.215 |
| 2024-W14 | frozen_weights_adaptive_features | 95 | 5.803 | 7.919 | 0.832 | 2.901 |
| 2024-W14 | adaptive_expanding | 95 | 5.815 | 7.927 | 0.821 | 2.907 |
| 2024-W15 | frozen_preseason | 132 | 5.536 | 7.519 | 0.811 | 2.768 |
| 2024-W15 | frozen_weights_adaptive_features | 132 | 5.138 | 6.983 | 0.848 | 2.569 |
| 2024-W15 | adaptive_expanding | 132 | 5.141 | 6.987 | 0.848 | 2.570 |
| 2024-W16 | frozen_preseason | 122 | 5.113 | 6.821 | 0.852 | 2.557 |
| 2024-W16 | frozen_weights_adaptive_features | 122 | 4.306 | 5.870 | 0.893 | 2.153 |
| 2024-W16 | adaptive_expanding | 122 | 4.306 | 5.871 | 0.893 | 2.153 |
| 2024-W17 | frozen_preseason | 129 | 6.187 | 8.642 | 0.791 | 3.094 |
| 2024-W17 | frozen_weights_adaptive_features | 129 | 5.276 | 7.243 | 0.822 | 2.638 |
| 2024-W17 | adaptive_expanding | 129 | 5.273 | 7.242 | 0.822 | 2.637 |
| 2024-W18 | frozen_preseason | 120 | 5.923 | 7.781 | 0.767 | 2.961 |
| 2024-W18 | frozen_weights_adaptive_features | 120 | 4.895 | 6.559 | 0.825 | 2.447 |
| 2024-W18 | adaptive_expanding | 120 | 4.890 | 6.562 | 0.825 | 2.445 |

## Takeaways

- Adaptive expanding weighted MAE was `4.976` versus frozen preseason `5.453`.
- Adaptive P10-P90 coverage was `0.846` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.575` with bootstrap upper bound `-0.410`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

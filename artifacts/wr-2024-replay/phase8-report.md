# ChatPFT 2024 WR Walk-Forward Replay

This report is generated from real nflverse outcomes and archive-first source attempts.

- Checkpoints: `19`
- Bootstrap seed: `20260817`
- Source records: `91`
- Promotion decision: **pass**

## Weekly Metrics

| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2024-W1 | frozen_preseason | 125 | 5.108 | 6.604 | 0.856 | 2.554 |
| 2024-W1 | frozen_weights_adaptive_features | 125 | 5.102 | 6.601 | 0.856 | 2.551 |
| 2024-W1 | adaptive_expanding | 125 | 5.102 | 6.601 | 0.856 | 2.551 |
| 2024-W2 | frozen_preseason | 124 | 5.242 | 6.719 | 0.798 | 2.621 |
| 2024-W2 | frozen_weights_adaptive_features | 124 | 5.231 | 6.702 | 0.806 | 2.615 |
| 2024-W2 | adaptive_expanding | 124 | 5.227 | 6.700 | 0.806 | 2.614 |
| 2024-W3 | frozen_preseason | 128 | 5.382 | 7.559 | 0.828 | 2.691 |
| 2024-W3 | frozen_weights_adaptive_features | 128 | 5.074 | 7.174 | 0.828 | 2.537 |
| 2024-W3 | adaptive_expanding | 128 | 5.075 | 7.178 | 0.828 | 2.537 |
| 2024-W4 | frozen_preseason | 126 | 5.334 | 6.582 | 0.825 | 2.667 |
| 2024-W4 | frozen_weights_adaptive_features | 126 | 4.782 | 5.959 | 0.865 | 2.391 |
| 2024-W4 | adaptive_expanding | 126 | 4.782 | 5.959 | 0.865 | 2.391 |
| 2024-W5 | frozen_preseason | 102 | 5.990 | 8.136 | 0.755 | 2.995 |
| 2024-W5 | frozen_weights_adaptive_features | 102 | 5.709 | 7.717 | 0.814 | 2.854 |
| 2024-W5 | adaptive_expanding | 102 | 5.708 | 7.718 | 0.824 | 2.854 |
| 2024-W6 | frozen_preseason | 114 | 5.069 | 6.455 | 0.842 | 2.535 |
| 2024-W6 | frozen_weights_adaptive_features | 114 | 4.900 | 6.210 | 0.833 | 2.450 |
| 2024-W6 | adaptive_expanding | 114 | 4.909 | 6.216 | 0.825 | 2.455 |
| 2024-W7 | frozen_preseason | 118 | 5.163 | 6.324 | 0.831 | 2.582 |
| 2024-W7 | frozen_weights_adaptive_features | 118 | 4.899 | 5.968 | 0.839 | 2.450 |
| 2024-W7 | adaptive_expanding | 118 | 4.896 | 5.959 | 0.839 | 2.448 |
| 2024-W8 | frozen_preseason | 124 | 5.566 | 7.110 | 0.806 | 2.783 |
| 2024-W8 | frozen_weights_adaptive_features | 124 | 5.017 | 6.489 | 0.847 | 2.509 |
| 2024-W8 | adaptive_expanding | 124 | 5.014 | 6.483 | 0.855 | 2.507 |
| 2024-W9 | frozen_preseason | 123 | 5.233 | 6.865 | 0.789 | 2.616 |
| 2024-W9 | frozen_weights_adaptive_features | 123 | 4.718 | 6.461 | 0.829 | 2.359 |
| 2024-W9 | adaptive_expanding | 123 | 4.724 | 6.472 | 0.829 | 2.362 |
| 2024-W10 | frozen_preseason | 106 | 5.024 | 7.409 | 0.840 | 2.512 |
| 2024-W10 | frozen_weights_adaptive_features | 106 | 4.588 | 6.898 | 0.887 | 2.294 |
| 2024-W10 | adaptive_expanding | 106 | 4.589 | 6.896 | 0.887 | 2.295 |
| 2024-W11 | frozen_preseason | 116 | 5.629 | 7.269 | 0.793 | 2.814 |
| 2024-W11 | frozen_weights_adaptive_features | 116 | 5.139 | 6.701 | 0.810 | 2.570 |
| 2024-W11 | adaptive_expanding | 116 | 5.134 | 6.701 | 0.810 | 2.567 |
| 2024-W12 | frozen_preseason | 107 | 5.037 | 6.428 | 0.841 | 2.519 |
| 2024-W12 | frozen_weights_adaptive_features | 107 | 4.507 | 6.012 | 0.888 | 2.254 |
| 2024-W12 | adaptive_expanding | 107 | 4.510 | 6.017 | 0.888 | 2.255 |
| 2024-W13 | frozen_preseason | 121 | 5.310 | 6.920 | 0.851 | 2.655 |
| 2024-W13 | frozen_weights_adaptive_features | 121 | 4.562 | 6.220 | 0.884 | 2.281 |
| 2024-W13 | adaptive_expanding | 121 | 4.570 | 6.230 | 0.884 | 2.285 |
| 2024-W14 | frozen_preseason | 95 | 6.422 | 8.902 | 0.768 | 3.211 |
| 2024-W14 | frozen_weights_adaptive_features | 95 | 5.788 | 7.904 | 0.832 | 2.894 |
| 2024-W14 | adaptive_expanding | 95 | 5.794 | 7.909 | 0.832 | 2.897 |
| 2024-W15 | frozen_preseason | 132 | 5.515 | 7.510 | 0.811 | 2.757 |
| 2024-W15 | frozen_weights_adaptive_features | 132 | 5.144 | 6.994 | 0.848 | 2.572 |
| 2024-W15 | adaptive_expanding | 132 | 5.144 | 6.997 | 0.848 | 2.572 |
| 2024-W16 | frozen_preseason | 122 | 5.125 | 6.821 | 0.852 | 2.563 |
| 2024-W16 | frozen_weights_adaptive_features | 122 | 4.307 | 5.885 | 0.885 | 2.154 |
| 2024-W16 | adaptive_expanding | 122 | 4.306 | 5.885 | 0.885 | 2.153 |
| 2024-W17 | frozen_preseason | 129 | 6.175 | 8.618 | 0.791 | 3.088 |
| 2024-W17 | frozen_weights_adaptive_features | 129 | 5.274 | 7.239 | 0.829 | 2.637 |
| 2024-W17 | adaptive_expanding | 129 | 5.268 | 7.238 | 0.829 | 2.634 |
| 2024-W18 | frozen_preseason | 120 | 5.921 | 7.772 | 0.767 | 2.961 |
| 2024-W18 | frozen_weights_adaptive_features | 120 | 4.903 | 6.570 | 0.825 | 2.452 |
| 2024-W18 | adaptive_expanding | 120 | 4.900 | 6.572 | 0.825 | 2.450 |

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

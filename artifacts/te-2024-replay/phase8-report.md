# ChatPFT 2024 TE Walk-Forward Replay

This report is generated from real nflverse outcomes and archive-first source attempts.

- Position: `TE`
- Checkpoints: `19`
- Bootstrap seed: `20260817`
- Source records: `91`
- Promotion decision: **pass**

## Weekly Metrics

| Period | Regime | Samples | MAE | RMSE | P10-P90 coverage | P50 pinball |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2024-W1 | frozen_preseason | 62 | 3.852 | 4.998 | 0.855 | 1.926 |
| 2024-W1 | frozen_weights_adaptive_features | 62 | 3.851 | 5.000 | 0.855 | 1.926 |
| 2024-W1 | adaptive_expanding | 62 | 3.851 | 5.000 | 0.855 | 1.926 |
| 2024-W2 | frozen_preseason | 60 | 3.921 | 4.833 | 0.850 | 1.960 |
| 2024-W2 | frozen_weights_adaptive_features | 60 | 3.603 | 4.358 | 0.883 | 1.802 |
| 2024-W2 | adaptive_expanding | 60 | 3.578 | 4.344 | 0.883 | 1.789 |
| 2024-W3 | frozen_preseason | 61 | 3.801 | 4.988 | 0.902 | 1.901 |
| 2024-W3 | frozen_weights_adaptive_features | 61 | 3.682 | 4.977 | 0.869 | 1.841 |
| 2024-W3 | adaptive_expanding | 61 | 3.671 | 4.979 | 0.869 | 1.836 |
| 2024-W4 | frozen_preseason | 57 | 3.548 | 4.401 | 0.860 | 1.774 |
| 2024-W4 | frozen_weights_adaptive_features | 57 | 3.473 | 4.433 | 0.842 | 1.737 |
| 2024-W4 | adaptive_expanding | 57 | 3.442 | 4.413 | 0.860 | 1.721 |
| 2024-W5 | frozen_preseason | 56 | 4.003 | 5.632 | 0.804 | 2.001 |
| 2024-W5 | frozen_weights_adaptive_features | 56 | 3.930 | 5.298 | 0.821 | 1.965 |
| 2024-W5 | adaptive_expanding | 56 | 3.934 | 5.324 | 0.821 | 1.967 |
| 2024-W6 | frozen_preseason | 51 | 4.070 | 5.113 | 0.843 | 2.035 |
| 2024-W6 | frozen_weights_adaptive_features | 51 | 3.874 | 4.849 | 0.863 | 1.937 |
| 2024-W6 | adaptive_expanding | 51 | 3.880 | 4.863 | 0.882 | 1.940 |
| 2024-W7 | frozen_preseason | 61 | 4.270 | 5.477 | 0.852 | 2.135 |
| 2024-W7 | frozen_weights_adaptive_features | 61 | 3.882 | 4.970 | 0.902 | 1.941 |
| 2024-W7 | adaptive_expanding | 61 | 3.888 | 4.993 | 0.902 | 1.944 |
| 2024-W8 | frozen_preseason | 70 | 4.118 | 5.921 | 0.829 | 2.059 |
| 2024-W8 | frozen_weights_adaptive_features | 70 | 3.869 | 5.498 | 0.857 | 1.935 |
| 2024-W8 | adaptive_expanding | 70 | 3.872 | 5.512 | 0.857 | 1.936 |
| 2024-W9 | frozen_preseason | 61 | 4.790 | 6.278 | 0.754 | 2.395 |
| 2024-W9 | frozen_weights_adaptive_features | 61 | 4.045 | 5.456 | 0.803 | 2.023 |
| 2024-W9 | adaptive_expanding | 61 | 4.051 | 5.464 | 0.787 | 2.026 |
| 2024-W10 | frozen_preseason | 57 | 3.184 | 4.019 | 0.930 | 1.592 |
| 2024-W10 | frozen_weights_adaptive_features | 57 | 3.164 | 4.117 | 0.895 | 1.582 |
| 2024-W10 | adaptive_expanding | 57 | 3.153 | 4.111 | 0.895 | 1.577 |
| 2024-W11 | frozen_preseason | 62 | 5.147 | 8.094 | 0.790 | 2.574 |
| 2024-W11 | frozen_weights_adaptive_features | 62 | 4.648 | 7.265 | 0.774 | 2.324 |
| 2024-W11 | adaptive_expanding | 62 | 4.640 | 7.257 | 0.774 | 2.320 |
| 2024-W12 | frozen_preseason | 51 | 4.366 | 5.848 | 0.824 | 2.183 |
| 2024-W12 | frozen_weights_adaptive_features | 51 | 4.312 | 5.613 | 0.765 | 2.156 |
| 2024-W12 | adaptive_expanding | 51 | 4.305 | 5.599 | 0.765 | 2.153 |
| 2024-W13 | frozen_preseason | 72 | 4.106 | 5.677 | 0.833 | 2.053 |
| 2024-W13 | frozen_weights_adaptive_features | 72 | 3.795 | 5.114 | 0.792 | 1.898 |
| 2024-W13 | adaptive_expanding | 72 | 3.777 | 5.098 | 0.806 | 1.888 |
| 2024-W14 | frozen_preseason | 56 | 3.227 | 3.970 | 0.929 | 1.613 |
| 2024-W14 | frozen_weights_adaptive_features | 56 | 3.366 | 4.156 | 0.911 | 1.683 |
| 2024-W14 | adaptive_expanding | 56 | 3.378 | 4.170 | 0.911 | 1.689 |
| 2024-W15 | frozen_preseason | 59 | 3.591 | 4.710 | 0.898 | 1.795 |
| 2024-W15 | frozen_weights_adaptive_features | 59 | 3.554 | 4.555 | 0.864 | 1.777 |
| 2024-W15 | adaptive_expanding | 59 | 3.568 | 4.568 | 0.831 | 1.784 |
| 2024-W16 | frozen_preseason | 63 | 3.687 | 4.647 | 0.873 | 1.844 |
| 2024-W16 | frozen_weights_adaptive_features | 63 | 3.355 | 4.171 | 0.921 | 1.677 |
| 2024-W16 | adaptive_expanding | 63 | 3.362 | 4.164 | 0.921 | 1.681 |
| 2024-W17 | frozen_preseason | 63 | 4.568 | 6.018 | 0.794 | 2.284 |
| 2024-W17 | frozen_weights_adaptive_features | 63 | 4.261 | 5.633 | 0.810 | 2.130 |
| 2024-W17 | adaptive_expanding | 63 | 4.255 | 5.629 | 0.810 | 2.127 |
| 2024-W18 | frozen_preseason | 66 | 4.360 | 5.512 | 0.773 | 2.180 |
| 2024-W18 | frozen_weights_adaptive_features | 66 | 3.603 | 4.492 | 0.879 | 1.802 |
| 2024-W18 | adaptive_expanding | 66 | 3.590 | 4.463 | 0.879 | 1.795 |

## Takeaways

- Adaptive expanding weighted MAE was `3.789` versus frozen preseason `4.044`.
- Adaptive P10-P90 coverage was `0.850` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.344` with bootstrap upper bound `-0.195`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

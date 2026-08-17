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
| 2024-W1 | frozen_preseason | 77 | 4.754 | 6.031 | 0.896 | 2.377 |
| 2024-W1 | frozen_weights_adaptive_features | 77 | 4.676 | 5.975 | 0.883 | 2.338 |
| 2024-W1 | adaptive_expanding | 77 | 4.676 | 5.975 | 0.883 | 2.338 |
| 2024-W2 | frozen_preseason | 80 | 4.329 | 6.312 | 0.887 | 2.164 |
| 2024-W2 | frozen_weights_adaptive_features | 80 | 4.104 | 6.131 | 0.887 | 2.052 |
| 2024-W2 | adaptive_expanding | 80 | 4.103 | 6.127 | 0.887 | 2.052 |
| 2024-W3 | frozen_preseason | 81 | 5.505 | 7.067 | 0.790 | 2.753 |
| 2024-W3 | frozen_weights_adaptive_features | 81 | 5.334 | 6.978 | 0.790 | 2.667 |
| 2024-W3 | adaptive_expanding | 81 | 5.328 | 6.972 | 0.790 | 2.664 |
| 2024-W4 | frozen_preseason | 75 | 5.841 | 7.825 | 0.813 | 2.921 |
| 2024-W4 | frozen_weights_adaptive_features | 75 | 5.360 | 7.289 | 0.827 | 2.680 |
| 2024-W4 | adaptive_expanding | 75 | 5.341 | 7.274 | 0.827 | 2.671 |
| 2024-W5 | frozen_preseason | 64 | 4.913 | 6.572 | 0.844 | 2.456 |
| 2024-W5 | frozen_weights_adaptive_features | 64 | 4.775 | 6.160 | 0.844 | 2.387 |
| 2024-W5 | adaptive_expanding | 64 | 4.778 | 6.159 | 0.844 | 2.389 |
| 2024-W6 | frozen_preseason | 73 | 5.960 | 7.686 | 0.740 | 2.980 |
| 2024-W6 | frozen_weights_adaptive_features | 73 | 5.583 | 7.309 | 0.781 | 2.791 |
| 2024-W6 | adaptive_expanding | 73 | 5.579 | 7.309 | 0.781 | 2.790 |
| 2024-W7 | frozen_preseason | 76 | 5.603 | 7.098 | 0.789 | 2.802 |
| 2024-W7 | frozen_weights_adaptive_features | 76 | 5.573 | 6.902 | 0.842 | 2.786 |
| 2024-W7 | adaptive_expanding | 76 | 5.575 | 6.895 | 0.829 | 2.788 |
| 2024-W8 | frozen_preseason | 81 | 4.844 | 5.989 | 0.852 | 2.422 |
| 2024-W8 | frozen_weights_adaptive_features | 81 | 4.501 | 5.615 | 0.864 | 2.251 |
| 2024-W8 | adaptive_expanding | 81 | 4.517 | 5.629 | 0.864 | 2.259 |
| 2024-W9 | frozen_preseason | 73 | 5.339 | 7.107 | 0.808 | 2.669 |
| 2024-W9 | frozen_weights_adaptive_features | 73 | 4.969 | 6.408 | 0.808 | 2.484 |
| 2024-W9 | adaptive_expanding | 73 | 4.972 | 6.397 | 0.822 | 2.486 |
| 2024-W10 | frozen_preseason | 70 | 4.496 | 5.787 | 0.886 | 2.248 |
| 2024-W10 | frozen_weights_adaptive_features | 70 | 4.134 | 5.072 | 0.914 | 2.067 |
| 2024-W10 | adaptive_expanding | 70 | 4.168 | 5.094 | 0.929 | 2.084 |
| 2024-W11 | frozen_preseason | 71 | 5.188 | 6.689 | 0.845 | 2.594 |
| 2024-W11 | frozen_weights_adaptive_features | 71 | 4.775 | 6.145 | 0.887 | 2.388 |
| 2024-W11 | adaptive_expanding | 71 | 4.790 | 6.133 | 0.887 | 2.395 |
| 2024-W12 | frozen_preseason | 62 | 5.916 | 8.079 | 0.774 | 2.958 |
| 2024-W12 | frozen_weights_adaptive_features | 62 | 5.132 | 7.025 | 0.806 | 2.566 |
| 2024-W12 | adaptive_expanding | 62 | 5.129 | 7.012 | 0.806 | 2.565 |
| 2024-W13 | frozen_preseason | 74 | 5.219 | 6.718 | 0.811 | 2.609 |
| 2024-W13 | frozen_weights_adaptive_features | 74 | 4.425 | 5.543 | 0.865 | 2.213 |
| 2024-W13 | adaptive_expanding | 74 | 4.441 | 5.568 | 0.851 | 2.220 |
| 2024-W14 | frozen_preseason | 63 | 5.759 | 7.654 | 0.810 | 2.880 |
| 2024-W14 | frozen_weights_adaptive_features | 63 | 5.055 | 6.929 | 0.841 | 2.528 |
| 2024-W14 | adaptive_expanding | 63 | 5.062 | 6.944 | 0.841 | 2.531 |
| 2024-W15 | frozen_preseason | 78 | 5.223 | 6.779 | 0.821 | 2.612 |
| 2024-W15 | frozen_weights_adaptive_features | 78 | 4.875 | 6.430 | 0.833 | 2.437 |
| 2024-W15 | adaptive_expanding | 78 | 4.873 | 6.434 | 0.833 | 2.437 |
| 2024-W16 | frozen_preseason | 83 | 6.145 | 7.778 | 0.747 | 3.072 |
| 2024-W16 | frozen_weights_adaptive_features | 83 | 5.333 | 6.993 | 0.807 | 2.666 |
| 2024-W16 | adaptive_expanding | 83 | 5.324 | 6.986 | 0.807 | 2.662 |
| 2024-W17 | frozen_preseason | 83 | 5.170 | 6.599 | 0.783 | 2.585 |
| 2024-W17 | frozen_weights_adaptive_features | 83 | 4.005 | 5.182 | 0.855 | 2.003 |
| 2024-W17 | adaptive_expanding | 83 | 4.016 | 5.194 | 0.855 | 2.008 |
| 2024-W18 | frozen_preseason | 79 | 5.213 | 7.524 | 0.797 | 2.606 |
| 2024-W18 | frozen_weights_adaptive_features | 79 | 4.802 | 6.994 | 0.848 | 2.401 |
| 2024-W18 | adaptive_expanding | 79 | 4.801 | 6.999 | 0.835 | 2.400 |

## Takeaways

- Adaptive expanding weighted MAE was `4.853` versus frozen preseason `5.295`.
- Adaptive P10-P90 coverage was `0.843` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.566` with bootstrap upper bound `-0.404`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

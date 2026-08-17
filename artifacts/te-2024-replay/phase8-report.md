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
| 2024-W1 | frozen_preseason | 62 | 3.843 | 4.960 | 0.855 | 1.921 |
| 2024-W1 | frozen_weights_adaptive_features | 62 | 3.843 | 4.961 | 0.855 | 1.922 |
| 2024-W1 | adaptive_expanding | 62 | 3.843 | 4.961 | 0.855 | 1.922 |
| 2024-W2 | frozen_preseason | 60 | 3.896 | 4.817 | 0.850 | 1.948 |
| 2024-W2 | frozen_weights_adaptive_features | 60 | 3.622 | 4.411 | 0.850 | 1.811 |
| 2024-W2 | adaptive_expanding | 60 | 3.592 | 4.401 | 0.867 | 1.796 |
| 2024-W3 | frozen_preseason | 61 | 3.879 | 5.029 | 0.902 | 1.940 |
| 2024-W3 | frozen_weights_adaptive_features | 61 | 3.708 | 4.962 | 0.869 | 1.854 |
| 2024-W3 | adaptive_expanding | 61 | 3.693 | 4.960 | 0.869 | 1.847 |
| 2024-W4 | frozen_preseason | 57 | 3.519 | 4.384 | 0.860 | 1.760 |
| 2024-W4 | frozen_weights_adaptive_features | 57 | 3.432 | 4.404 | 0.842 | 1.716 |
| 2024-W4 | adaptive_expanding | 57 | 3.408 | 4.385 | 0.842 | 1.704 |
| 2024-W5 | frozen_preseason | 56 | 4.007 | 5.601 | 0.786 | 2.004 |
| 2024-W5 | frozen_weights_adaptive_features | 56 | 4.043 | 5.403 | 0.804 | 2.021 |
| 2024-W5 | adaptive_expanding | 56 | 4.039 | 5.421 | 0.804 | 2.019 |
| 2024-W6 | frozen_preseason | 51 | 4.031 | 5.088 | 0.843 | 2.016 |
| 2024-W6 | frozen_weights_adaptive_features | 51 | 3.899 | 4.853 | 0.882 | 1.949 |
| 2024-W6 | adaptive_expanding | 51 | 3.906 | 4.870 | 0.882 | 1.953 |
| 2024-W7 | frozen_preseason | 61 | 4.307 | 5.463 | 0.852 | 2.154 |
| 2024-W7 | frozen_weights_adaptive_features | 61 | 3.908 | 5.002 | 0.869 | 1.954 |
| 2024-W7 | adaptive_expanding | 61 | 3.913 | 5.025 | 0.869 | 1.957 |
| 2024-W8 | frozen_preseason | 70 | 4.038 | 5.876 | 0.843 | 2.019 |
| 2024-W8 | frozen_weights_adaptive_features | 70 | 3.873 | 5.510 | 0.857 | 1.937 |
| 2024-W8 | adaptive_expanding | 70 | 3.870 | 5.520 | 0.857 | 1.935 |
| 2024-W9 | frozen_preseason | 61 | 4.762 | 6.239 | 0.721 | 2.381 |
| 2024-W9 | frozen_weights_adaptive_features | 61 | 4.094 | 5.459 | 0.787 | 2.047 |
| 2024-W9 | adaptive_expanding | 61 | 4.101 | 5.466 | 0.787 | 2.050 |
| 2024-W10 | frozen_preseason | 57 | 3.195 | 4.030 | 0.895 | 1.597 |
| 2024-W10 | frozen_weights_adaptive_features | 57 | 3.150 | 4.099 | 0.895 | 1.575 |
| 2024-W10 | adaptive_expanding | 57 | 3.142 | 4.094 | 0.895 | 1.571 |
| 2024-W11 | frozen_preseason | 62 | 5.194 | 8.110 | 0.774 | 2.597 |
| 2024-W11 | frozen_weights_adaptive_features | 62 | 4.702 | 7.359 | 0.774 | 2.351 |
| 2024-W11 | adaptive_expanding | 62 | 4.700 | 7.352 | 0.774 | 2.350 |
| 2024-W12 | frozen_preseason | 51 | 4.269 | 5.797 | 0.824 | 2.134 |
| 2024-W12 | frozen_weights_adaptive_features | 51 | 4.269 | 5.569 | 0.765 | 2.134 |
| 2024-W12 | adaptive_expanding | 51 | 4.258 | 5.547 | 0.765 | 2.129 |
| 2024-W13 | frozen_preseason | 72 | 4.143 | 5.693 | 0.833 | 2.071 |
| 2024-W13 | frozen_weights_adaptive_features | 72 | 3.866 | 5.171 | 0.778 | 1.933 |
| 2024-W13 | adaptive_expanding | 72 | 3.857 | 5.164 | 0.792 | 1.929 |
| 2024-W14 | frozen_preseason | 56 | 3.271 | 4.038 | 0.929 | 1.636 |
| 2024-W14 | frozen_weights_adaptive_features | 56 | 3.328 | 4.121 | 0.911 | 1.664 |
| 2024-W14 | adaptive_expanding | 56 | 3.338 | 4.127 | 0.911 | 1.669 |
| 2024-W15 | frozen_preseason | 59 | 3.626 | 4.712 | 0.898 | 1.813 |
| 2024-W15 | frozen_weights_adaptive_features | 59 | 3.553 | 4.548 | 0.847 | 1.776 |
| 2024-W15 | adaptive_expanding | 59 | 3.565 | 4.557 | 0.814 | 1.782 |
| 2024-W16 | frozen_preseason | 63 | 3.673 | 4.622 | 0.873 | 1.836 |
| 2024-W16 | frozen_weights_adaptive_features | 63 | 3.394 | 4.205 | 0.921 | 1.697 |
| 2024-W16 | adaptive_expanding | 63 | 3.406 | 4.204 | 0.921 | 1.703 |
| 2024-W17 | frozen_preseason | 63 | 4.560 | 5.997 | 0.794 | 2.280 |
| 2024-W17 | frozen_weights_adaptive_features | 63 | 4.267 | 5.651 | 0.810 | 2.133 |
| 2024-W17 | adaptive_expanding | 63 | 4.261 | 5.646 | 0.794 | 2.130 |
| 2024-W18 | frozen_preseason | 66 | 4.394 | 5.546 | 0.773 | 2.197 |
| 2024-W18 | frozen_weights_adaptive_features | 66 | 3.616 | 4.515 | 0.879 | 1.808 |
| 2024-W18 | adaptive_expanding | 66 | 3.605 | 4.489 | 0.879 | 1.802 |

## Takeaways

- Adaptive expanding weighted MAE was `3.807` versus frozen preseason `4.045`.
- Adaptive P10-P90 coverage was `0.843` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.323` with bootstrap upper bound `-0.194`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

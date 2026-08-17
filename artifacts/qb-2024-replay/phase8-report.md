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
| 2024-W1 | frozen_preseason | 39 | 5.178 | 6.519 | 0.821 | 2.589 |
| 2024-W1 | frozen_weights_adaptive_features | 39 | 5.248 | 6.575 | 0.795 | 2.624 |
| 2024-W1 | adaptive_expanding | 39 | 5.248 | 6.575 | 0.795 | 2.624 |
| 2024-W2 | frozen_preseason | 38 | 5.051 | 6.176 | 0.816 | 2.525 |
| 2024-W2 | frozen_weights_adaptive_features | 38 | 5.182 | 6.250 | 0.789 | 2.591 |
| 2024-W2 | adaptive_expanding | 38 | 5.183 | 6.248 | 0.789 | 2.592 |
| 2024-W3 | frozen_preseason | 41 | 7.304 | 8.819 | 0.829 | 3.652 |
| 2024-W3 | frozen_weights_adaptive_features | 41 | 7.073 | 8.271 | 0.780 | 3.536 |
| 2024-W3 | adaptive_expanding | 41 | 7.072 | 8.276 | 0.780 | 3.536 |
| 2024-W4 | frozen_preseason | 36 | 6.426 | 8.016 | 0.722 | 3.213 |
| 2024-W4 | frozen_weights_adaptive_features | 36 | 5.826 | 7.277 | 0.833 | 2.913 |
| 2024-W4 | adaptive_expanding | 36 | 5.816 | 7.280 | 0.833 | 2.908 |
| 2024-W5 | frozen_preseason | 36 | 6.883 | 8.640 | 0.750 | 3.442 |
| 2024-W5 | frozen_weights_adaptive_features | 36 | 6.326 | 8.004 | 0.833 | 3.163 |
| 2024-W5 | adaptive_expanding | 36 | 6.304 | 8.005 | 0.833 | 3.152 |
| 2024-W6 | frozen_preseason | 33 | 6.423 | 7.987 | 0.848 | 3.212 |
| 2024-W6 | frozen_weights_adaptive_features | 33 | 5.675 | 6.789 | 0.848 | 2.838 |
| 2024-W6 | adaptive_expanding | 33 | 5.667 | 6.790 | 0.848 | 2.833 |
| 2024-W7 | frozen_preseason | 42 | 6.131 | 7.517 | 0.738 | 3.066 |
| 2024-W7 | frozen_weights_adaptive_features | 42 | 5.888 | 7.109 | 0.833 | 2.944 |
| 2024-W7 | adaptive_expanding | 42 | 5.870 | 7.091 | 0.833 | 2.935 |
| 2024-W8 | frozen_preseason | 37 | 6.590 | 8.511 | 0.757 | 3.295 |
| 2024-W8 | frozen_weights_adaptive_features | 37 | 6.036 | 7.834 | 0.784 | 3.018 |
| 2024-W8 | adaptive_expanding | 37 | 6.026 | 7.834 | 0.784 | 3.013 |
| 2024-W9 | frozen_preseason | 34 | 6.982 | 8.106 | 0.824 | 3.491 |
| 2024-W9 | frozen_weights_adaptive_features | 34 | 5.682 | 6.926 | 0.853 | 2.841 |
| 2024-W9 | adaptive_expanding | 34 | 5.635 | 6.897 | 0.853 | 2.818 |
| 2024-W10 | frozen_preseason | 32 | 6.194 | 7.480 | 0.781 | 3.097 |
| 2024-W10 | frozen_weights_adaptive_features | 32 | 6.428 | 7.565 | 0.688 | 3.214 |
| 2024-W10 | adaptive_expanding | 32 | 6.435 | 7.577 | 0.688 | 3.218 |
| 2024-W11 | frozen_preseason | 33 | 8.518 | 10.128 | 0.636 | 4.259 |
| 2024-W11 | frozen_weights_adaptive_features | 33 | 7.001 | 8.555 | 0.758 | 3.501 |
| 2024-W11 | adaptive_expanding | 33 | 7.000 | 8.544 | 0.758 | 3.500 |
| 2024-W12 | frozen_preseason | 32 | 7.222 | 9.241 | 0.688 | 3.611 |
| 2024-W12 | frozen_weights_adaptive_features | 32 | 5.657 | 7.211 | 0.812 | 2.829 |
| 2024-W12 | adaptive_expanding | 32 | 5.660 | 7.199 | 0.812 | 2.830 |
| 2024-W13 | frozen_preseason | 36 | 7.747 | 10.125 | 0.694 | 3.873 |
| 2024-W13 | frozen_weights_adaptive_features | 36 | 6.727 | 8.777 | 0.750 | 3.364 |
| 2024-W13 | adaptive_expanding | 36 | 6.777 | 8.808 | 0.750 | 3.389 |
| 2024-W14 | frozen_preseason | 32 | 7.151 | 9.638 | 0.781 | 3.575 |
| 2024-W14 | frozen_weights_adaptive_features | 32 | 5.403 | 7.994 | 0.844 | 2.701 |
| 2024-W14 | adaptive_expanding | 32 | 5.406 | 7.958 | 0.844 | 2.703 |
| 2024-W15 | frozen_preseason | 43 | 8.290 | 10.202 | 0.581 | 4.145 |
| 2024-W15 | frozen_weights_adaptive_features | 43 | 7.977 | 9.566 | 0.698 | 3.988 |
| 2024-W15 | adaptive_expanding | 43 | 7.985 | 9.507 | 0.698 | 3.993 |
| 2024-W16 | frozen_preseason | 35 | 7.056 | 9.176 | 0.743 | 3.528 |
| 2024-W16 | frozen_weights_adaptive_features | 35 | 5.503 | 6.964 | 0.829 | 2.752 |
| 2024-W16 | adaptive_expanding | 35 | 5.514 | 6.988 | 0.829 | 2.757 |
| 2024-W17 | frozen_preseason | 42 | 7.806 | 10.030 | 0.714 | 3.903 |
| 2024-W17 | frozen_weights_adaptive_features | 42 | 6.741 | 8.658 | 0.810 | 3.371 |
| 2024-W17 | adaptive_expanding | 42 | 6.675 | 8.629 | 0.810 | 3.337 |
| 2024-W18 | frozen_preseason | 43 | 7.516 | 9.651 | 0.721 | 3.758 |
| 2024-W18 | frozen_weights_adaptive_features | 43 | 8.025 | 9.520 | 0.721 | 4.012 |
| 2024-W18 | adaptive_expanding | 43 | 8.013 | 9.550 | 0.674 | 4.007 |

## Takeaways

- Adaptive expanding weighted MAE was `6.283` versus frozen preseason `6.921`.
- Adaptive P10-P90 coverage was `0.788` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.900` with bootstrap upper bound `-0.594`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

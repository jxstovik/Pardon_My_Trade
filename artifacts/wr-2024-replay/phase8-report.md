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
| 2024-W1 | frozen_preseason | 125 | 5.128 | 6.593 | 0.864 | 2.564 |
| 2024-W1 | frozen_weights_adaptive_features | 125 | 5.127 | 6.593 | 0.864 | 2.563 |
| 2024-W1 | adaptive_expanding | 125 | 5.127 | 6.593 | 0.864 | 2.563 |
| 2024-W2 | frozen_preseason | 124 | 5.213 | 6.679 | 0.806 | 2.607 |
| 2024-W2 | frozen_weights_adaptive_features | 124 | 5.230 | 6.676 | 0.839 | 2.615 |
| 2024-W2 | adaptive_expanding | 124 | 5.227 | 6.674 | 0.839 | 2.614 |
| 2024-W3 | frozen_preseason | 128 | 5.369 | 7.543 | 0.828 | 2.684 |
| 2024-W3 | frozen_weights_adaptive_features | 128 | 5.065 | 7.174 | 0.836 | 2.532 |
| 2024-W3 | adaptive_expanding | 128 | 5.064 | 7.177 | 0.844 | 2.532 |
| 2024-W4 | frozen_preseason | 126 | 5.358 | 6.602 | 0.817 | 2.679 |
| 2024-W4 | frozen_weights_adaptive_features | 126 | 4.806 | 5.993 | 0.865 | 2.403 |
| 2024-W4 | adaptive_expanding | 126 | 4.805 | 5.991 | 0.865 | 2.403 |
| 2024-W5 | frozen_preseason | 102 | 6.001 | 8.162 | 0.755 | 3.001 |
| 2024-W5 | frozen_weights_adaptive_features | 102 | 5.699 | 7.717 | 0.804 | 2.849 |
| 2024-W5 | adaptive_expanding | 102 | 5.696 | 7.714 | 0.804 | 2.848 |
| 2024-W6 | frozen_preseason | 114 | 5.089 | 6.461 | 0.851 | 2.544 |
| 2024-W6 | frozen_weights_adaptive_features | 114 | 4.910 | 6.196 | 0.825 | 2.455 |
| 2024-W6 | adaptive_expanding | 114 | 4.921 | 6.205 | 0.816 | 2.460 |
| 2024-W7 | frozen_preseason | 118 | 5.194 | 6.358 | 0.822 | 2.597 |
| 2024-W7 | frozen_weights_adaptive_features | 118 | 4.929 | 6.000 | 0.847 | 2.465 |
| 2024-W7 | adaptive_expanding | 118 | 4.930 | 5.998 | 0.847 | 2.465 |
| 2024-W8 | frozen_preseason | 124 | 5.593 | 7.129 | 0.798 | 2.797 |
| 2024-W8 | frozen_weights_adaptive_features | 124 | 5.027 | 6.477 | 0.871 | 2.513 |
| 2024-W8 | adaptive_expanding | 124 | 5.023 | 6.474 | 0.863 | 2.511 |
| 2024-W9 | frozen_preseason | 123 | 5.222 | 6.845 | 0.805 | 2.611 |
| 2024-W9 | frozen_weights_adaptive_features | 123 | 4.722 | 6.455 | 0.829 | 2.361 |
| 2024-W9 | adaptive_expanding | 123 | 4.726 | 6.465 | 0.829 | 2.363 |
| 2024-W10 | frozen_preseason | 106 | 5.043 | 7.445 | 0.840 | 2.521 |
| 2024-W10 | frozen_weights_adaptive_features | 106 | 4.589 | 6.887 | 0.906 | 2.295 |
| 2024-W10 | adaptive_expanding | 106 | 4.594 | 6.887 | 0.906 | 2.297 |
| 2024-W11 | frozen_preseason | 116 | 5.634 | 7.269 | 0.802 | 2.817 |
| 2024-W11 | frozen_weights_adaptive_features | 116 | 5.093 | 6.639 | 0.819 | 2.547 |
| 2024-W11 | adaptive_expanding | 116 | 5.084 | 6.630 | 0.819 | 2.542 |
| 2024-W12 | frozen_preseason | 107 | 5.069 | 6.461 | 0.841 | 2.534 |
| 2024-W12 | frozen_weights_adaptive_features | 107 | 4.515 | 6.004 | 0.879 | 2.258 |
| 2024-W12 | adaptive_expanding | 107 | 4.515 | 6.008 | 0.879 | 2.258 |
| 2024-W13 | frozen_preseason | 121 | 5.321 | 6.964 | 0.860 | 2.661 |
| 2024-W13 | frozen_weights_adaptive_features | 121 | 4.587 | 6.226 | 0.884 | 2.293 |
| 2024-W13 | adaptive_expanding | 121 | 4.589 | 6.231 | 0.884 | 2.295 |
| 2024-W14 | frozen_preseason | 95 | 6.389 | 8.890 | 0.768 | 3.194 |
| 2024-W14 | frozen_weights_adaptive_features | 95 | 5.792 | 7.889 | 0.832 | 2.896 |
| 2024-W14 | adaptive_expanding | 95 | 5.805 | 7.893 | 0.832 | 2.902 |
| 2024-W15 | frozen_preseason | 132 | 5.578 | 7.541 | 0.811 | 2.789 |
| 2024-W15 | frozen_weights_adaptive_features | 132 | 5.148 | 6.968 | 0.856 | 2.574 |
| 2024-W15 | adaptive_expanding | 132 | 5.157 | 6.974 | 0.848 | 2.579 |
| 2024-W16 | frozen_preseason | 122 | 5.119 | 6.825 | 0.844 | 2.559 |
| 2024-W16 | frozen_weights_adaptive_features | 122 | 4.311 | 5.850 | 0.902 | 2.155 |
| 2024-W16 | adaptive_expanding | 122 | 4.311 | 5.849 | 0.902 | 2.156 |
| 2024-W17 | frozen_preseason | 129 | 6.204 | 8.642 | 0.798 | 3.102 |
| 2024-W17 | frozen_weights_adaptive_features | 129 | 5.254 | 7.206 | 0.837 | 2.627 |
| 2024-W17 | adaptive_expanding | 129 | 5.247 | 7.203 | 0.829 | 2.623 |
| 2024-W18 | frozen_preseason | 120 | 5.939 | 7.789 | 0.775 | 2.969 |
| 2024-W18 | frozen_weights_adaptive_features | 120 | 4.894 | 6.538 | 0.825 | 2.447 |
| 2024-W18 | adaptive_expanding | 120 | 4.898 | 6.546 | 0.825 | 2.449 |

## Takeaways

- Adaptive expanding weighted MAE was `4.976` versus frozen preseason `5.462`.
- Adaptive P10-P90 coverage was `0.850` against the nominal 0.80 interval.
- The paired weekly RMSE delta was `-0.594` with bootstrap upper bound `-0.420`.
- The difference between frozen weights with updated features and adaptive retraining should guide the next modeling investment; a small difference favors better features over more frequent refits.
- Source gaps and missing availability evidence are denominators, not evidence that the unavailable provider or player was uninformative.

## Limitations

- Historical weekly ESPN and FFToday captures were unavailable and remain explicit source gaps.
- News attribution is ready for timestamped structured events but no such file is assumed or synthesized.
- The player_stats release does not provide a complete historical availability panel; missing rows are not treated as injury evidence.
- Promotion is a benchmark decision, not an automatic runtime model activation.

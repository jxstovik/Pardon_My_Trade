# Week 5 2026 model refresh

This directory contains an isolated candidate refresh for the Pardon My Trade scout report. It fits six position models (QB, RB, WR, TE, K, D/ST), validates on 2025, then refits through 2026 Week 4. It does not overwrite or promote PMT's installed model state.

## Inputs and rerun

The script expects `stats_player_week_2010.csv.gz` through `stats_player_week_2025.csv.gz`, `stats_player_week_2026.csv`, and `games.csv.gz` in `/tmp/pmt-nflverse-2026` by default. Set `PMT_NFLVERSE_DATA_DIR` to another directory containing those files to rerun. The weekly player data are published by [nflverse](https://github.com/nflverse/nflverse-data/releases/tag/player_stats). The 2026 CSV used here has SHA-256 `4783f7c943064e80793d221edfd5db211303a69a32a0bcad9c3176b1e4a8b7cb` and contains Weeks 1–4.

Use Python 3.12+ with `numpy`, `pandas`, and LightGBM 4.7.0, then run:

```sh
python refresh_week5.py
```

Outputs include serialized LightGBM models (`*_final_*.txt`), holdout metrics, the input and model manifest, per-player forecast CSV/JSON, and HTML/Markdown scout reports. The K and D/ST targets use the ESPN weights read from the live league settings; nflverse does not separately identify rare D/ST 1-point safeties, so that event is omitted.

## Interpretation

Player means come from the fitted regression heads. Player distributions come from separately fitted quantile heads and are anchored to those mean outputs. Team and opponent simulations use independent player draws; they do not model shared game scripts or late injury news. Ja'Marr Chase active is the baseline; the inactive result is a separate sensitivity case, with no play probability assumed.

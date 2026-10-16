import csv
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from evaluate_raw import load_games, replay_observed_outcomes, replay_predictions
from raw_stats import stat_columns


class EvaluationInputsTests(unittest.TestCase):
    def test_load_games_rejects_missing_raw_stat_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "stats_player_week_2024.csv.gz"
            with gzip.open(file, "wt", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["player_id", "season", "week", "position", "season_type", "fantasy_points_ppr"])
                writer.writeheader()
                writer.writerow({"player_id": "1", "season": 2024, "week": 1, "position": "WR", "season_type": "REG", "fantasy_points_ppr": "1"})
            with self.assertRaisesRegex(ValueError, "missing raw stats"):
                load_games(Path(tmp), [2024])

    def test_load_games_rejects_blank_stat_not_silent_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "stats_player_week_2024.csv.gz"
            fields = ["player_id", "season", "week", "position", "season_type", "fantasy_points_ppr", *stat_columns()]
            row = {key: "0" for key in fields}
            row.update(player_id="p", season="2024", week="1", position="WR", season_type="REG", targets="")
            with gzip.open(file, "wt", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fields)
                writer.writeheader()
                writer.writerow(row)
            with self.assertRaisesRegex(ValueError, "blank raw stat"):
                load_games(Path(tmp), [2024])

    def test_replay_only_uses_selected_regime_and_valid_historical_cutoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            replay = root / "wr-2024-replay"
            replay.mkdir()
            entries = [
                {"player_id": "p", "target_period": "2024-W1", "position": "WR", "regime": "adaptive_expanding", "mean": 8, "prediction_cutoff": "2024-09-04T08:00:00-04:00"},
                {"player_id": "p", "target_period": "2024-W1", "position": "WR", "regime": "frozen_preseason", "mean": 10, "prediction_cutoff": "2024-09-04T08:00:00-04:00"},
            ]
            (replay / "weekly-predictions.jsonl").write_text("\n".join(json.dumps(x) for x in entries))
            for position in ("qb", "rb", "te"):
                other = root / f"{position}-2024-replay"
                other.mkdir()
                (other / "weekly-predictions.jsonl").write_text("")
            preds = replay_predictions(root, "frozen_preseason")
            self.assertEqual(preds[("p", 2024, 1, "WR")], 10)
            self.assertEqual(len(preds), 1)
    def test_post_new_year_week_18_cutoff_is_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for position in ("qb", "rb", "wr", "te"):
                other = root / f"{position}-2024-replay"
                other.mkdir()
                (other / "weekly-predictions.jsonl").write_text(
                    json.dumps({"player_id": "p", "target_period": "2024-W18", "position": position.upper(),
                                "regime": "adaptive_expanding", "mean": 5,
                                "prediction_cutoff": "2025-01-03T08:00:00-05:00"}) if position == "wr" else "")
            self.assertEqual(replay_predictions(root)[("p", 2024, 18, "WR")], 5)
    def test_replay_cross_position_player_id_is_not_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for position in ("qb", "rb", "wr", "te"):
                other = root / f"{position}-2024-replay"
                other.mkdir()
                value = ({"player_id": "p", "target_period": "2024-W1", "position": position.upper(),
                          "regime": "adaptive_expanding", "mean": 7,
                          "prediction_cutoff": "2024-09-04T08:00:00-04:00"})
                (other / "weekly-predictions.jsonl").write_text(json.dumps(value) if position in ("wr", "te") else "")
            self.assertEqual(len(replay_predictions(root)), 2)

    def test_replay_outcomes_only_include_observed_legacy_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for position in ("qb", "rb", "wr", "te"):
                other = root / f"{position}-2024-replay"
                other.mkdir()
                rows = ([{"player_id": "a", "target_period": "2024-W1", "actual_points": 0},
                         {"player_id": "b", "target_period": "2024-W1", "actual_points": None}]
                        if position == "wr" else [])
                (other / "weekly-outcomes.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
            outcomes = replay_observed_outcomes(root)
            self.assertEqual(outcomes, {("a", 2024, 1, "WR"): 0.0})


if __name__ == "__main__":
    unittest.main()

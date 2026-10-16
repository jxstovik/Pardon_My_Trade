import unittest

from evaluate_props import brier_probabilities


class PropBacktestTests(unittest.TestCase):
    def test_probability_is_calculated_from_samples_and_not_a_hypothetical_price(self):
        rows = [{"player_id": "p", "season": 2025, "week": 1, "position": "TE",
                 "stats": {"targets": 5, "receptions": 3},
                 "actual_stats": {"receptions": 4}}]
        residuals = [{"targets": 1, "receptions": 2},
                     {"targets": -1, "receptions": -1}]
        report = brier_probabilities(rows, residuals, "receptions", 3.5, baseline=0.25,
                                     samples=2)
        self.assertEqual(report["n"], 1)
        self.assertEqual(report["model_brier"], 0.25)
        self.assertEqual(report["baseline_brier"], 0.5625)
        self.assertEqual(report["event_rate"], 1)

    def test_player_prior_event_baseline_is_scored_on_same_observed_rows(self):
        row = {"player_id": "p", "season": 2025, "week": 1, "position": "TE",
               "stats": {"targets": 5, "receptions": 3},
               "actual_stats": {"receptions": 4}, "rolling_event_probability": 0.75}
        result = brier_probabilities([row], [{"targets": 0, "receptions": 1}], "receptions", 3.5,
                                     baseline=0.25, samples=1)
        self.assertEqual(result["rolling_event_brier"], 0.0625)


if __name__ == "__main__":
    unittest.main()

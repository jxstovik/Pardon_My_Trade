import unittest

from evaluate_opportunity import matched_comparison, stat_comparison
from raw_stats import OpportunityRateModel


class OpportunityComparisonTests(unittest.TestCase):
    def test_matched_comparison_excludes_unobserved_replay_candidates(self):
        rows = [{"player_id": "a", "season": 2024, "week": 1, "position": "WR", "actual": 12, "raw": 10},
                {"player_id": "b", "season": 2024, "week": 1, "position": "WR", "actual": 0, "raw": 99}]
        prior = {("a", 2024, 1, "WR"): 8, ("b", 2024, 1, "WR"): 2}
        observed = {("a", 2024, 1, "WR"): 12}
        matched = matched_comparison(rows, prior, observed)
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["actual"], 12)
        self.assertEqual(matched[0]["baseline"], 8)

    def test_stat_baseline_uses_only_games_before_target_week(self):
        history = [{"player_id": "p", "season": 2022, "week": 1, "position": "WR", "targets": 2},
                   {"player_id": "p", "season": 2025, "week": 2, "position": "WR", "targets": 20}]
        model = OpportunityRateModel(history, prior_seasons=(2022,), rate_shrink=0)
        pred = {"player_id": "p", "season": 2025, "week": 2, "position": "WR",
                "stats": {"targets": 5}, "actual_stats": {"targets": 20}}
        result = stat_comparison([pred], model, "targets", 2)
        self.assertEqual(result[0]["baseline"], 2)
        self.assertEqual((result[0]["actual"], result[0]["raw"]), (20, 5))


if __name__ == "__main__":
    unittest.main()

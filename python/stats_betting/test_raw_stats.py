"""Behavioral checks for as-of raw-stat forecasts (stdlib unittest)."""
import math
import unittest

from raw_stats import OpportunityRateModel, RawStatModel, fantasy_ppr, evaluate, paired_week_bootstrap, sample_raw_outcomes, stat_columns


class RawStatsTests(unittest.TestCase):
    def test_raw_stats_are_forecast_without_using_target_week(self):
        rows = [
            {"player_id": "p", "season": 2022, "week": w, "position": "WR", "targets": v,
             "receptions": v / 2, "receiving_yards": v * 8, "receiving_tds": 0,
             "fantasy_points_ppr": 0}
            for w, v in [(1, 2), (2, 4), (3, 6)]
        ]
        model = RawStatModel(rows, prior_seasons=(2022,), recency=1, shrink=0)
        before = model.predict("p", "WR", 2022, 3)
        changed = [*rows[:2], {**rows[2], "targets": 600}]
        after = RawStatModel(changed, prior_seasons=(2022,), recency=1, shrink=0).predict("p", "WR", 2022, 3)
        self.assertEqual(before["targets"], after["targets"])
        self.assertEqual(before["targets"], 3)
        self.assertEqual(before["receptions"], 1.5)
        self.assertLessEqual(before["receptions"], before["targets"])

    def test_opportunity_rate_model_scales_receptions_and_yards_with_targets(self):
        rows = [{"player_id": "p", "season": 2022, "week": w, "position": "WR", "targets": 10,
                 "receptions": 6, "receiving_yards": 90, "receiving_tds": 1}
                for w in (1, 2, 3)]
        model = OpportunityRateModel(rows, prior_seasons=(2022,), recency=1, shrink=0, rate_shrink=0)
        pred = model.predict("p", "WR", 2022, 4)
        self.assertEqual((pred["targets"], pred["receptions"], pred["receiving_yards"]), (10, 6, 90))
        future_changed = rows + [{**rows[-1], "week": 4, "receiving_yards": 900}]
        unchanged = OpportunityRateModel(future_changed, prior_seasons=(2022,), recency=1,
                                          shrink=0, rate_shrink=0).predict("p", "WR", 2022, 4)
        self.assertEqual(pred, unchanged)

    def test_scoring_raw_stats_matches_ppr_for_example(self):
        stats = {k: 0 for k in stat_columns()}
        stats.update(passing_yards=250, passing_tds=2, passing_interceptions=1,
                     rushing_yards=40, rushing_tds=1, receptions=5, receiving_yards=60,
                     receiving_tds=1, rushing_fumbles_lost=1)
        self.assertEqual(fantasy_ppr(stats), 41)

    def test_sack_fumble_is_a_turnover_in_ppr_diagnostic(self):
        self.assertEqual(fantasy_ppr({"sack_fumbles_lost": 1}), -2)

    def test_model_keeps_total_fumbles_separate_from_lost_components(self):
        rows = [{"player_id": "p", "season": 2022, "week": 1, "position": "QB",
                 "fumbles_total": 3, "fumbles_lost_total": 2, "sack_fumbles_lost": 1}]
        result = RawStatModel(rows, prior_seasons=(2022,), shrink=0).predict("p", "QB", 2022, 2)
        self.assertEqual((result["fumbles_total"], result["fumbles_lost_total"]), (3, 2))

    def test_model_cannot_project_lost_fumbles_above_total(self):
        rows = [{"player_id": "p", "season": 2022, "week": 1, "position": "QB",
                 "fumbles_total": 1, "fumbles_lost_total": 2}]
        result = RawStatModel(rows, prior_seasons=(2022,), shrink=0).predict("p", "QB", 2022, 2)
        self.assertEqual(result["fumbles_lost_total"], result["fumbles_total"])

    def test_metrics_are_scored_on_identical_rows_and_reject_missing(self):
        scores = evaluate([{"actual": 10, "raw": 11, "baseline": 8},
                           {"actual": 0, "raw": 1, "baseline": 4}])
        self.assertEqual(scores["n"], 2)
        self.assertEqual(scores["raw_mae"], 1)
        self.assertEqual(scores["baseline_mae"], 3)
        with self.assertRaises(ValueError):
            evaluate([{"actual": 1, "raw": math.nan, "baseline": 0}])

    def test_week_block_bootstrap_repeats_only_observed_weeks(self):
        rows = [{"week": 1, "actual": 10, "raw": 10, "baseline": 12},
                {"week": 2, "actual": 4, "raw": 4, "baseline": 5}]
        result = paired_week_bootstrap(rows, resamples=101, seed=8)
        self.assertEqual(result["baseline_mae_minus_raw_mae"], 1.5)
        self.assertGreaterEqual(result["ci95_low"], 1)
        self.assertLessEqual(result["ci95_high"], 2)

    def test_scenarios_preserve_empirical_joint_stat_residuals(self):
        forecast = {"targets": 6, "receptions": 3}
        residuals = [{"targets": 4, "receptions": 2},
                     {"targets": -2, "receptions": -1}]
        scenarios = sample_raw_outcomes(forecast, residuals, n=2, seed=1)
        self.assertEqual({(s["targets"], s["receptions"]) for s in scenarios}, {(10, 5), (4, 2)})
        self.assertEqual(scenarios, sample_raw_outcomes(forecast, residuals, n=2, seed=1))

    def test_scenarios_cannot_lose_more_fumbles_than_occur(self):
        sample = sample_raw_outcomes({"fumbles_total": 1, "fumbles_lost_total": 1},
                                     [{"fumbles_total": -1, "fumbles_lost_total": 2}], n=1)[0]
        self.assertEqual((sample["fumbles_total"], sample["fumbles_lost_total"]), (0, 0))


if __name__ == "__main__":
    unittest.main()

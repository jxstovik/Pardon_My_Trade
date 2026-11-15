"""Deterministic causal-boundary regression tests (no training/network)."""
import unittest
import pandas as pd
import weekly_scout as scout

class WeeklyReliability(unittest.TestCase):
    def test_completed_rows_exclude_forecast_and_future_seasons(self):
        rows = pd.DataFrame({'season':[2025,2026,2026,2027], 'week':[18,7,8,1]})
        scout.TARGET_WEEK=8
        scout.CUTOFF_WEEK=7
        actual=scout.completed_rows(rows)
        self.assertEqual(list(zip(actual.season,actual.week)),[(2025,18),(2026,7)])

    def test_unmatched_out_identity_is_explicit_unavailable_not_estimated(self):
        item={'name':'Zach Charbonnet','position':'RB','status':'O','espnId':'fixture','teamId':'1'}
        forecast=scout.unavailable_forecast(item)
        self.assertEqual(forecast['mean'],0)
        self.assertFalse(forecast['statisticalForecast'])
        self.assertEqual(forecast['opponent'],'UNKNOWN')
        self.assertIsNone(scout.unavailable_forecast({**item,'status':'—'}))

    def test_cutoff_requires_every_published_completed_game(self):
        scout.TARGET_WEEK=8; scout.CUTOFF_WEEK=7
        games=pd.DataFrame({'season':[2026,2026], 'week':[7,7], 'game_type':['REG','REG'], 'game_id':['a','b'], 'home_score':[20,14], 'away_score':[10,7]})
        stats=pd.DataFrame({'season':[2026], 'week':[7], 'game_id':['a']})
        with self.assertRaisesRegex(ValueError,'missing.*b'):
            scout.validate_completed_coverage(stats,games)
        actual=scout.validate_completed_coverage(pd.concat([stats,stats.assign(game_id='b')]),games)
        self.assertEqual(actual['cutoffWeek'],7)
        self.assertEqual(actual['completedGames'],2)

if __name__=='__main__': unittest.main()

import unittest,json
from pathlib import Path
from dst_scoring import score_espn_stats,canonical_targets
from calibration import chronological_calibration,conformal_offset
class Repairs(unittest.TestCase):
 def test_dst_override_and_component_validation(self):
  items=[{'statId':96,'points':0,'pointsOverrides':{'16':2}},{'statId':99,'points':1},{'statId':72,'points':-2}]
  self.assertEqual(score_espn_stats({'96':2,'99':3},items),7)
  bad={'season':2026,'scoring':{'scoringItems':items},'leagueActuals':[{'name':'Bills D/ST','week':1,'actual':8,'rawStats':{'96':2,'99':3}}]}
  with self.assertRaises(ValueError):canonical_targets(bad)
 def test_chronological_intervals_do_not_use_target_or_future_outcomes(self):
  q={'5':0,'10':1,'25':3,'50':5,'75':7,'90':9,'95':10}
  rows=[{'name':str(i),'rank':i+1,'week':1,'predicted':5,'actual':12,'quantiles':q} for i in range(5)]+[{'name':'holdout','rank':1,'week':2,'predicted':5,'actual':1000,'quantiles':q}]
  a,f=chronological_calibration(rows);hold=a[-1];self.assertEqual(hold['calibrationOffset'],3);self.assertEqual(hold['quantiles']['90'],12);self.assertEqual(hold['predicted'],5);self.assertEqual(hold['calibrationMaxWeek'],1)
  rows[-1]['actual']=-1000;b,_=chronological_calibration(rows);self.assertEqual(hold['quantiles'],b[-1]['quantiles']);self.assertEqual(list(hold['quantiles'].values()),sorted(hold['quantiles'].values()))
 def test_historical_dst_reconstruction_credits_recoveries_and_excludes_defensive_scores(self):
  import weekly_scout as m
  import pandas as pd
  stats=pd.DataFrame([{'season':2020,'week':1,'game_id':'g','team':'BUF','def_sacks':1,'def_fumbles':2,'fumble_recovery_opp':1,'fumble_recovery_tds':1,'passing_yards':100,'rushing_yards':50,'sack_yards_lost':-10,'fumbles_lost_total':0},{'season':2020,'week':1,'game_id':'g','team':'NE','def_tds':1,'fumble_recovery_opp':0,'passing_yards':200,'rushing_yards':60,'sack_yards_lost':-10,'fumbles_lost_total':2}])
  games=pd.DataFrame([{'season':2020,'week':1,'game_id':'g','game_type':'REG','home_team':'BUF','away_team':'NE','home_score':7,'away_score':20}])
  row=m.dst_team_games(stats,games).query('team == "BUF"').iloc[0]
  self.assertEqual(row.points_allowed,14);self.assertEqual(row.def_fumbles,1);self.assertEqual(row.points,12)
 def test_insufficient_data_is_explicit(self):self.assertIsNone(conformal_offset([]));self.assertIsNone(conformal_offset([{'actual':0,'quantiles':{'10':0,'90':1}}]))
if __name__=='__main__':unittest.main()

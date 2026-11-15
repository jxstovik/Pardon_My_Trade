import unittest
import pandas as pd
import numpy as np
from waiver_horizon import forecast_horizon

class Model:
    def __init__(self): self.inputs=[]
    def predict(self, frame):
        self.inputs.append(frame.copy())
        return np.repeat(10.,len(frame))

class HorizonTests(unittest.TestCase):
    def test_future_outcomes_are_rejected(self):
        off=pd.DataFrame([{'season':2026,'week':8}])
        dst=pd.DataFrame([{'season':2026,'week':7}])
        games=pd.DataFrame([{'season':2026,'game_type':'REG','week':8,'home_team':'BUF','away_team':'NE'}])
        with self.assertRaisesRegex(ValueError,'Future outcomes'):
            forecast_horizon([],games,off,dst,off,dst,{}, {},[],[],8,7)

    def test_schedule_byes_opponent_context_and_health_haircut(self):
        games=pd.DataFrame([{'season':2026,'game_type':'REG','week':8,'home_team':'BUF','away_team':'NE'}, {'season':2026,'game_type':'REG','week':10,'home_team':'BUF','away_team':'NYJ'}])
        off=pd.DataFrame([{'season':2026,'week':7,'player_id':'p','opponent_team':'NE','position':'QB','points':17,'opp_allow_roll4':999,'opp_allow_season':999}])
        hist=pd.concat([off,off.assign(opponent_team='NYJ',points=5)],ignore_index=True)
        dst=pd.DataFrame([{'season':2026,'week':7}])
        model=Model()
        forecasts=[{'espnId':'123','player':'p','team':'BUF','position':'QB','status':'Q'}]
        out=forecast_horizon(forecasts,games,off,dst,hist,dst,{'QB':{'final_mean':model, **{f'final_q{q:02d}': Model() for q in [5,10,25,50,75,90,95]}}}, {},['week','opp_allow_roll4'],[],8,7)
        weeks=out['players'][0]['weeks']
        self.assertEqual([w['mean'] for w in weeks[:3]],[5.,0.,5.])
        self.assertEqual(list(model.inputs[0].opp_allow_roll4),[17.,5.])
        self.assertEqual(list(model.inputs[0].week),[8,10])
        self.assertEqual(len(weeks),11)
        healthy = forecast_horizon([{**f, 'status': '—'} for f in forecasts], games,
                                   off, dst, hist, dst,
                                   {'QB': {'final_mean': Model(), **{f'final_q{q:02d}': Model() for q in [5,10,25,50,75,90,95]}}},
                                   {}, ['week','opp_allow_roll4'], [], 8, 7)
        self.assertEqual([w['mean'] for w in healthy['players'][0]['weeks'][:3]], [10., 0., 10.])
        self.assertEqual(forecasts[0]['status'], 'Q')


class RelationshipTests(unittest.TestCase):
    def test_role_and_covariance_evidence_uses_only_paired_completed_games(self):
        from waiver_horizon import roster_relationships
        rows=[]
        for week in range(1,9):
            common={'season':2026,'week':week,'game_id':f'g{week}','team':'BUF','season_points_avg':5.}
            if week<=6: rows.append({**common,'player_id':'lead','position':'RB','points':20.,'touches':15.})
            rows.append({**common,'player_id':'backup','position':'RB','points':15.+week-7 if week>=7 else 2.,'touches':15. if week>=7 else 1.})
            rows.append({**common,'player_id':'q','position':'QB','points':20.+week,'touches':0.})
            rows.append({**common,'player_id':'wr','position':'WR','points':10.+2*week,'touches':5.})
        history=pd.DataFrame(rows)
        games=pd.DataFrame([{'season':2026,'week':w,'game_type':'REG','game_id':f'g{w}','home_team':'BUF','away_team':'NE'} for w in range(1,10)])
        forecasts=[{'espnId':'1','player':'lead','position':'RB','team':'BUF','teamId':'7'},
                    {'espnId':'2','player':'backup','position':'RB','team':'BUF','available':True},
                    {'espnId':'3','player':'q','position':'QB','team':'BUF','teamId':'7'},
                    {'espnId':'4','player':'wr','position':'WR','team':'BUF','available':True}]
        args=(forecasts,games,pd.DataFrame(),history,{(9,'BUF'):'NE'},9,8)
        handcuffs,correlations=roster_relationships(*args)
        self.assertEqual(len(handcuffs),1)
        self.assertEqual(handcuffs[0]['gameIds'],['g7','g8'])
        self.assertEqual(handcuffs[0]['probability'],.25)
        self.assertEqual(handcuffs[0]['conditionalWeeks'][0]['mean'],15.5)
        self.assertEqual(handcuffs[0]['conditionalWeeks'][1]['mean'],0.)
        self.assertEqual(correlations[0]['sampleGames'],8)
        future=history.iloc[-1:].assign(week=9,game_id='g9',points=-100000.)
        repeated=roster_relationships(forecasts,games,pd.DataFrame(),pd.concat([history,future]),{(9,'BUF'):'NE'},9,8)
        self.assertEqual((handcuffs,correlations),repeated)

if __name__=='__main__': unittest.main()

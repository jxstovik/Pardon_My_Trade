import type { PlayerPosition } from "../../models/types.js";

export interface EspnScoringItem {
  readonly statId?: number;
  readonly points?: number;
  readonly pointsOverrides?: Record<string, number>;
}

const OFFENSE: PlayerPosition[] = ["QB", "RB", "WR", "TE"];
const RETURNERS: PlayerPosition[] = [...OFFENSE, "K", "DST"];
const K: PlayerPosition[] = ["K"];
const DST: PlayerPosition[] = ["DST"];

/** ESPN stat IDs, not lineup slots. Tier stats are event indicators/probabilities,
 * not points/yards totals: retain each tier to avoid inventing a preset or
 * applying a nonlinear tier to an expected points/yards-allowed value.
 * ID meanings: espn-api/football/constant.py SETTINGS_SCORING_FORMAT_MAP.
 * Weights always come from the league's live mSettings, never this dictionary.
 */
export const ESPN_SCORING_STATS: Readonly<Record<number, { stat: string; positions: PlayerPosition[] }>> = {
  3: { stat: "passing_yards", positions: ["QB"] },
  4: { stat: "passing_touchdowns", positions: ["QB"] },
  19: { stat: "passing_two_point_conversions", positions: ["QB"] },
  20: { stat: "interceptions", positions: ["QB"] },
  24: { stat: "rushing_yards", positions: OFFENSE },
  25: { stat: "rushing_touchdowns", positions: OFFENSE },
  26: { stat: "rushing_two_point_conversions", positions: OFFENSE },
  42: { stat: "receiving_yards", positions: ["RB", "WR", "TE"] },
  43: { stat: "receiving_touchdowns", positions: ["RB", "WR", "TE"] },
  44: { stat: "receiving_two_point_conversions", positions: OFFENSE },
  53: { stat: "receptions", positions: ["RB", "WR", "TE"] },
  63: { stat: "fumble_recovery_touchdowns", positions: OFFENSE },
  72: { stat: "fumbles_lost", positions: OFFENSE },
  77: { stat: "field_goals_40_49", positions: K },
  80: { stat: "field_goals_0_39", positions: K },
  85: { stat: "field_goals_missed", positions: K },
  86: { stat: "extra_points", positions: K },
  88: { stat: "extra_points_missed", positions: K },
  89: { stat: "points_allowed_0", positions: DST },
  90: { stat: "points_allowed_1_6", positions: DST },
  91: { stat: "points_allowed_7_13", positions: DST },
  92: { stat: "points_allowed_14_17", positions: DST },
  93: { stat: "blocked_kick_return_touchdowns", positions: DST },
  95: { stat: "defensive_interceptions", positions: DST },
  96: { stat: "defensive_fumble_recoveries", positions: DST },
  97: { stat: "blocked_kicks", positions: DST },
  98: { stat: "safeties", positions: DST },
  99: { stat: "sacks", positions: DST },
  101: { stat: "kickoff_return_touchdowns", positions: RETURNERS },
  102: { stat: "punt_return_touchdowns", positions: RETURNERS },
  103: { stat: "def_interception_td", positions: DST },
  104: { stat: "def_fumble_td", positions: DST },
  123: { stat: "points_allowed_28_34", positions: DST },
  124: { stat: "points_allowed_35_45", positions: DST },
  125: { stat: "points_allowed_46_plus", positions: DST },
  128: { stat: "yards_allowed_0_99", positions: DST },
  129: { stat: "yards_allowed_100_199", positions: DST },
  130: { stat: "yards_allowed_200_299", positions: DST },
  132: { stat: "yards_allowed_350_399", positions: DST },
  133: { stat: "yards_allowed_400_449", positions: DST },
  134: { stat: "yards_allowed_450_499", positions: DST },
  135: { stat: "yards_allowed_500_549", positions: DST },
  136: { stat: "yards_allowed_550_plus", positions: DST },
  198: { stat: "field_goals_50_59", positions: K },
  201: { stat: "field_goals_60_plus", positions: K },
  206: { stat: "two_point_returns", positions: RETURNERS },
  209: { stat: "one_point_safeties", positions: RETURNERS }
};

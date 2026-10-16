"""As-of, conditional-on-recorded-game NFL player raw-stat forecaster.

All data are observed player-game rows. This is NOT an availability model: an
unlisted inactive player is not a zero, and results must not be called an
unconditional bet probability. Use an external status model before wagering.
"""
from __future__ import annotations

from bisect import bisect_left
from collections import defaultdict
from math import isfinite, sqrt
from random import Random

STATS = (
    "attempts", "completions", "passing_yards", "passing_tds",
    "passing_interceptions", "sack_fumbles_lost", "carries", "rushing_yards", "rushing_tds",
    "rushing_fumbles_lost", "fumbles_total", "fumbles_lost_total", "targets", "receptions", "receiving_yards",
    "receiving_tds", "receiving_fumbles_lost", "passing_2pt_conversions",
    "rushing_2pt_conversions", "receiving_2pt_conversions", "special_teams_tds",
)


def stat_columns() -> tuple[str, ...]:
    return STATS


def fantasy_ppr(stats: dict[str, float]) -> float:
    """Conventional PPR diagnostic only; never a substitute for league rules."""
    s = lambda key: float(stats.get(key, 0) or 0)
    return (0.04 * s("passing_yards") + 4 * s("passing_tds")
            - 2 * s("passing_interceptions") + 0.1 * s("rushing_yards")
            + 6 * s("rushing_tds") + 0.1 * s("receiving_yards")
            + 6 * s("receiving_tds") + s("receptions")
            - 2 * (s("sack_fumbles_lost") + s("rushing_fumbles_lost")
                   + s("receiving_fumbles_lost"))
            + 2 * (s("passing_2pt_conversions") + s("rushing_2pt_conversions")
                   + s("receiving_2pt_conversions")) + 6 * s("special_teams_tds"))


class RawStatModel:
    """Frozen prior-position pool, player recency plus preceding-season shrinkage.

    `prior_seasons` must strictly precede evaluation season. A single season's
    weeks may be updated in order, but no current/future week enters features.
    """

    def __init__(self, rows: list[dict], prior_seasons: tuple[int, ...],
                 recency: float = 0.7, shrink: float = 4.0, lag: int = 4):
        if not 0 <= recency <= 1 or shrink < 0 or lag < 1:
            raise ValueError("invalid forecaster hyperparameters")
        self.recency, self.shrink, self.lag = recency, shrink, lag
        self.by_player: dict[str, list[dict]] = defaultdict(list)
        pool: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            if not row.get("player_id") or not row.get("position"):
                raise ValueError("player ID and position required")
            self.by_player[row["player_id"]].append(row)
            if row["season"] in prior_seasons:
                pool[row["position"]].append(row)
        self.keys = {}
        for player, history in self.by_player.items():
            history.sort(key=lambda row: (row["season"], row["week"]))
            keys = [(r["season"], r["week"]) for r in history]
            if len(set(keys)) != len(keys):
                raise ValueError(f"duplicate player-week: {player}")
            self.keys[player] = keys
        self.position_means = {
            position: {stat: sum(float(row.get(stat, 0) or 0) for row in group) / len(group)
                       for stat in STATS}
            for position, group in pool.items()
        }

    def predict(self, player_id: str, position: str, season: int, week: int) -> dict[str, float]:
        history = self.by_player.get(player_id, ())
        index = bisect_left(self.keys.get(player_id, ()), (season, week))
        earlier = history[:index]
        prior = [r for r in earlier if r["season"] == season - 1]
        recent = earlier[-self.lag:]
        position_mean = self.position_means.get(position, {})
        forecast = {}
        for stat in STATS:
            mean_pos = position_mean.get(stat, 0.0)
            mean_old = (sum(float(r.get(stat, 0) or 0) for r in prior) / len(prior)) if prior else mean_pos
            mean_recent = (sum(float(r.get(stat, 0) or 0) for r in recent) / len(recent)) if recent else mean_old
            player_mean = self.recency * mean_recent + (1 - self.recency) * mean_old
            weight = len(earlier) / (len(earlier) + self.shrink) if earlier or self.shrink else 0
            forecast[stat] = max(0.0, weight * player_mean + (1 - weight) * mean_pos)
        forecast["completions"] = min(forecast["completions"], forecast["attempts"])
        forecast["receptions"] = min(forecast["receptions"], forecast["targets"])
        forecast["fumbles_lost_total"] = min(forecast["fumbles_lost_total"], forecast["fumbles_total"])
        return forecast


class OpportunityRateModel(RawStatModel):
    """Forecast volume first, then conditional efficiency from past opportunities.

    Frozen position-rate priors plus a player's prior 16 recorded games; no
    schedule, current-week result, injury label or sportsbook line is consumed.
    """

    RATIOS = (
        ("completions", "attempts"), ("passing_yards", "attempts"),
        ("passing_tds", "attempts"), ("passing_interceptions", "attempts"),
        ("rushing_yards", "carries"), ("rushing_tds", "carries"),
        ("receptions", "targets"), ("receiving_yards", "targets"),
        ("receiving_tds", "targets"),
    )

    def __init__(self, rows: list[dict], prior_seasons: tuple[int, ...],
                 recency: float = 0.7, shrink: float = 4.0, lag: int = 4,
                 rate_shrink: float = 20.0):
        super().__init__(rows, prior_seasons, recency, shrink, lag)
        if rate_shrink < 0:
            raise ValueError("rate shrinkage must be nonnegative")
        self.rate_shrink = rate_shrink
        self.rate_prior = {}
        for position in self.position_means:
            group = [r for r in rows if r["season"] in prior_seasons and r["position"] == position]
            self.rate_prior[position] = {}
            for outcome, volume in self.RATIOS:
                opportunities = sum(float(r.get(volume, 0) or 0) for r in group)
                self.rate_prior[position][outcome] = (
                    sum(float(r.get(outcome, 0) or 0) for r in group) / opportunities
                    if opportunities else 0.0)

    def predict(self, player_id: str, position: str, season: int, week: int) -> dict[str, float]:
        stats = super().predict(player_id, position, season, week)
        history = self.by_player.get(player_id, ())
        earlier = history[:bisect_left(self.keys.get(player_id, ()), (season, week))][-16:]
        for outcome, volume in self.RATIOS:
            opportunities = sum(float(r.get(volume, 0) or 0) for r in earlier)
            successes = sum(float(r.get(outcome, 0) or 0) for r in earlier)
            prior_rate = self.rate_prior.get(position, {}).get(outcome, 0.0)
            rate = ((successes + self.rate_shrink * prior_rate) / (opportunities + self.rate_shrink)
                    if opportunities + self.rate_shrink else prior_rate)
            if outcome in ("completions", "receptions"):
                rate = min(1.0, rate)
            stats[outcome] = max(0.0, stats[volume] * rate)
        return stats


def evaluate(rows: list[dict]) -> dict:
    if not rows:
        raise ValueError("empty common forecast cohort")
    for row in rows:
        if not all(isinstance(row[k], (int, float)) and isfinite(row[k])
                   for k in ("actual", "raw", "baseline")):
            raise ValueError("missing or nonfinite outcome or prediction")
    n = len(rows)
    return {"n": n,
            **{f"{model}_{metric}": (sum(abs(row["actual"] - row[model]) for row in rows) / n
                                     if metric == "mae" else
                                     sqrt(sum((row["actual"] - row[model]) ** 2 for row in rows) / n))
               for model in ("raw", "baseline") for metric in ("mae", "rmse")}}


def paired_week_bootstrap(rows: list[dict], resamples: int = 2000, seed: int = 87) -> dict:
    """Paired difference, resampling weekly blocks rather than independent games.

    Uncertainty remains approximate: weeks are serially dependent and these
    intervals do not validate model selection or unconditional availability.
    """
    if not rows or resamples < 1:
        raise ValueError("bootstrap requires rows and positive resamples")
    weeks = sorted({r["week"] for r in rows})
    blocks = {week: [r for r in rows if r["week"] == week] for week in weeks}

    def difference(data: list[dict]) -> float:
        return sum(abs(r["actual"] - r["baseline"]) - abs(r["actual"] - r["raw"])
                   for r in data) / len(data)

    rng = Random(seed)
    samples = []
    for _ in range(resamples):
        sampled = [r for _ in weeks for r in blocks[rng.choice(weeks)]]
        samples.append(difference(sampled))
    samples.sort()
    return {"baseline_mae_minus_raw_mae": difference(rows),
            "ci95_low": samples[int(0.025 * (resamples - 1))],
            "ci95_high": samples[int(0.975 * (resamples - 1))],
            "resamples": resamples, "blocks": len(weeks)}


def sample_raw_outcomes(forecast: dict[str, float], residuals: list[dict[str, float]],
                        n: int = 256, seed: int = 87) -> list[dict[str, float]]:
    """Apply whole historic stat-residual vectors to preserve within-player covariance.

    Calibrated only for players represented in the residual cohort. It is not
    a model for team-level dependence or probability of active status.
    """
    if not residuals or n < 1:
        raise ValueError("a nonempty residual cohort and n>=1 are required")
    rng = Random(seed)
    indices = list(range(len(residuals)))
    out = []
    while len(out) < n:
        rng.shuffle(indices)
        for index in indices:
            if len(out) >= n:
                break
            shock = residuals[index]
            scenario = {key: max(0, round(float(value) + shock.get(key, 0)))
                        if key not in ("passing_yards", "rushing_yards", "receiving_yards")
                        else float(value) + shock.get(key, 0)
                        for key, value in forecast.items()}
            if "completions" in scenario and "attempts" in scenario:
                scenario["completions"] = min(scenario["completions"], scenario["attempts"])
            if "receptions" in scenario and "targets" in scenario:
                scenario["receptions"] = min(scenario["receptions"], scenario["targets"])
            if "fumbles_lost_total" in scenario and "fumbles_total" in scenario:
                scenario["fumbles_lost_total"] = min(scenario["fumbles_lost_total"], scenario["fumbles_total"])
            out.append(scenario)
    return out

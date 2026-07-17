import { PmtError } from "../errors.js";
import type { PlayerPosition } from "../models/types.js";
import type { ProjectionCandidate, ProjectionSource } from "./projection-source.js";

export interface EspnProjectionSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const STAT_MAP: Record<string, string> = {
  passingYards: "passing_yards",
  passingTouchdowns: "passing_touchdowns",
  passingInterceptions: "interceptions",
  rushingYards: "rushing_yards",
  rushingTouchdowns: "rushing_touchdowns",
  receptions: "receptions",
  receivingYards: "receiving_yards",
  receivingTouchdowns: "receiving_touchdowns"
};

const POSITION_MAP: Record<string, PlayerPosition> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  D: "DST",
  DEF: "DST",
  "D/ST": "DST"
};

interface EspnAthleteEntry {
  id?: string;
  athlete?: {
    id?: string;
    displayName?: string;
    position?: { abbreviation?: string };
    team?: { abbreviation?: string };
  };
  projections?: {
    points?: number | { total?: number };
    stats?: Array<{ name?: string; value?: number }>;
  };
}

export class EspnProjectionSource implements ProjectionSource {
  readonly name = "espn";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: EspnProjectionSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://site.web.api.espn.com/apis/site/v3/sports/football/nfl/projections";
  }

  async fetchProjections(_sport: string, season: string, scoringPeriod: string): Promise<ProjectionCandidate[]> {
    const week = parseWeek(scoringPeriod);
    const url = `${this.baseUrl}?seasontype=1&season=${encodeURIComponent(season)}&week=${week}`;
    const data = await this.getJson<EspnAthleteEntry[]>(url);
    return data.map((entry) => this.mapEntry(entry)).filter((candidate): candidate is ProjectionCandidate => candidate !== undefined);
  }

  private mapEntry(entry: EspnAthleteEntry): ProjectionCandidate | undefined {
    const athlete = entry.athlete;
    const name = athlete?.displayName;
    if (!name) return undefined;

    const team = athlete.team?.abbreviation ?? "";
    const posAbbr = athlete.position?.abbreviation;
    const positions = posAbbr ? [POSITION_MAP[posAbbr] ?? ("BN" as PlayerPosition)] : [];

    const projections = entry.projections ?? {};
    const points = typeof projections.points === "number"
      ? projections.points
      : (projections.points?.total ?? 0);

    const projected_stats: Record<string, number> = {};
    for (const stat of projections.stats ?? []) {
      const mapped = stat.name ? STAT_MAP[stat.name] : undefined;
      if (mapped && typeof stat.value === "number") {
        projected_stats[mapped] = stat.value;
      }
    }

    const rounded = Math.round(points * 100) / 100;
    return {
      name,
      team,
      positions,
      projected_stats,
      projected_points: rounded,
      floor: Math.round(rounded * 0.7 * 100) / 100,
      ceiling: Math.round(rounded * 1.3 * 100) / 100,
      confidence: 0.7
    };
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new PmtError({
        code: "ESPN_REQUEST_FAILED",
        message: `ESPN projections request to ${url} failed with status ${response.status}.`,
        source: "platform_adapter",
        retryable: response.status >= 500
      });
    }
    const parsed = (await response.json()) as { athletes?: T };
    if (!parsed.athletes) {
      throw new PmtError({
        code: "ESPN_UNEXPECTED_RESPONSE",
        message: `ESPN projections response did not include an athletes array.`,
        source: "platform_adapter",
        retryable: false
      });
    }
    return parsed.athletes;
  }
}

function parseWeek(scoringPeriod: string): number {
  const match = /(\d{4})-W(\d+)/.exec(scoringPeriod);
  if (match) return Number(match[2]);
  return 1;
}

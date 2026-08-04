import type { PlayerPosition } from "../models/types.js";
import type { ParsedTable } from "./html-table-parser.js";
import type { ProjectionCandidate } from "./projection-source.js";

/**
 * Stat keys we emit on `ProjectionCandidate.projected_stats`. Header aliases are
 * intentionally broad so both Razzball ("Rush Yds", "Rec TD") and FFToday
 * ("Rush Yds", "Rec Yds") tables map with one lookup.
 */
export const STAT_HEADER_MAP: Record<string, string> = {
  // passing
  "pass": "passing_attempts",
  "pass att": "passing_attempts",
  "pass yds": "passing_yards",
  "pass td": "passing_touchdowns",
  "pass tds": "passing_touchdowns",
  "passing att": "passing_attempts",
  "passing yds": "passing_yards",
  "passing td": "passing_touchdowns",
  "passing yds per att": "passing_yards_per_attempt",
  "int": "interceptions",
  "ints": "interceptions",
  "pass int": "interceptions",
  "interceptions": "interceptions",
  // rushing
  "rush": "rushing_attempts",
  "rush att": "rushing_attempts",
  "rush yds": "rushing_yards",
  "rush td": "rushing_touchdowns",
  "run yds": "rushing_yards",
  "run td": "rushing_touchdowns",
  "rushing att": "rushing_attempts",
  "rushing yds": "rushing_yards",
  "rushing td": "rushing_touchdowns",
  "rush atts": "rushing_attempts",
  "yds per carry": "rushing_yards_per_attempt",
  // receiving
  "rec": "receptions",
  "recs": "receptions",
  "receptions": "receptions",
  "rec yds": "receiving_yards",
  "rec yd": "receiving_yards",
  "rec td": "receiving_touchdowns",
  "rec tds": "receiving_touchdowns",
  "receiving yds": "receiving_yards",
  "receiving td": "receiving_touchdowns",
  "rec yds per rec": "receiving_yards_per_reception",
  "tgt": "targets",
  "targets": "targets",
  // misc
  "fum": "fumbles",
  "fumbles": "fumbles",
  "fum lost": "fumbles_lost",
  "fl": "fumbles_lost",
  "two pt": "two_point_conversions",
  "2pt": "two_point_conversions",
  // kicking
  "fg": "field_goals",
  "fgm": "field_goals",
  "fga": "field_goal_attempts",
  "xp": "extra_points",
  "xpm": "extra_points",
  "kick pts": "kicking_points",
  // defensive scoring (DST / IDP)
  "sack": "sacks",
  "sacks": "sacks",
  "int ret td": "def_interception_td",
  "fum ret td": "def_fumble_td",
  "def td": "def_touchdowns",
  "blk": "blocked_kicks",
  "blkd": "blocked_kicks",
  "pa": "points_allowed",
  "pts allowed": "points_allowed",
  "yds allowed": "yards_allowed",
  "takeaways": "takeaways",
  // idp
  "comb": "combined_tackles",
  "tackles": "combined_tackles",
  "solo": "solo_tackles",
  "asst": "assisted_tackles",
  "ast": "assisted_tackles",
  "pd": "passes_defended"
};

const POSITION_ALIASES: Record<string, PlayerPosition> = {
  qb: "QB",
  rb: "RB",
  wr: "WR",
  te: "TE",
  pk: "K",
  k: "K",
  def: "DST",
  dst: "DST",
  "d/st": "DST",
  "team defense": "DST",
  teamdefense: "DST",
  idp: "DST",
  dl: "DST",
  lb: "DST",
  db: "DST"
};

export function normalizePosition(raw: string | undefined, fallback: PlayerPosition): PlayerPosition {
  if (!raw) return fallback;
  const key = raw.trim().toLowerCase();
  return POSITION_ALIASES[key] ?? fallback;
}

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\b(pts?|fpts?|proj)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POINTS_HEADER_PATTERNS = [/\bfpts?\b/i, /\bpts?\b/i, /points/i, /projection/i, /projected/i, /\bscore\b/i];
const RANK_HEADER_PATTERNS = [/\brank\b/i, /\boverall\b/i, /^#$/, /\bpos\b/i, /\brk\b/i];
const PLAYER_HEADER_PATTERNS = [/player/i, /\bname\b/i];
const TEAM_HEADER_PATTERNS = [/\bteam\b/i];
const POS_HEADER_PATTERNS = [/\bpos\b/i, /position/i];
const FLOOR_HEADER_PATTERNS = [/\bfloor\b/i];
const CEILING_HEADER_PATTERNS = [/\bceil/i];

export interface ColumnRoles {
  playerIdx: number;
  teamIdx: number;
  posIdx: number;
  pointsIdx: number;
  rankIdx: number;
  floorIdx: number;
  ceilingIdx: number;
  statCols: Array<{ idx: number; key: string }>;
}

export type PointsPreference = "std" | "half" | "ppr" | "first";

export function detectColumnRoles(headers: string[], pointsPreference: PointsPreference = "first"): ColumnRoles {
  let playerIdx = -1;
  let teamIdx = -1;
  let posIdx = -1;
  let pointsIdx = -1;
  let rankIdx = -1;
  let floorIdx = -1;
  let ceilingIdx = -1;
  const statCols: Array<{ idx: number; key: string }> = [];
  const pointsCandidates: number[] = [];

  headers.forEach((header, idx) => {
    const norm = normalizeHeader(header);
    const raw = header.toLowerCase();

    if (playerIdx === -1 && PLAYER_HEADER_PATTERNS.some((re) => re.test(raw))) {
      playerIdx = idx;
      return;
    }
    if (teamIdx === -1 && TEAM_HEADER_PATTERNS.some((re) => re.test(raw))) {
      teamIdx = idx;
      return;
    }
    if (posIdx === -1 && POS_HEADER_PATTERNS.some((re) => re.test(raw))) {
      posIdx = idx;
      return;
    }
    if (floorIdx === -1 && FLOOR_HEADER_PATTERNS.some((re) => re.test(raw))) {
      floorIdx = idx;
      return;
    }
    if (ceilingIdx === -1 && CEILING_HEADER_PATTERNS.some((re) => re.test(raw))) {
      ceilingIdx = idx;
      return;
    }
    if (POINTS_HEADER_PATTERNS.some((re) => re.test(raw))) {
      pointsCandidates.push(idx);
      return;
    }
    if (rankIdx === -1 && RANK_HEADER_PATTERNS.some((re) => re.test(raw))) {
      rankIdx = idx;
      return;
    }
    const statKey = STAT_HEADER_MAP[norm] ?? STAT_HEADER_MAP[raw.replace(/[^a-z0-9 ]/g, " ").trim()];
    if (statKey) {
      statCols.push({ idx, key: statKey });
    }
  });

  pointsIdx = selectPointsColumn(headers, pointsCandidates, pointsPreference);

  return { playerIdx, teamIdx, posIdx, pointsIdx, rankIdx, floorIdx, ceilingIdx, statCols };
}

function selectPointsColumn(headers: string[], candidates: number[], preference: PointsPreference): number {
  if (candidates.length === 0) return -1;
  if (preference === "first" || candidates.length === 1) return candidates[0];
  for (const idx of candidates) {
    const raw = headers[idx].toLowerCase();
    if (preference === "ppr" && /ppr/.test(raw)) return idx;
    if (preference === "half" && /1\/2|half/.test(raw)) return idx;
    if (preference === "std" && /std/.test(raw)) return idx;
  }
  return candidates[0];
}

export interface MapTableOptions {
  readonly source: string;
  readonly fallbackPosition: PlayerPosition;
  readonly confidence?: number;
  readonly maxRows?: number;
  readonly pointsPreference?: PointsPreference;
}

/**
 * Convert a parsed HTML table into `ProjectionCandidate[]`. Rows without a
 * recognisable player name are skipped. When no points column exists (ranking
 * pages) `projected_points` falls back to a rank-derived score so the row is
 * still usable by the consensus engine.
 */
export function mapTableToCandidates(table: ParsedTable, options: MapTableOptions): ProjectionCandidate[] {
  const roles = detectColumnRoles(table.headers, options.pointsPreference ?? "first");
  if (roles.playerIdx === -1) return [];

  const candidates: ProjectionCandidate[] = [];
  for (const row of table.rows) {
    const name = row[roles.playerIdx]?.trim();
    if (!name || /^\W*$/.test(name)) continue;

    const team = roles.teamIdx >= 0 ? (row[roles.teamIdx]?.trim() ?? "") : "";
    const rawPos = roles.posIdx >= 0 ? row[roles.posIdx]?.trim() : undefined;
    const positions = [normalizePosition(rawPos, options.fallbackPosition)];

    const projected_stats: Record<string, number> = {};
    for (const { idx, key } of roles.statCols) {
      const value = parseNumber(row[idx]);
      if (value !== undefined) projected_stats[key] = value;
    }

    const projected_points = roles.pointsIdx >= 0 ? (parseNumber(row[roles.pointsIdx]) ?? 0) : rankToPoints(roles, row);
    const floor = roles.floorIdx >= 0 ? (parseNumber(row[roles.floorIdx]) ?? projected_points) : round2(projected_points * 0.7);
    const ceiling = roles.ceilingIdx >= 0 ? (parseNumber(row[roles.ceilingIdx]) ?? projected_points) : round2(projected_points * 1.3);

    candidates.push({
      name,
      team,
      positions,
      projected_stats,
      projected_points: round2(projected_points),
      floor: round2(floor),
      ceiling: round2(ceiling),
      confidence: options.confidence ?? 0.7
    });

    if (options.maxRows && candidates.length >= options.maxRows) break;
  }
  return candidates;
}

function rankToPoints(roles: ColumnRoles, row: string[]): number {
  if (roles.rankIdx < 0) return 0;
  const rank = parseNumber(row[roles.rankIdx]);
  if (rank === undefined || rank <= 0) return 0;
  // Crude decaying score: top rank ~ 25 pts, halving roughly every ~12 ranks.
  return round2(Math.max(0, 25 * Math.pow(0.5, (rank - 1) / 12)));
}

export function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim().replace(/,/g, "");
  if (s === "" || s === "-" || s === "—" || s === "N/A") return undefined;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  const match = /-?\d+(\.\d+)?/.exec(s);
  if (!match) return undefined;
  const value = Number(match[0]);
  if (Number.isNaN(value)) return undefined;
  return negative ? -value : value;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

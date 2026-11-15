/** Public GET-only feeds. Never infer game availability from an athlete's roster Active flag. */
export interface NflGame {
  id: string;
  name: string;
  kickoff: string;
  week: number;
  season: string;
  teams: Array<{ id: string; abbreviation: string }>;
  state: string;
}
export interface AvailabilityEvidence {
  playerId: string;
  status: string;
  publishedAt: string;
  retrievedAt: string;
  sourceUrl: string;
  text: string;
  kind: "designation" | "news";
}
export interface KickoffSource {
  schedule(season: string, week: number): Promise<NflGame[]>;
  injuries(game: NflGame, at: Date): Promise<AvailabilityEvidence[]>;
  playerNews(playerId: string, at: Date): Promise<AvailabilityEvidence[]>;
}

type Obj = Record<string, any>;
const object = (v: unknown): Obj => v && typeof v === "object" ? v as Obj : {};
const iso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : "";
const clean = (v: unknown) => typeof v === "string" ? v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";

export function parseKickoffSchedule(value: unknown, season: string, week: number): NflGame[] {
  const root = object(value);
  if (!Array.isArray(root.events)) throw new Error("ESPN schedule payload has no events array.");
  const games: NflGame[] = [];
  for (const event of root.events as Obj[]) {
    if (String(event.season?.year) !== season || Number(event.season?.type) !== 2 || Number(event.week?.number ?? root.week?.number) !== week) continue;
    const c = event.competitions?.[0];
    // timeValid=false / TBD must never become a midnight reminder.
    if (!c || c.timeValid === false || event.timeValid === false || c.status?.type?.name === "STATUS_POSTPONED" || c.status?.type?.name === "STATUS_CANCELED") continue;
    const kickoff = iso(c.date ?? event.date);
    const teams = (c.competitors ?? []).map((r: Obj) => ({ id: String(r.team?.id ?? ""), abbreviation: String(r.team?.abbreviation ?? "") }));
    if (!kickoff || teams.length !== 2 || teams.some((t: Obj) => !t.id || !t.abbreviation) || !/^\d+$/.test(String(event.id))) throw new Error("Incomplete NFL game identity or kickoff.");
    games.push({ id: String(event.id), name: clean(event.name), kickoff, week, season, teams, state: c.status?.type?.state ?? event.status?.type?.state ?? "unknown" });
  }
  if (!games.length) throw new Error("No verified timed regular-season games for the requested NFL week; do not invent kickoff times.");
  if (new Set(games.map(g => g.id)).size !== games.length) throw new Error("Duplicate NFL event identities.");
  return games.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
}

export function parseGameInjuries(value: unknown, game: NflGame, at: Date): AvailabilityEvidence[] {
  const root = object(value);
  if (String(root.header?.id) !== game.id || String(root.header?.season?.year) !== game.season || !Array.isArray(root.injuries)) throw new Error(`Game ${game.id} injury coverage is unavailable or mismatched.`);
  const rows: AvailabilityEvidence[] = [];
  for (const team of root.injuries as Obj[]) for (const row of team.injuries ?? []) {
    const id = String(row.athlete?.id ?? "");
    if (!/^\d+$/.test(id)) continue;
    rows.push({ playerId: id, status: clean(row.status).toLowerCase(), publishedAt: iso(row.date), retrievedAt: at.toISOString(), sourceUrl: `https://www.espn.com/nfl/game/_/gameId/${game.id}`, text: clean(row.details?.detail ?? row.type?.description ?? row.status), kind: "designation" });
  }
  return rows;
}

export function parsePlayerKickoffNews(value: unknown, playerId: string, at: Date): AvailabilityEvidence[] {
  const root = object(value);
  if (!Object.hasOwn(root, "rotowire") || !Object.hasOwn(root, "news")) throw new Error(`Player ${playerId} news payload is incomplete.`);
  const row = object(root.rotowire);
  if (!row.headline) return [];
  return [{ playerId, status: "unverified", publishedAt: iso(row.published), retrievedAt: at.toISOString(), sourceUrl: `https://www.espn.com/nfl/player/news/_/id/${playerId}`, text: clean(row.headline) + " " + clean(row.story), kind: "news" }];
}

export class EspnKickoffSource implements KickoffSource {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}
  private async get(url: string): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await this.fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) {
          if ((r.status === 429 || r.status >= 500) && attempt === 0) continue;
          throw new Error(`Public ESPN read returned HTTP ${r.status}.`);
        }
        return await r.json();
      } catch (error) { if (attempt === 1) throw error; }
    }
    throw new Error("Public ESPN read failed.");
  }
  async schedule(season: string, week: number) {
    return parseKickoffSchedule(await this.get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`), season, week);
  }
  async injuries(game: NflGame, at: Date) {
    return parseGameInjuries(await this.get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.id}`), game, at);
  }
  async playerNews(playerId: string, at: Date) {
    if (!/^\d+$/.test(playerId)) throw new Error("A positive ESPN athlete id is required for player news.");
    return parsePlayerKickoffNews(await this.get(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/overview`), playerId, at);
  }
}

/** Offset comes from the IANA zone on that date, including the November DST change. */
export function easternIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace("GMT", "").replace("−", "-") || "+00:00"}`;
}

export function groupKickoffs(games: NflGame[], now: Date) {
  const groups = new Map<string, NflGame[]>();
  for (const game of games) groups.set(game.kickoff, [...(groups.get(game.kickoff) ?? []), game]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([kickoff, games]) => {
    const runAt = new Date(Date.parse(kickoff) - 3600000);
    return { kickoff, run_at: easternIso(runAt), future: runAt.getTime() > now.getTime(), games, key: `${games[0]!.season}:W${games[0]!.week}:${kickoff}` };
  });
}

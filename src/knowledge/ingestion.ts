import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertLeagueSnapshot } from "../models/validation.js";
import type { LeagueSnapshot, NewsItem, Player, Projection } from "../models/types.js";
import type { KnowledgeRepository } from "./repository.js";
import type { PlatformReader } from "../adapters/platform-reader.js";

export async function ingestFixtureSnapshot(
  fixturePath: string,
  repository: KnowledgeRepository
): Promise<LeagueSnapshot> {
  const parsed = await loadFixtureSnapshotSource(fixturePath);
  await repository.saveLeagueSnapshot(parsed);
  return parsed;
}

export async function loadFixtureSnapshotSource(fixturePath: string): Promise<LeagueSnapshot> {
  const absolutePath = resolve(fixturePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertLeagueSnapshot(parsed);
  return parsed;
}

export interface BuildSnapshotOptions {
  readonly projections?: Projection[];
  readonly news?: NewsItem[];
  readonly snapshotId?: string;
  readonly clock?: () => Date;
}

function collectRosterPlayerIds(league: LeagueSnapshot["league"]): Set<string> {
  const ids = new Set<string>();
  for (const team of league.teams) {
    for (const slot of [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve]) {
      if (slot.player_id) ids.add(slot.player_id);
    }
  }
  return ids;
}

export async function buildSnapshotFromPlatform(
  reader: PlatformReader,
  leagueExternalId: string,
  season: string,
  options: BuildSnapshotOptions = {}
): Promise<LeagueSnapshot> {
  const now = (options.clock ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const league = await reader.getLeague(leagueExternalId, season);

  const allPlayers = await reader.getPlayers(league.sport, season);
  const freeAgents = await reader.getFreeAgents(leagueExternalId);
  const waiverState = await reader.getWaiverState(leagueExternalId);

  const rosterIds = collectRosterPlayerIds(league);
  const freeIds = new Set(freeAgents.map((player: Player) => player.player_id));
  const players = allPlayers.filter((player) => rosterIds.has(player.player_id) || freeIds.has(player.player_id));

  const managers = league.teams.map((team) => ({
    schema_version: "1.0.0",
    created_at: nowIso,
    updated_at: nowIso,
    source_system: league.platform,
    source_record_id: team.manager_id,
    manager_id: team.manager_id,
    display_name: team.name,
    contact_preferences: {},
    observed_behavior_profile: {}
  }));

  const snapshotId = options.snapshotId ?? `${league.platform}-${leagueExternalId}-${now.getTime()}`;

  return {
    snapshot_id: snapshotId,
    league,
    managers,
    players,
    free_agents: freeAgents,
    waiver_state: waiverState,
    projections: options.projections ?? [],
    news: options.news ?? []
  };
}

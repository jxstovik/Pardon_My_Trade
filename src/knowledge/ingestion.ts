import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertLeagueSnapshot } from "../models/validation.js";
import type { LeagueSnapshot } from "../models/types.js";
import type { KnowledgeRepository } from "./repository.js";

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

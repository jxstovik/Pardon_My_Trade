import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CaptureSchema, ConfigSchema, PolicySchema, validateScope, type BasketballConfig, type BasketballCapture, type StrategyPolicy } from "./contracts.js";
import { validatePeriods } from "./calendar.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Basketball manifests require JSON values");
  return encoded;
}
export const contentHash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export async function readConfig(path: string): Promise<BasketballConfig> {return ConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));}
export const leagueDirectory = (root: string, config: BasketballConfig): string => join(root, config.leagueId);
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {mode: 0o600});
  await rename(temporary, path);
}
export async function immutableText(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, {flag: "wx", mode: 0o600});
  try {
    try {await link(temporary, path);}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(path, "utf8") !== text) throw new Error("Immutable basketball file conflict");
    }
  } finally {await unlink(temporary);}
}
export type StoredCapture = {schemaVersion: 1; snapshotId: string; captureHash: string; ingestedAt: string; capture: BasketballCapture};

/** Content-addressed snapshots; atomic pointer. Single writer, no production job runner yet. */
export async function importCapture(root: string, config: BasketballConfig, input: unknown, at: Date): Promise<StoredCapture> {
  const capture = CaptureSchema.parse(input);
  validateScope(config, capture);
  validatePeriods(capture.leagueInfo.scoringPeriods); validatePeriods(capture.leagueInfo.rosterPeriods);
  const hash = contentHash(capture), snapshotId = `snapshot-${hash}`;
  const directory = leagueDirectory(root, config), snapshots = join(directory, "snapshots");
  await mkdir(snapshots, {recursive: true});
  let stored: StoredCapture = {schemaVersion: 1, snapshotId, captureHash: hash, ingestedAt: at.toISOString(), capture};
  const path = join(snapshots, `${snapshotId}.json`);
  try {await immutableText(path, JSON.stringify(stored, null, 2) + "\n");}
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Immutable basketball file conflict")) throw error;
    const prior = JSON.parse(await readFile(path, "utf8")) as StoredCapture;
    if (prior.snapshotId !== snapshotId || prior.captureHash !== hash || contentHash(prior.capture) !== hash) throw new Error("Immutable basketball snapshot conflict");
    stored = prior;
  }
  await atomicJson(join(directory, "current.json"), {snapshotId});
  return stored;
}

export async function currentCapture(root: string, config: BasketballConfig): Promise<StoredCapture> {
  const directory = leagueDirectory(root, config);
  const pointer = JSON.parse(await readFile(join(directory, "current.json"), "utf8")) as {snapshotId: string};
  if (!/^snapshot-[a-f0-9]{64}$/.test(pointer.snapshotId)) throw new Error("Invalid basketball snapshot pointer");
  const stored = JSON.parse(await readFile(join(directory, "snapshots", `${pointer.snapshotId}.json`), "utf8")) as StoredCapture;
  const capture = CaptureSchema.parse(stored.capture);
  validateScope(config, capture);
  if (stored.snapshotId !== pointer.snapshotId || stored.captureHash !== contentHash(capture) || stored.snapshotId !== `snapshot-${stored.captureHash}`) throw new Error("Immutable basketball snapshot hash mismatch");
  return {...stored, capture};
}

export const PROFILES = {
  balanced: "Selected starting approach: compete across all eight categories; no intentional punt.",
  bigs: "Explore REB, BLK and attempt-weighted FG% strength; display AST, threes and FT% costs. No automatic punt.",
  guards: "Explore AST, threes, points and FT% creation; display REB, BLK and FG% costs. No turnover penalty."
} as const;

export async function readPolicy(root: string, config: BasketballConfig): Promise<StrategyPolicy | null> {
  const directory = leagueDirectory(root, config);
  let pointer: {revision: string};
  try {
    pointer = JSON.parse(await readFile(join(directory, `policy-${config.teamId}.json`), "utf8")) as {revision: string};
  } catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;}
  if (!/^[a-f0-9]{64}$/.test(pointer.revision)) throw new Error("Invalid strategy revision");
  const policy = PolicySchema.parse(JSON.parse(await readFile(join(directory, "policies", `${pointer.revision}.json`), "utf8")));
  const {revision, ...payload} = policy;
  if (policy.leagueId !== config.leagueId || policy.teamId !== config.teamId || contentHash(payload) !== revision || revision !== pointer.revision) throw new Error("Strategy policy scope/hash mismatch");
  return policy;
}

export async function selectPolicy(root: string, config: BasketballConfig, choice: Pick<StrategyPolicy, "profile" | "overlay" | "effectivePeriod">, at: Date): Promise<StrategyPolicy> {
  const previous = await readPolicy(root, config);
  const payload = {schemaVersion: 1 as const, leagueId: config.leagueId, teamId: config.teamId, ...choice, selectedAt: at.toISOString(), previousRevision: previous?.revision ?? null};
  const policy = PolicySchema.parse({...payload, revision: contentHash(payload)});
  const directory = leagueDirectory(root, config);
  await mkdir(join(directory, "policies"), {recursive: true});
  await immutableText(join(directory, "policies", `${policy.revision}.json`), JSON.stringify(policy, null, 2) + "\n");
  await atomicJson(join(directory, `policy-${config.teamId}.json`), {revision: policy.revision});
  return policy;
}

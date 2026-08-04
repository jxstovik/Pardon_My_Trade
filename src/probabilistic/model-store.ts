import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlayerModel } from "./bayesian-model.js";

export interface ModelStore {
  list(): Promise<PlayerModel[]>;
  get(playerId: string): Promise<PlayerModel | undefined>;
  save(model: PlayerModel): Promise<void>;
  saveAll(models: PlayerModel[]): Promise<void>;
}

export class InMemoryModelStore implements ModelStore {
  private readonly models = new Map<string, PlayerModel>();

  async list(): Promise<PlayerModel[]> {
    return [...this.models.values()];
  }

  async get(playerId: string): Promise<PlayerModel | undefined> {
    return this.models.get(playerId);
  }

  async save(model: PlayerModel): Promise<void> {
    this.models.set(model.playerId, model);
  }

  async saveAll(models: PlayerModel[]): Promise<void> {
    for (const model of models) this.models.set(model.playerId, model);
  }
}

interface ModelFile {
  schema_version: string;
  saved_at: string;
  models: PlayerModel[];
}

export class JsonModelStore implements ModelStore {
  private cache: Map<string, PlayerModel> | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<Map<string, PlayerModel>> {
    if (this.cache) return this.cache;
    const map = new Map<string, PlayerModel>();
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ModelFile;
      for (const model of parsed.models ?? []) map.set(model.playerId, model);
    } catch {
      // No persisted models yet; start empty.
    }
    this.cache = map;
    return map;
  }

  async list(): Promise<PlayerModel[]> {
    const map = await this.load();
    return [...map.values()];
  }

  async get(playerId: string): Promise<PlayerModel | undefined> {
    const map = await this.load();
    return map.get(playerId);
  }

  async save(model: PlayerModel): Promise<void> {
    const map = await this.load();
    map.set(model.playerId, model);
    await this.persist(map);
  }

  async saveAll(models: PlayerModel[]): Promise<void> {
    const map = await this.load();
    for (const model of models) map.set(model.playerId, model);
    await this.persist(map);
  }

  private async persist(map: Map<string, PlayerModel>): Promise<void> {
    const payload: ModelFile = {
      schema_version: "1.0.0",
      saved_at: new Date().toISOString(),
      models: [...map.values()]
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
    this.cache = map;
  }
}

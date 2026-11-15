import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export class InMemoryModelStore {
    models = new Map();
    async list() {
        return [...this.models.values()];
    }
    async get(playerId) {
        return this.models.get(playerId);
    }
    async save(model) {
        this.models.set(model.playerId, model);
    }
    async saveAll(models) {
        for (const model of models)
            this.models.set(model.playerId, model);
    }
}
export class JsonModelStore {
    filePath;
    cache = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        if (this.cache)
            return this.cache;
        const map = new Map();
        try {
            const raw = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            for (const model of parsed.models ?? [])
                map.set(model.playerId, model);
        }
        catch {
            // No persisted models yet; start empty.
        }
        this.cache = map;
        return map;
    }
    async list() {
        const map = await this.load();
        return [...map.values()];
    }
    async get(playerId) {
        const map = await this.load();
        return map.get(playerId);
    }
    async save(model) {
        const map = await this.load();
        map.set(model.playerId, model);
        await this.persist(map);
    }
    async saveAll(models) {
        const map = await this.load();
        for (const model of models)
            map.set(model.playerId, model);
        await this.persist(map);
    }
    async persist(map) {
        const payload = {
            schema_version: "1.0.0",
            saved_at: new Date().toISOString(),
            models: [...map.values()]
        };
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
        this.cache = map;
    }
}

import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
/** Load the shared PMT identity and canonical SQLite location for every entrypoint. */
export function loadRuntimeConfig(input = process.env) {
    const overrides = input;
    const env = input;
    const platformValue = nonEmpty(overrides.platform) ?? nonEmpty(env.PMT_PLATFORM)
        ?? (nonEmpty(env.ESPN_LEAGUE_ID) ? "espn" : "fixture");
    if (platformValue !== "fixture" && platformValue !== "espn" && platformValue !== "sleeper") {
        throw new Error(`PMT_PLATFORM must be fixture, espn, or sleeper; received ${platformValue}.`);
    }
    const platform = platformValue;
    const leagueExternalId = nonEmpty(overrides.leagueExternalId) ?? nonEmpty(env.PMT_LEAGUE_ID)
        ?? (platform === "espn" ? nonEmpty(env.ESPN_LEAGUE_ID) : platform === "sleeper" ? nonEmpty(env.SLEEPER_LEAGUE_ID) : undefined)
        ?? (platform === "fixture" ? "pmt-demo-football" : "");
    const teamExternalId = nonEmpty(overrides.teamExternalId) ?? nonEmpty(env.PMT_TEAM_ID)
        ?? nonEmpty(env.PMT_TEAM_EXTERNAL_ID) ?? (platform === "espn" ? nonEmpty(env.ESPN_TEAM_ID) : undefined)
        ?? (platform === "fixture" ? "team-001" : "");
    if (!leagueExternalId)
        throw new Error(`A league id is required for ${platform}; set PMT_LEAGUE_ID or the platform-specific league id.`);
    if (!teamExternalId)
        throw new Error(`A team id is required for ${platform}; set PMT_TEAM_ID.`);
    const dataDir = resolve(nonEmpty(overrides.dataDir) ?? nonEmpty(env.PMT_DATA_DIR) ?? "data");
    const fixturePath = nonEmpty(overrides.fixturePath) ?? nonEmpty(env.PMT_FIXTURE_PATH) ?? "tests/fixtures/demo-roster-distributions.json";
    return {
        dataDir,
        databasePath: overrides.databasePath ?? resolve(dataDir, "pmt.sqlite"),
        platform,
        leagueExternalId,
        teamExternalId,
        season: nonEmpty(overrides.season) ?? nonEmpty(env.PMT_SEASON) ?? nonEmpty(env.ESPN_SEASON) ?? String(new Date().getUTCFullYear()),
        fixturePath
    };
}
/** Migrate the prior pmt.db file before opening canonical runtime connections. */
export async function prepareRuntimeStorage(config) {
    await mkdir(dirname(config.databasePath), { recursive: true });
    const legacySources = [
        { path: join(config.dataDir, "pmt.db"), marker: "legacy-pmt-db-v1" },
        { path: join(config.dataDir, "pmt-v1.db"), marker: "legacy-pmt-v1-db-v1" }
    ].filter((source) => source.path !== config.databasePath && existsSync(source.path));
    if (!legacySources.length)
        return;
    const lockPath = `${config.databasePath}.migration.lock`;
    let lockFd;
    try {
        lockFd = openSync(lockPath, "wx", 0o600);
    }
    catch {
        throw new Error(`Storage migration is already running or lock ${lockPath} is stale. Resolve the lock before starting PMT.`);
    }
    try {
        for (const source of legacySources) {
            if (hasMigration(config.databasePath, source.marker))
                continue;
            if (!existsSync(config.databasePath) && source.path.endsWith("pmt.db")) {
                const legacy = new Database(source.path, { readonly: true, fileMustExist: true });
                try {
                    await legacy.backup(config.databasePath);
                }
                finally {
                    legacy.close();
                }
                recordMigration(config.databasePath, source.marker);
            }
            else {
                mergeLegacyDatabase(config.databasePath, source.path, source.marker);
            }
        }
        backfillLatestPointers(config.databasePath);
    }
    catch (error) {
        throw new Error(`Could not migrate legacy SQLite data into ${config.databasePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        closeSync(lockFd);
        await rm(lockPath, { force: true });
    }
}
function nonEmpty(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function mergeLegacyDatabase(targetPath, legacyPath, marker) {
    const db = new Database(targetPath);
    try {
        ensureMigrationTable(db);
        if (db.prepare("SELECT 1 FROM pmt_runtime_migrations WHERE migration_name=?").get(marker))
            return;
        db.pragma("foreign_keys = OFF");
        db.prepare("ATTACH DATABASE ? AS legacy").run(legacyPath);
        const tables = db.prepare(`SELECT name FROM legacy.sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
        db.transaction(() => {
            for (const { name } of tables)
                mergeTable(db, name);
            db.prepare("INSERT OR IGNORE INTO pmt_runtime_migrations(migration_name,applied_at) VALUES(?,?)").run(marker, new Date().toISOString());
        })();
        db.prepare("DETACH DATABASE legacy").run();
        db.pragma("foreign_keys = ON");
        const violations = db.pragma("foreign_key_check");
        if (violations.length)
            throw new Error("foreign key violations appeared after merging legacy rows");
    }
    finally {
        db.close();
    }
}
function ensureMigrationTable(db) {
    db.exec("CREATE TABLE IF NOT EXISTS pmt_runtime_migrations(migration_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
}
function hasMigration(targetPath, marker) {
    if (!existsSync(targetPath))
        return false;
    const db = new Database(targetPath);
    try {
        const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pmt_runtime_migrations'").get();
        return Boolean(table && db.prepare("SELECT 1 FROM pmt_runtime_migrations WHERE migration_name=?").get(marker));
    }
    finally {
        db.close();
    }
}
function recordMigration(targetPath, marker) {
    const db = new Database(targetPath);
    try {
        ensureMigrationTable(db);
        db.prepare("INSERT OR IGNORE INTO pmt_runtime_migrations(migration_name,applied_at) VALUES(?,?)").run(marker, new Date().toISOString());
    }
    finally {
        db.close();
    }
}
function backfillLatestPointers(databasePath) {
    const db = new Database(databasePath);
    try {
        const snapshots = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='league_snapshots'").get();
        if (!snapshots)
            return;
        db.exec(`CREATE TABLE IF NOT EXISTS latest_snapshots (
      league_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES league_snapshots(snapshot_id)
    )`);
        db.exec(`INSERT OR IGNORE INTO latest_snapshots(league_id,snapshot_id,updated_at)
      SELECT s.league_id, s.snapshot_id, s.created_at FROM league_snapshots s
      WHERE s.created_at=(SELECT MAX(s2.created_at) FROM league_snapshots s2 WHERE s2.league_id=s.league_id)`);
    }
    finally {
        db.close();
    }
}
function mergeTable(db, table) {
    const quoted = quoteIdentifier(table);
    const sourceCols = db.prepare(`PRAGMA legacy.table_info(${quoted})`).all();
    if (!sourceCols.length)
        return;
    let targetCols = db.prepare(`PRAGMA main.table_info(${quoted})`).all();
    if (!targetCols.length) {
        db.exec(`CREATE TABLE main.${quoted} AS SELECT * FROM legacy.${quoted} WHERE 0`);
        const primaryKey = sourceCols.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
        if (primaryKey.length) {
            const indexName = quoteIdentifier(`idx_legacy_${table}_pk`);
            db.exec(`CREATE UNIQUE INDEX main.${indexName} ON ${quoted} (${primaryKey.map(quoteIdentifier).join(",")})`);
        }
        targetCols = db.prepare(`PRAGMA main.table_info(${quoted})`).all();
    }
    const sourceNames = sourceCols.map((column) => column.name);
    const targetNames = targetCols.map((column) => column.name);
    if (sourceNames.length !== targetNames.length || sourceNames.some((column, index) => column !== targetNames[index])) {
        throw new Error(`table ${table} has a different schema in pmt.db and pmt.sqlite; no legacy rows were merged`);
    }
    const columns = sourceNames.map(quoteIdentifier).join(",");
    const keys = sourceCols.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    const sourceCount = db.prepare(`SELECT COUNT(*) AS count FROM legacy.${quoted}`).get();
    if (sourceCount.count && !keys.length)
        throw new Error(`table ${table} has data but no primary key; refusing an unsafe merge`);
    if (keys.length) {
        const keyMatch = keys.map((column) => `target.${quoteIdentifier(column)} = source.${quoteIdentifier(column)}`).join(" AND ");
        const changed = sourceNames.filter((column) => !keys.includes(column));
        const changedWhere = changed.length
            ? ` AND (${changed.map((column) => `target.${quoteIdentifier(column)} IS NOT source.${quoteIdentifier(column)}`).join(" OR ")})`
            : "";
        const collision = db.prepare(`SELECT 1 FROM legacy.${quoted} AS source JOIN main.${quoted} AS target ON ${keyMatch}${changedWhere} LIMIT 1`).get();
        if (collision)
            throw new Error(`table ${table} contains conflicting rows; preserve and reconcile pmt.db before starting`);
    }
    db.exec(`INSERT OR IGNORE INTO main.${quoted} (${columns}) SELECT ${columns} FROM legacy.${quoted}`);
}
function quoteIdentifier(identifier) { return `"${identifier.replaceAll('"', '""')}"`; }

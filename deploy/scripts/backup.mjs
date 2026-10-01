import { chmod, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const dataDir = resolve(process.env.PMT_DATA_DIR ?? "data");
const source = resolve(dataDir, "pmt.sqlite");
if (!process.argv[2]) {
  console.error("Usage: node deploy/scripts/backup.mjs /backup/pmt-YYYYMMDDTHHMMSSZ.sqlite");
  process.exit(2);
}
const destination = resolve(process.argv[2]);
await mkdir(dirname(destination), { recursive: true });
const [realSource, realDestinationDir] = await Promise.all([realpath(source), realpath(dirname(destination))]);
const canonicalDestination = resolve(realDestinationDir, basename(destination));
if (canonicalDestination === realSource) throw new Error("Backup destination must differ from the live database.");
try {
  const existing = await lstat(destination);
  if (existing) throw new Error(`Backup destination already exists: ${destination}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
// Reserve the destination without following a pre-existing symlink and keep
// league data private on shared/bind-mounted backup directories.
const reserved = await open(destination, "wx", 0o600);
await reserved.close();
let db;
try {
  db = new Database(source, { readonly: true, fileMustExist: true });
  await db.backup(destination);
  await chmod(destination, 0o600);
} catch (error) {
  await rm(destination, { force: true });
  throw error;
} finally {
  db?.close();
}
const check = new Database(destination, { readonly: true, fileMustExist: true });
try {
  const result = check.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`Backup integrity check failed: ${result}`);
} finally {
  check.close();
}
console.log(`SQLite backup created: ${destination}`);

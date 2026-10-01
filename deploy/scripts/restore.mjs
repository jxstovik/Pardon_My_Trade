import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const backup = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Usage: node deploy/scripts/restore.mjs /restore/pmt-backup.sqlite");
  process.exit(2);
}
const dataDir = resolve(process.env.PMT_DATA_DIR ?? "data");
const liveDb = resolve(dataDir, "pmt.sqlite");
if (backup === liveDb) throw new Error("Restore source must differ from the live database.");
await mkdir(dirname(liveDb), { recursive: true });
const sourceDb = new Database(backup, { readonly: true, fileMustExist: true });
try {
  const result = sourceDb.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`Restore source integrity check failed: ${result}`);
} finally {
  sourceDb.close();
}
const replacement = `${liveDb}.restore-${process.pid}`;
try {
  await copyFile(backup, replacement);
  const verify = new Database(replacement, { readonly: true, fileMustExist: true });
  try {
    const result = verify.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`Copied restore integrity check failed: ${result}`);
  } finally {
    verify.close();
  }
  await rm(`${liveDb}-wal`, { force: true });
  await rm(`${liveDb}-shm`, { force: true });
  await rename(replacement, liveDb);
} catch (error) {
  await rm(replacement, { force: true });
  throw error;
}
console.log(`SQLite database restored from ${backup}`);

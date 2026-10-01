import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const dataDir = resolve(process.env.PMT_DATA_DIR ?? "data");
const source = resolve(dataDir, "pmt.sqlite");
const destination = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Usage: node deploy/scripts/backup.mjs /backup/pmt-YYYYMMDDTHHMMSSZ.sqlite");
  process.exit(2);
}
if (destination === source) throw new Error("Backup destination must differ from the live database.");
await mkdir(dirname(destination), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(destination);
} finally {
  db.close();
}
const check = new Database(destination, { readonly: true, fileMustExist: true });
try {
  const result = check.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`Backup integrity check failed: ${result}`);
} finally {
  check.close();
}
console.log(`SQLite backup created: ${destination}`);

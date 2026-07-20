import { readFileSync } from "node:fs";

/**
 * Minimal `.env` loader (no external dependency). Reads `.env` / `.env.local`
 * from the working directory and copies any KEY=VALUE pairs into
 * `process.env` that are not already set. Existing environment variables win,
 * so shell exports and CI secrets take precedence.
 *
 * Lines beginning with `#` are treated as comments and ignored. Values may be
 * optionally wrapped in single or double quotes.
 */
export function loadEnv(files: ReadonlyArray<string> = [".env", ".env.local"]): void {
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FileLockOptions {
  readonly staleMs?: number;
  readonly retryMs?: number;
  readonly timeoutMs?: number;
}

/** Atomic directory creation provides a small cross-process lock for one data directory. */
export async function withFileLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const staleMs = options.staleMs ?? 30 * 60 * 1000;
  const retryMs = options.retryMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 0;
  const started = Date.now();
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      // The directory creation is the lock acquisition. Do not delay the work
      // on metadata I/O; another process treats a missing owner file as held.
      void writeFile(join(lockPath, "owner"), JSON.stringify({ owner, createdAt: Date.now() }), "utf8");
      try {
        return { acquired: true, value: await work() };
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const raw = await readFile(join(lockPath, "owner"), "utf8");
        const createdAt = Number((JSON.parse(raw) as { createdAt?: number }).createdAt);
        if (Number.isFinite(createdAt) && Date.now() - createdAt > staleMs) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // A lock directory may be between mkdir and owner-file creation.
      }
      if (Date.now() - started >= timeoutMs) return { acquired: false };
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

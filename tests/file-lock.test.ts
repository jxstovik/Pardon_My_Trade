import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../src/concurrency/file-lock.js";

test("file lock rejects overlapping work and releases after completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pmt-lock-"));
  const lockPath = join(directory, "job.lock");
  let release!: () => void;
  const first = withFileLock(lockPath, () => new Promise<string>((resolve) => {
    release = () => resolve("finished");
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = await withFileLock(lockPath, async () => "unexpected", { timeoutMs: 0 });
  assert.equal(second.acquired, false);
  release();
  assert.deepEqual(await first, { acquired: true, value: "finished" });
  const third = await withFileLock(lockPath, async () => "reused");
  assert.deepEqual(third, { acquired: true, value: "reused" });
  await rm(directory, { recursive: true, force: true });
});

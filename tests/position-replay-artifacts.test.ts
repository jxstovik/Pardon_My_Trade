import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const position of ["qb", "rb", "wr", "te"]) {
  const directory = `artifacts/${position}-2024-replay`;
  test(`${position.toUpperCase()} real replay publishes preseason and walk-forward artifacts`, async () => {
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as {
      position: string;
      replay_id: string;
      row_counts: { training: number; validation: number };
      matching: { rank: { matched: number; source_rows: number } };
    };
    const walkforward = JSON.parse(await readFile(`${directory}/walkforward-manifest.json`, "utf8")) as {
      position: string;
      replay_id: string;
      checkpoints: number;
    };
    const promotion = JSON.parse(await readFile(`${directory}/promotion-decision.json`, "utf8")) as { approved: boolean };
    assert.equal(manifest.position, position.toUpperCase());
    assert.equal(manifest.replay_id, `chatpft-${position}-2024`);
    assert.ok(manifest.row_counts.training > 100);
    assert.ok(manifest.row_counts.validation > 20);
    assert.ok(manifest.matching.rank.matched > 0 || manifest.matching.rank.source_rows === 0);
    assert.equal(walkforward.position, position.toUpperCase());
    assert.equal(walkforward.replay_id, `chatpft-${position}-2024`);
    assert.equal(walkforward.checkpoints, 19);
    assert.equal(promotion.approved, true);
    assert.match(await readFile(`${directory}/report.md`, "utf8"), /## Takeaways/);
    assert.match(await readFile(`${directory}/phase8-report.md`, "utf8"), /## Takeaways/);
  });
}

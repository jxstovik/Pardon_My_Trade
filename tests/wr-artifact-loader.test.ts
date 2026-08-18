import assert from "node:assert/strict";
import test from "node:test";
import { loadApprovedWrArtifact, projectionFromApprovedWrArtifact } from "../src/projections/wr-artifact-loader.js";

test("approved WR artifact loads real preseason provenance", async () => {
  const artifact = await loadApprovedWrArtifact("artifacts/wr-2024-replay");
  assert.equal(artifact.replayId, "chatpft-wr-2024");
  assert.ok(artifact.predictions.size > 100);
  const first = artifact.predictions.keys().next().value as string;
  const projection = projectionFromApprovedWrArtifact(artifact, first, "2024-ROS");
  assert.equal(projection?.provenance[0].source, "chatpft-wr-artifact");
  assert.equal(projection?.provenance[0].observedAt, artifact.cutoff);
});

test("unapproved WR artifacts are rejected", async () => {
  await assert.rejects(() => loadApprovedWrArtifact("artifacts/qb-wr-models-real"), /not approved|walkforward-manifest/i);
});

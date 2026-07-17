import assert from "node:assert/strict";
import test from "node:test";
import { DefaultProjectionEngine } from "../src/projections/projection-engine.js";
import type { Projection } from "../src/models/types.js";

function projection(playerId: string, points: number, confidence = 0.6): Projection {
  return {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "s", source_record_id: playerId,
    projection_id: `p-${playerId}`, player_id: playerId, source: "s", scoring_period: "W1",
    projected_stats: {}, projected_points: points, floor: points, ceiling: points, confidence
  };
}

test("buildConsensus averages across sources and tracks count", () => {
  const engine = new DefaultProjectionEngine();
  const consensus = engine.buildConsensus(
    [
      { source: "a", projections: [projection("wr-1", 10)] },
      { source: "b", projections: [projection("wr-1", 20)] }
    ],
    "W1"
  );
  assert.equal(consensus.length, 1);
  assert.equal(consensus[0].player_id, "wr-1");
  assert.equal(consensus[0].projected_points, 15);
  assert.equal(consensus[0].sources, 2);
  assert.ok(consensus[0].confidence >= 0.6);
});

test("buildConsensus separates players and sorts by points", () => {
  const engine = new DefaultProjectionEngine();
  const consensus = engine.buildConsensus(
    [{ source: "a", projections: [projection("wr-1", 5), projection("wr-2", 12)] }],
    "W1"
  );
  assert.equal(consensus.length, 2);
  assert.equal(consensus[0].player_id, "wr-2");
});

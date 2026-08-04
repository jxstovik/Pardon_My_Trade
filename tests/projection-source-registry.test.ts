import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectionSources } from "../src/projections/projection-source-registry.js";

test("registry defaults to ESPN only when no sources configured", () => {
  const sources = buildProjectionSources({ sources: "" });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].name, "espn");
});

test("registry fans out razzball into one source per position", () => {
  const sources = buildProjectionSources({ sources: "razzball" });
  const names = sources.map((s) => s.name);
  assert.ok(names.includes("razzball-rb"));
  assert.ok(names.includes("razzball-qb"));
  assert.ok(names.includes("razzball-dst"));
  assert.ok(names.includes("razzball-idp"));
  assert.equal(new Set(names).size, names.length);
});

test("registry fans out fftoday and combines with espn", () => {
  const sources = buildProjectionSources({ sources: "espn,fftoday" });
  const names = sources.map((s) => s.name);
  assert.ok(names.includes("espn"));
  assert.ok(names.includes("fftoday-wr"));
  assert.ok(names.includes("fftoday-k"));
  assert.ok(!names.includes("fftoday-idp"));
});

test("registry reports unsupported sources via callback", () => {
  const unsupported: string[] = [];
  buildProjectionSources({ sources: "espn,fantasypros,razzball", onUnsupported: (n) => unsupported.push(n) });
  assert.deepEqual(unsupported, ["fantasypros"]);
});

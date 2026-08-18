import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

for (const position of ["qb", "wr"]) {
  test(`${position.toUpperCase()} metamodel artifacts contain validation output`, async () => {
    const directory = `artifacts/qb-wr-models/${position}`;
    const metrics = JSON.parse(await readFile(`${directory}/metrics.json`, "utf8")) as Array<{ split: string; model: string; rmse: number }>;
    assert.ok(metrics.some((row) => row.split === "validation" && row.model === "metamodel" && row.rmse > 0));
    for (const file of ["model.json", "validation_predictions.json", `${position}-metamodel.sqlite`, "training-fit.svg", "validation-fit.svg"]) {
      await access(`${directory}/${file}`);
    }
  });

  test(`${position.toUpperCase()} real metamodel artifacts contain source provenance`, async () => {
    const directory = `artifacts/qb-wr-models-real/${position}`;
    const metrics = JSON.parse(await readFile(`${directory}/metrics.json`, "utf8")) as Array<{ split: string; model: string; rmse: number }>;
    assert.ok(metrics.some((row) => row.split === "validation" && row.model === "nflverse-history-bootstrap-ridge" && row.rmse > 0));
    for (const file of ["model.json", "validation_predictions.json", "current-predictions.json", `${position}-metamodel.sqlite`, "training-fit.svg", "validation-fit.svg"]) {
      await access(`${directory}/${file}`);
    }
  });
}

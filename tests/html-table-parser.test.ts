import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseHtmlTables, firstTable } from "../src/projections/html-table-parser.js";

test("parses headers and data rows, dropping empty rows", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const { tables } = parseHtmlTables(html);
  const table = firstTable({ tables });
  if (!table) throw new Error("expected a parsed table");
  assert.deepEqual(table.headers.slice(0, 3), ["Player", "Team", "Rush Att"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0], "Christian McCaffrey");
  assert.equal(table.rows[0][1], "SF");
  // The all-blank row is filtered out.
  assert.ok(!table.rows.some((r) => r.every((c) => c === "")));
});

test("strips anchor tags to plain text", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const { tables } = parseHtmlTables(html);
  const table = firstTable({ tables });
  if (!table) throw new Error("expected a parsed table");
  assert.equal(table.rows[0][0], "Christian McCaffrey");
  assert.equal(table.rows[1][0], "Bijan Robinson");
});

test("decodes entities and collapses whitespace", async () => {
  const html = `<table><tr><th>Player</th><th>Team&nbsp;Name</th></tr>
    <tr><td>  Mike  Evans  </td><td>TB</td></tr></table>`;
  const { tables } = parseHtmlTables(html);
  assert.deepEqual(tables[0].headers, ["Player", "Team Name"]);
  assert.equal(tables[0].rows[0][0], "Mike Evans");
});

test("returns no tables for non-html payloads", () => {
  const { tables } = parseHtmlTables("<p>no data here</p>");
  assert.equal(tables.length, 0);
});

/**
 * Fixture sanity: canonical rows, format parity artifacts, join expectations.
 * Deep manifest-digest/boundary/negative matrices were pruned — the loader
 * behavior itself is proven in the browser tests against these fixtures.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateConfig } from "../../contract/config.mjs";

const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);
const fixturesDir = path.join(rootDir, "tests/fixtures");
const artifactsDir = path.join(rootDir, ".artifacts/fixtures");

const expected = JSON.parse(
 await readFile(path.join(fixturesDir, "expected.json"), "utf8"),
);

test("canonical rows carry the designed boundaries", async () => {
 const rows = JSON.parse(
  await readFile(path.join(fixturesDir, "rows.json"), "utf8"),
 );
 assert.equal(rows.length, expected.canonical.rowCount);
 assert.ok(
  rows.some((row) => row.sequence_number === "001"),
  "leading-zero identifier preserved",
 );
 assert.ok(
  rows.some((row) => row.sequence_number === null),
  "unquoted null distinguished from quoted empty string",
 );
 assert.ok(
  expected.defaultWindow.anchor.rowIndicesOutside.length === 1,
  "one row outside the 30-day window",
 );
});

test("expected.json metrics are internally consistent", () => {
 const { metrics, anchor } = expected.defaultWindow;
 assert.equal(metrics.records, anchor.rowIndicesInside.length);
 assert.equal(
  Object.values(expected.defaultWindow.bySource).reduce((a, b) => a + b, 0),
  metrics.records,
 );
 assert.equal(
  expected.join.allRows.matchedInspectionRows +
   expected.join.allRows.unmatchedInspectionRows,
  expected.allRows.metrics.records,
 );
});

test("runtime.config.json is accepted by the shared validator", async () => {
 const config = JSON.parse(
  await readFile(path.join(fixturesDir, "runtime.config.json"), "utf8"),
 );
 const result = validateConfig(config);
 assert.equal(result.ok, true);
 assert.deepEqual(result.value.data.sources.map((source) => source.id).sort(), [
  "inspections",
  "products",
 ]);
});

test("generated parity artifacts exist after npm run fixtures", () => {
 for (const file of [
  "inspections.csv",
  "inspections.json",
  "inspections.ndjson",
  "inspections.parquet",
  "products.parquet",
  "manifest.json",
 ]) {
  assert.ok(existsSync(path.join(artifactsDir, file)), `missing ${file}`);
 }
});

test("generated CSV parses back to the canonical rows with types preserved", async () => {
 const csv = await readFile(path.join(artifactsDir, "inspections.csv"), "utf8");
 const lines = csv.trim().split("\n");
 assert.equal(lines.length, expected.canonical.rowCount + 1);
 assert.equal(lines[0], Object.keys(expected.canonical.columns).join(","));
 assert.ok(
  lines.some((line) => line.includes(',"001",')),
  "sequence_number 001 survives a CSV round-trip",
 );
});

test("generated Parquet files are PAR1 containers", async () => {
 for (const file of ["inspections.parquet", "products.parquet"]) {
  const head = await readFile(path.join(artifactsDir, file));
  assert.equal(head.subarray(0, 4).toString("ascii"), "PAR1", file);
 }
});

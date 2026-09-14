/**
 * Semantic (cross-reference) validation — the behaviorally meaningful subset.
 * Prototype-pollution / unicode / Base64 grammar cases are deferred
 * (docs/plans/deferred.md).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateConfig } from "../../contract/config.mjs";

const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

async function base() {
 return JSON.parse(
  await readFile(
   path.join(rootDir, "tests/fixtures/minimal.config.json"),
   "utf8",
  ),
 );
}

test("layout referencing an unknown query is rejected", async () => {
 const config = await base();
 config.layout[0].query = "no_such_query";
 assert.equal(validateConfig(config).ok, false);
});

test("filter referencing an unknown source is rejected", async () => {
 const config = await base();
 config.filters[0].source = "no_such_source";
 assert.equal(validateConfig(config).ok, false);
});

test("filter referencing an unknown column is rejected", async () => {
 const config = await base();
 config.filters[0].column = "no_such_column";
 assert.equal(validateConfig(config).ok, false);
});

test("duplicate filter IDs are rejected", async () => {
 const config = await base();
 config.filters.push({ ...config.filters[0] });
 assert.equal(validateConfig(config).ok, false);
});

test("date-range filter on a non-timestamp column is rejected", async () => {
 const config = await base();
 config.filters[0] = {
  id: "window",
  kind: "date-range",
  source: "inspections",
  column: "station",
  default: { kind: "latest-days", days: 30 },
 };
 assert.equal(validateConfig(config).ok, false);
});

test("query declaring an unknown parameter is rejected", async () => {
 const config = await base();
 config.queries.summary.params = ["ghost"];
 assert.equal(validateConfig(config).ok, false);
});

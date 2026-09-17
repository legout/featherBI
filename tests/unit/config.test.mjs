/**
 * Structural config validation — the behaviorally meaningful subset.
 * Library behavior (Ajv error text, exotic JSON edge cases) is deliberately
 * not tested here; see docs/plans/deferred.md.
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

async function loadMinimalConfig() {
 return JSON.parse(
  await readFile(
   path.join(rootDir, "tests/fixtures/minimal.config.json"),
   "utf8",
  ),
 );
}

test("minimal example config is valid", async () => {
 const result = validateConfig(await loadMinimalConfig());
 assert.equal(result.ok, true);
 assert.equal(result.value.title, "Inspection activity");
 assert.equal(result.value.data.sources[0].id, "inspections");
});

test("unsupported contract versions are rejected", async () => {
 const config = await loadMinimalConfig();
 for (const removed of [1, 3]) {
  assert.equal(validateConfig({ ...config, contract: removed }).ok, false);
 }
});

test("unknown top-level property is rejected", async () => {
 const config = await loadMinimalConfig();
 config.mystery = true;
 assert.equal(validateConfig(config).ok, false);
});

test("missing required section (queries) is rejected", async () => {
 const config = await loadMinimalConfig();
 delete config.queries;
 assert.equal(validateConfig(config).ok, false);
});

test("unsafe source basename is rejected", async () => {
 const config = await loadMinimalConfig();
 config.data.sources[0].file = "../evil.parquet";
 const result = validateConfig(config);
 assert.equal(result.ok, false);
});

test("embedded delivery mode is rejected", async () => {
 const config = await loadMinimalConfig();
 config.data.mode = "embedded";
 const result = validateConfig(config);
 assert.equal(result.ok, false);
 assert.ok(result.issues.some((issue) => issue.path === "data.mode"));
});

test("embedded source content is rejected", async () => {
 const config = await loadMinimalConfig();
 config.data.sources[0].content = {
  encoding: "base64",
  value: Buffer.from("station\nSJ").toString("base64"),
 };
 const result = validateConfig(config);
 assert.equal(result.ok, false);
 assert.ok(
  result.issues.some((issue) =>
   `${issue.path} ${issue.message}`.includes("content"),
  ),
 );
});

test("unknown source type is rejected", async () => {
 const config = await loadMinimalConfig();
 config.data.sources[0].type = "xlsx";
 assert.equal(validateConfig(config).ok, false);
});

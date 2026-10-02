/**
 * Manifest selector for live Parquet file sets (spec 2026-09-28-0004 §2.1,
 * LT-03, LT-07): `selector: {manifest: "s3://.../manifest.json"}` resolves
 * relative keys under the declared prefix. Membership validation is a pure
 * seam that rejects traversal, out-of-prefix, and malformed entries before
 * any view can publish them, deduplicates exact keys, and enforces the
 * 2 MiB manifest / 10,000-file caps. The authoring compiler admits exactly
 * one selector (glob XOR manifest) and keeps the manifest declaration out of
 * every packaged artifact.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import { manifestParquetFiles } from "../../runtime/sources.mjs";

const PREFIX = "s3://reports/sales/";
const MANIFEST = "s3://reports/sales/manifest.json";

/** Resolve one manifest document text, returning its error instead of throwing. */
function rejectsWith(text) {
 try {
  return { resolved: manifestParquetFiles("sales", PREFIX, MANIFEST, text) };
 } catch (error) {
  return error;
 }
}

/** Build one manifest document from JSON-encoded entries. */
function manifestOf(entriesJson) {
 return `{"files": ${entriesJson}}`;
}

test("a manifest traversal entry is rejected before any membership resolves", () => {
 const error = rejectsWith(
  manifestOf('["year=2026/part-1.parquet", "../escape.parquet"]'),
 );
 assert.ok(error instanceof Error, "the traversal manifest must be rejected");
 assert.equal(error.sourceId, "sales");
 assert.equal(error.code, "sources.parquet-set-manifest-entry");
 assert.match(error.message, /source "sales"/);
 assert.match(error.message, /\.\.\/escape\.parquet/);
 // No partial membership escapes the seam: the rejected manifest yields no
 // file list at all.
 const crossPrefix = rejectsWith(
  manifestOf('["../../other-prefix/part-1.parquet"]'),
 );
 assert.ok(crossPrefix instanceof Error);
 assert.equal(crossPrefix.code, "sources.parquet-set-manifest-entry");
});

test("manifest entries must stay relative Parquet keys under the prefix", () => {
 for (const entry of [
  "/year=2026/part-1.parquet", // absolute key
  "s3://other-bucket/part-1.parquet", // URL, not a relative key
  "https://example.com/part-1.parquet",
  "other-prefix/part-1.parquet?version=1", // query on a key
  "other-prefix/part-1.parquet#frag",
  "year=2026\\part-1.parquet", // backslash separator
  "year=2026/part-1.csv", // not a Parquet object
  "year=2026/part-1.parquet/", // trailing slash, not a Parquet object
  "", // empty entry
  "  ", // blank entry
  "year=2026/part-\u0007.parquet", // control character
  "year=2026/../../other/part-1.parquet", // deep traversal
 ]) {
  const error = rejectsWith(manifestOf(JSON.stringify([entry])));
  assert.ok(
   error instanceof Error,
   `entry ${JSON.stringify(entry)} must be rejected`,
  );
  assert.equal(error.sourceId, "sales");
  assert.equal(error.code, "sources.parquet-set-manifest-entry");
 }
 for (const entry of [2026, null, { key: "year=2026/part-1.parquet" }]) {
  const error = rejectsWith(manifestOf(JSON.stringify([entry])));
  assert.ok(
   error instanceof Error,
   `non-string entry ${JSON.stringify(entry)} must be rejected`,
  );
  assert.equal(error.code, "sources.parquet-set-manifest-entry");
 }
});

test("manifest documents must be readable JSON objects with a files list", () => {
 for (const text of [
  "",
  "   ",
  "not json",
  '{"files": [',
  '{"files": ["a.parquet"]}{"files": ["b.parquet"]}',
  '["a.parquet"]',
  "5",
  '{"entries": ["a.parquet"]}',
  '{"files": "a.parquet"}',
  '{"files": null}',
 ]) {
  const error = rejectsWith(text);
  assert.ok(
   error instanceof Error,
   `manifest ${JSON.stringify(text)} must be rejected`,
  );
  assert.equal(error.code, "sources.parquet-set-manifest");
 }
 // An empty files list resolves no Parquet files.
 const empty = rejectsWith(manifestOf("[]"));
 assert.equal(empty.code, "sources.parquet-set-empty");
});

test("a valid manifest deduplicates exact keys, preserves case, and sorts", () => {
 const resolved = rejectsWith(
  manifestOf(
   '["year=2026/part-2.parquet", "part-0.parquet", "year=2026/Part-1.parquet", "part-0.parquet", "year=2026/part-2.parquet"]',
  ),
 );
 assert.ok(Array.isArray(resolved.resolved));
 assert.deepEqual(resolved.resolved, [
  `${PREFIX}part-0.parquet`,
  `${PREFIX}year=2026/Part-1.parquet`,
  `${PREFIX}year=2026/part-2.parquet`,
 ]);
 // Exact duplicates collapse; case-distinct keys stay distinct.
 assert.equal(new Set(resolved.resolved).size, 3);
});

test("manifest caps: 2 MiB documents and 10,000 files are hard limits", () => {
 // A document of ~2 UTF-16 chars per entry is over 2 MiB bytes and values.
 const shortEntries = Array.from({ length: 2 * 1024 * 1024 }, () => '"y"');
 const oversized = `{"files": [${shortEntries.join(",")}]}`;
 const sizeError = rejectsWith(oversized);
 assert.equal(sizeError.code, "sources.parquet-set-manifest-size");
 const tooMany = Array.from({ length: 10_001 }, (_, index) => "p-" + index + ".parquet");
 const limitError = rejectsWith(manifestOf(JSON.stringify(tooMany)));
 assert.equal(limitError.code, "sources.parquet-set-limit");
 // 10,000 unique keys (after exact duplicates collapse) still resolve.
 const atLimitEntries = [
  ...Array.from({ length: 10_000 }, (_, index) => "p-" + index + ".parquet"),
  "p-0.parquet",
 ];
 const atLimit = rejectsWith(manifestOf(JSON.stringify(atLimitEntries)));
 assert.ok(Array.isArray(atLimit.resolved));
 assert.equal(atLimit.resolved.length, 10_000);
});

/** Compile one minimal project with the given remote declaration. */
async function project(remote) {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-manifest-"));
 await mkdir(path.join(dir, "queries"));
 await writeFile(
  path.join(dir, "dashboard.yaml"),
  `project: 1
title: Manifest dashboard
sources:
  - id: sales
    schema:
      station: {type: string, nullable: false}
    remote: ${remote}
filters: []
relationships: []
queries:
  total: {sql: queries/total.sql, params: []}
layout:
  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}
`,
 );
 await writeFile(
  path.join(dir, "queries", "total.sql"),
  "SELECT count(*) AS value FROM sales\n",
 );
 return path.join(dir, "dashboard.yaml");
}

test("a manifest selector compiles its declaration without any file inventory", async () => {
 const dashboard = await project(
  `{kind: parquet-set, uri: s3://reports/sales/, selector: {manifest: s3://reports/sales/manifest.json}, auth: s3, region: eu-central-1, delivery: live}`,
 );
 const { config, json, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0].remote, {
  kind: "parquet-set",
  uri: "s3://reports/sales/",
  selector: { manifest: "s3://reports/sales/manifest.json" },
  auth: "s3",
  region: "eu-central-1",
 });
 assert.equal(validateConfig(config).ok, true);
 assert.deepEqual(remoteSources, [], "live-only manifest sets never materialize");
 // The compiled config carries only the declared non-secret locations.
 assert.equal(json.includes("manifest.json"), true);
 assert.equal(json.includes("part-1.parquet"), false);
});

test("selector conflicts and invalid manifest URIs fail naming the source and field", async () => {
 const cases = [
  {
   remote: `{kind: parquet-set, uri: s3://reports/sales/, selector: {glob: "part-*.parquet", manifest: s3://reports/sales/manifest.json}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*"glob" and "manifest"/,
  },
  {
   remote: `{kind: parquet-set, uri: s3://reports/sales/, selector: {manifest: s3://reports/manifest.json, glob: "part-*.parquet"}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*"glob" and "manifest"/,
  },
  {
   remote: `{kind: parquet-set, uri: s3://reports/sales/, selector: {}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*exactly one of "glob" or "manifest"/,
  },
  {
   remote: `{kind: parquet-set, uri: s3://reports/sales/, selector: {manifest: https://example.com/manifest.json}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*manifest.*s3:\/\/.*\.json/,
  },
  {
   remote: `{kind: parquet-set, uri: s3://reports/sales/, selector: {manifest: s3://reports/sales/manifest.txt}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*manifest.*\.json/,
  },
  {
   remote: `{uri: s3://reports/sales/manifest.json, format: parquet, auth: none, selector: {manifest: s3://reports/sales/manifest.json}}`,
   match: /dashboard\.yaml:\d+:\d+.*source "sales".*selector requires remote\.kind: parquet-set/,
  },
 ];
 for (const fixture of cases) {
  const dashboard = await project(fixture.remote);
  await assert.rejects(() => compileProject(dashboard), fixture.match);
 }
});

const BASE_RUNTIME_CONFIG = {
 contract: 2,
 app: "grid",
 title: "Manifest runtime",
 data: {
  mode: "upload",
  sources: [
   {
    id: "sales",
    schema: { station: { type: "string", nullable: false } },
    remote: {
     kind: "parquet-set",
     uri: "s3://reports/sales/",
     selector: { manifest: "s3://reports/sales/manifest.json" },
     auth: "none",
    },
   },
  ],
 },
 filters: [],
 queries: { total: { sql: "SELECT count(*) AS value FROM sales", params: [] } },
 layout: [
  {
   id: "total",
   type: "kpi",
   query: "total",
   label: "Total",
   field: "value",
   x: 1,
   y: 1,
   width: 12,
   height: 1,
  },
 ],
};

test("runtime configs accept exactly one manifest selector shape", () => {
 assert.equal(validateConfig(BASE_RUNTIME_CONFIG).ok, true);
 for (const selector of [
  { glob: "part-*.parquet", manifest: "s3://reports/sales/manifest.json" },
  {},
  { manifest: "s3://reports/sales/manifest.txt" },
  { manifest: "https://example.com/manifest.json" },
  { manifest: "s3://reports/sales/manifest.json", extra: true },
 ]) {
  const config = structuredClone(BASE_RUNTIME_CONFIG);
  config.data.sources[0].remote.selector = selector;
  assert.equal(
   validateConfig(config).ok,
   false,
   JSON.stringify(selector),
  );
 }
 // A manifest selector without the parquet-set kind stays inadmissible.
 const single = structuredClone(BASE_RUNTIME_CONFIG);
 delete single.data.sources[0].remote.kind;
 assert.equal(validateConfig(single).ok, false);
});

test("packaged artifacts carry no manifest bytes or inventory", async () => {
 const dashboard = await project(
  `{kind: parquet-set, uri: s3://reports/sales/, selector: {manifest: s3://reports/sales/manifest.json}, auth: none, delivery: live}`,
 );
 const { config, remoteSources } = await compileProject(dashboard);
 const serialized = JSON.stringify(config);
 assert.equal(serialized.includes("parquetFiles"), false);
 assert.equal(serialized.includes("part-"), false);
 assert.deepEqual(remoteSources, []);
});

test("the native profiler resolves a manifest set with dedupe and no private paths", async () => {
 const { execFile } = await import("node:child_process");
 const { readFile } = await import("node:fs/promises");
 const http = await import("node:http");
 const { promisify } = await import("node:util");
 const execFileAsync = promisify(execFile);
 const bytes = await readFile(
  new URL("../../.artifacts/fixtures/inspections.parquet", import.meta.url),
 );
 const control = { files: ["part-1.parquet", "part-2.parquet", "part-1.parquet"] };
 const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const body = request.url === "/reports/manifest.json"
   ? Buffer.from(JSON.stringify({ files: control.files }))
   : bytes;
  if (request.method === "HEAD") {
   response.writeHead(200, {
    "Content-Length": body.length,
    "Accept-Ranges": "bytes",
   });
   response.end();
   return;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
  if (match) {
   const start = match[1] === "" ? Math.max(0, body.length - Number(match[2])) : Number(match[1]);
   const end = match[2] === "" || match[1] === ""
    ? body.length - 1
    : Math.min(Number(match[2]), body.length - 1);
   const slice = body.subarray(start, end + 1);
   response.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${body.length}`,
    "Content-Length": slice.length,
    "Accept-Ranges": "bytes",
   });
   response.end(slice);
   return;
  }
  response.writeHead(200, { "Content-Length": body.length });
  response.end(body);
 });
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 const host = `127.0.0.1:${server.address().port}`;
 const env = {};
 for (const [key, value] of Object.entries(process.env)) {
  if (!/^(AWS|FTHR_S3)_/.test(key)) env[key] = value;
 }
 env.HOME = new URL("../../.artifacts/test-home", import.meta.url).pathname;
 env.FTHR_S3_USE_SSL = "false";
 const runProfile = () =>
  execFileAsync(
   process.execPath,
   [
    new URL("../../bin/featherbi.mjs", import.meta.url).pathname,
    "profile",
    "--input", "s3://reports/reports/",
    "--source-id", "sales",
    "--format", "parquet",
    "--auth", "none",
    "--endpoint", host,
    "--manifest", "s3://reports/manifest.json",
   ],
   { env, maxBuffer: 100_000 },
  );
 try {
  const { stdout } = await runProfile();
  const value = JSON.parse(stdout);
  // The duplicate entry collapses: 2 parts x 5 rows.
  assert.equal(value.row_count, 10);
  assert.equal(value.kind, "parquet-set");
  assert.equal(value.file_count, 2);
  assert.deepEqual(value.selector, { manifest: "s3://reports/manifest.json" });
  // Portable output: counts and the declared selector only.
  assert.equal(stdout.includes("part-1.parquet"), false);
  assert.equal(stdout.includes("127.0.0.1"), false);
  // A traversal manifest fails naming the source before any read.
  control.files = ["part-1.parquet", "../escape.parquet"];
  await assert.rejects(runProfile, (error) => {
   assert.match(error.stderr, /source 'sales'/);
   assert.match(error.stderr, /\.\.\/escape\.parquet/);
   return true;
  });
 } finally {
  await new Promise((resolve) => server.close(resolve));
 }
});

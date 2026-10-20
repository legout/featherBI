/**
 * Delta export command (spec 2026-10-19-0005 §4 / SL-05, ticket #41):
 * `featherbi export delta --input <table location> --output <directory>` turns
 * the current Delta snapshot into immutable `<export-id>/part-NNN.parquet`
 * files plus the root `manifest.json` `{"files": [...]}` and an `export.json`
 * sidecar (Delta version, export time). The pinned DuckDB 1.5.5 Delta
 * extension is read-only, so this fixture follows the Delta protocol by hand
 * (real Parquet parts plus `_delta_log` add/remove commits; update = remove +
 * rewritten add, delete = remove), as proven by
 * project/research/delta-native-export-probe.md. Native `delta_scan` is the
 * independent oracle: exported counts must equal it after an update and a
 * delete, and a re-export must leave every previous part file byte-identical.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { manifestParquetFiles } from "../../runtime/sources.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

// Hand-authored Delta fixture parts and the oracle comparisons. The official
// Delta extension has no native DML writer, so parts are plain DuckDB Parquet
// writes and the log commits come from the test.
const HELPER = `# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Fixture parts and the delta_scan oracle for the export-delta test."""
import json
import sys
from pathlib import Path

import duckdb

# (id, station, status); station XX lives only in f2, update targets ids 1 and 4.
ROWS = {
    1: ("YY", "open"), 2: ("ZZ", "open"), 3: ("YY", "open"), 4: ("ZZ", "open"),
    5: ("YY", "open"), 6: ("ZZ", "open"), 7: ("YY", "open"), 8: ("XX", "open"),
    9: ("XX", "open"), 10: ("XX", "open"), 11: ("XX", "open"), 12: ("ZZ", "open"),
    13: ("YY", "open"),
}
PARTS = {
    "f1.parquet": (1, 2, 3, 4, 5, 6),
    "f1-fixed.parquet": (1, 2, 3, 4, 5, 6),
    "f2.parquet": (7, 8, 9, 10, 11, 12),
    "f2-kept.parquet": (7, 12),
    "f3.parquet": (13,),
}


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def write_parts(directory):
    con = duckdb.connect()
    for name, ids in PARTS.items():
        rows = []
        for row_id in ids:
            station, status = ROWS[row_id]
            if name == "f1-fixed.parquet" and row_id in (1, 4):
                status = "fixed"
            rows.append("(" + str(row_id) + ",'" + station + "','" + status + "')")
        values = ",".join(rows)
        con.execute(
            "COPY (SELECT * FROM (VALUES " + values + ") AS t(id, station, status)) "
            "TO " + lit(Path(directory, name)) + " (FORMAT PARQUET)"
        )


def counts(con, relation):
    return list(
        con.execute(
            "SELECT count(*), count(*) FILTER (WHERE status = 'fixed'), "
            "count(*) FILTER (WHERE station = 'XX') FROM " + relation
        ).fetchone()
    )


def compare(table, parts, version=None):
    con = duckdb.connect()
    con.execute("LOAD delta")
    pinned = "" if version is None else ", version := " + str(version)
    delta = counts(con, "delta_scan(" + lit(table) + pinned + ")")
    exported = counts(con, "read_parquet(" + json.dumps(parts) + ")")
    left = con.execute(
        "SELECT count(*) FROM (SELECT * FROM delta_scan(" + lit(table) + pinned
        + ") EXCEPT ALL SELECT * FROM read_parquet(" + json.dumps(parts) + "))"
    ).fetchone()[0]
    right = con.execute(
        "SELECT count(*) FROM (SELECT * FROM read_parquet(" + json.dumps(parts)
        + ") EXCEPT ALL SELECT * FROM delta_scan(" + lit(table) + pinned + "))"
    ).fetchone()[0]
    print(json.dumps({
        "delta": delta,
        "exported": exported,
        "symmetric_difference": left + right,
    }))


if __name__ == "__main__":
    if sys.argv[1] == "write-parts":
        write_parts(sys.argv[2])
    elif sys.argv[1] == "compare":
        compare(sys.argv[2], sys.argv[3:])
    else:
        # compare-pinned <table> <version> <parts...>: the oracle reads the
        # exact pinned snapshot, not the table's current head.
        compare(sys.argv[2], sys.argv[4:], version=int(sys.argv[3]))
`;

const SCHEMA_STRING = JSON.stringify({
 type: "struct",
 fields: [
  { name: "id", type: "integer", nullable: true, metadata: {} },
  { name: "station", type: "string", nullable: true, metadata: {} },
  { name: "status", type: "string", nullable: true, metadata: {} },
 ],
});

/** One `_delta_log` commit file: one JSON object per line. */
function commit(actions) {
 return `${actions.map((action) => JSON.stringify(action)).join("\n")}\n`;
}

const commitInfo = (version, operation) => ({
 commitInfo: {
  timestamp: 1760000000000 + version * 1000,
  operation,
  operationParameters: {},
  clientVersion: "featherbi-export-delta-test",
 },
});

const add = (name, size) => ({
 add: {
  path: name,
  partitionValues: {},
  size,
  modificationTime: 1760000000000,
  dataChange: true,
 },
});

const remove = (name) => ({
 remove: { path: name, deletionTimestamp: 1760000000500, dataChange: true },
});

const logFile = (version) =>
 path.join("_delta_log", `${String(version).padStart(20, "0")}.json`);

async function runExport(table, output, env = process.env) {
 return execFileAsync(
  process.execPath,
  [
   path.join(rootDir, "bin", "featherbi.mjs"),
   "export",
   "delta",
   "--input", table,
   "--output", output,
  ],
  { env, maxBuffer: 100_000 },
 );
}

async function runHelper(helper, args) {
 const { stdout } = await execFileAsync("uv", ["run", "--script", helper, ...args], {
  maxBuffer: 100_000,
 });
 return JSON.parse(stdout);
}

async function sha256(file) {
 return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Write the fixture's v0–v2 `_delta_log` commits (the post-update,
 * post-delete 8-row snapshot; f3.parquet already sits on disk unreferenced
 * until a v3 commit lands). */
async function writeFixtureLog(table) {
 const size = async (name) => (await stat(path.join(table, name))).size;
 await writeFile(
  path.join(table, logFile(0)),
  commit([
   commitInfo(0, "WRITE"),
   { protocol: { minReaderVersion: 1, minWriterVersion: 1 } },
   {
    metaData: {
     id: "featherbi-export-delta-test",
     format: { provider: "parquet", options: {} },
     schemaString: SCHEMA_STRING,
     partitionColumns: [],
     configuration: {},
     createdTime: 1760000000000,
    },
   },
   add("f1.parquet", await size("f1.parquet")),
   add("f2.parquet", await size("f2.parquet")),
  ]),
 );
 await writeFile(
  path.join(table, logFile(1)),
  commit([
   commitInfo(1, "UPDATE"),
   remove("f1.parquet"),
   add("f1-fixed.parquet", await size("f1-fixed.parquet")),
  ]),
 );
 await writeFile(
  path.join(table, logFile(2)),
  commit([
   commitInfo(2, "DELETE"),
   remove("f2.parquet"),
   add("f2-kept.parquet", await size("f2-kept.parquet")),
  ]),
 );
}

/** One `key -> bytes` map of the table directory below the path-style
 * bucket root `/reports/`, the URL shape native DuckDB httpfs requests with
 * `URL_STYLE 'path'`. */
async function tableKeys(table) {
 const keys = new Map();
 for (const entry of await readdir(table, {
  recursive: true,
  withFileTypes: true,
 })) {
  if (entry.isFile()) {
   const file = path.join(entry.parentPath ?? entry.path, entry.name);
   const relative = path.relative(table, file).split(path.sep).join("/");
   keys.set(`table/${relative}`, await readFile(file));
  }
 }
 return keys;
}

/**
 * Serve the local Delta fixture as a path-style S3-compatible bucket over
 * plain HTTP from 127.0.0.1 — an isolated local fixture driven through the
 * existing author credential conventions (`FTHR_S3_*`, test-only values,
 * never printed). ListObjectsV2 (with `prefix`/`start-after`) plus object
 * HEAD/GET with Range covers everything native DuckDB httpfs and the Delta
 * kernel request. For the snapshot-race regression, the first `_delta_log`
 * listing returns v2; after that response flushes, the fixture commits v3.
 * Any later `_delta_log` listing waits until v3 is visible, guaranteeing the
 * scan would see a different head without version pinning.
 */
async function serveS3DeltaTable(table, control = {}) {
 let keys = await tableKeys(table);
 const reload = async () => {
  keys = await tableKeys(table);
 };
 const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://s3.local");
  if (url.pathname === "/reports" || url.pathname === "/reports/") {
   control.listings = (control.listings ?? 0) + 1;
   const prefix = url.searchParams.get("prefix") ?? "";
   const startAfter = url.searchParams.get("start-after") ?? "";
   const isDeltaLogListing = prefix.includes("_delta_log");
   if (isDeltaLogListing) {
    control.deltaLogListings = (control.deltaLogListings ?? 0) + 1;
   }
   if (control.commitPromise && isDeltaLogListing) {
    await control.commitPromise;
   }
   const matched = [...keys.keys()]
    .filter((key) => key.startsWith(prefix) && key > startAfter)
    .sort();
   const commitAfterThisListing =
    control.commitAfterDiscoveryListing &&
    isDeltaLogListing &&
    !control.commitPromise;
   const entries = matched
    .map(
     (key) =>
      `<Contents><Key>${key}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;etag&quot;</ETag><Size>${keys.get(key).length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join("");
   const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>reports</Name><Prefix>${prefix}</Prefix><KeyCount>${matched.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${entries}</ListBucketResult>`;
   response.writeHead(200, {
    "Content-Type": "application/xml",
    "Content-Length": Buffer.byteLength(body),
   });
   if (commitAfterThisListing) {
    control.commitPromise = new Promise((resolve) => {
     control.resolveCommit = resolve;
    });
   }
   response.end(body, () => {
    if (commitAfterThisListing) {
     (async () => {
      try {
       const info = await stat(path.join(table, "f3.parquet"));
       await writeFile(
        path.join(table, logFile(3)),
        commit([commitInfo(3, "WRITE"), add("f3.parquet", info.size)]),
       );
       await reload();
       control.committed = true;
      } catch (error) {
       control.commitError = error;
      } finally {
       control.resolveCommit();
      }
     })();
    }
   });
   return;
  }
  const key = url.pathname.replace(/^\/reports\//, "");
  const bytes = keys.get(key);
  if (bytes === undefined) {
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
   return;
  }
  if (request.method === "HEAD") {
   response.writeHead(200, {
    "Content-Length": bytes.length,
    "Accept-Ranges": "bytes",
   });
   response.end();
   return;
  }
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
  if (range) {
   const start =
    range[1] === "" ? Math.max(0, bytes.length - Number(range[2])) : Number(range[1]);
   const end =
    range[2] === "" || range[1] === ""
     ? bytes.length - 1
     : Math.min(Number(range[2]), bytes.length - 1);
   const slice = bytes.subarray(start, end + 1);
   response.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    "Content-Length": slice.length,
    "Accept-Ranges": "bytes",
   });
   response.end(slice);
   return;
  }
  response.writeHead(200, {
   "Content-Length": bytes.length,
   "Accept-Ranges": "bytes",
  });
  response.end(bytes);
 });
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  host: `127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/**
 * Author-credential environment for the S3-compatible input: a fresh HOME so
 * the AWS credential chain finds nothing and the `FTHR_S3_*` fallback (with
 * its endpoint override) applies — the developer's real credentials never
 * reach the fixture — while the already-installed DuckDB extensions and the
 * uv cache stay reachable so nothing downloads (offline).
 */
async function s3AuthorEnv(host) {
 const realHome = os.homedir();
 const installed = path.join(realHome, ".duckdb", "extensions", "v1.5.5");
 assert.equal(
  (await stat(installed)).isDirectory(),
  true,
  "the pinned DuckDB v1.5.5 extension cache (delta, httpfs) must already be installed",
 );
 const home = path.join(rootDir, ".artifacts", "export-delta-home");
 const extensions = path.join(home, ".duckdb", "extensions");
 await mkdir(extensions, { recursive: true });
 await rm(path.join(extensions, "v1.5.5"), { recursive: true, force: true });
 await symlink(installed, path.join(extensions, "v1.5.5"));
 const env = {};
 for (const [key, value] of Object.entries(process.env)) {
  if (!/^(AWS|FTHR_S3)_/.test(key)) env[key] = value;
 }
 env.HOME = home;
 env.UV_OFFLINE = "1";
 if (!env.UV_CACHE_DIR) {
  const cache = path.join(realHome, ".cache", "uv");
  if ((await stat(cache).catch(() => null))?.isDirectory()) env.UV_CACHE_DIR = cache;
 }
 // uv's managed interpreters live under the real HOME too; without them the
 // fresh HOME falls back to a PATH Python whose pinned duckdb wheel is not
 // cached, which offline resolution cannot satisfy.
 if (!env.UV_PYTHON_INSTALL_DIR) {
  const pythons = path.join(realHome, ".local", "share", "uv", "python");
  if ((await stat(pythons).catch(() => null))?.isDirectory()) env.UV_PYTHON_INSTALL_DIR = pythons;
 }
 // Test-only values for the local fixture; never printed anywhere.
 env.FTHR_S3_KEY_ID = "featherbi-test-key";
 env.FTHR_S3_SECRET = "featherbi-test-secret";
 env.FTHR_S3_REGION = "us-east-1";
 env.FTHR_S3_ENDPOINT = host;
 env.FTHR_S3_USE_SSL = "false";
 return env;
}

/** Build the shared fixture (parts + v0–v2 log) at `<dir>/table`. */
async function buildTable(dir) {
 const table = path.join(dir, "table");
 await mkdir(path.join(table, "_delta_log"), { recursive: true });
 const helper = path.join(dir, "oracle.py");
 await writeFile(helper, HELPER, "utf8");
 await execFileAsync("uv", ["run", "--script", helper, "write-parts", table]);
 await writeFixtureLog(table);
 return { table, helper };
}

test("export delta matches delta_scan after update and delete, and a re-export never rewrites a part", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-export-delta-"));
 const { table, helper } = await buildTable(dir);
 const output = path.join(dir, "published");

 // v0: 12 rows in f1 + f2. v1 update: ids 1 and 4 become 'fixed' (remove f1,
 // rewritten add). v2 delete: station XX rows disappear with f2 (remove f2,
 // keep surviving ids 7 and 12). Current snapshot: 8 rows, 2 fixed, 0 XX.

 // First export of the current (post-update, post-delete) snapshot.
 const first = await runExport(table, output);
 assert.equal(first.stdout.includes(dir), false, "stdout must not leak local paths");
 const firstManifestText = await readFile(path.join(output, "manifest.json"), "utf8");
 const firstManifest = JSON.parse(firstManifestText);
 assert.deepEqual(
  Object.keys(firstManifest),
  ["files"],
  "manifest.json is exactly the public {\"files\": [...]} contract",
 );
 const firstEntries = firstManifest.files;
 assert.ok(firstEntries.length >= 1, "the export produced at least one part");
 for (const entry of firstEntries) {
  assert.match(entry, /^exp-\d{8}-[0-9a-f]{4}\/part-\d{3}\.parquet$/);
 }
 // The exported manifest is accepted by the existing manifest selector seam.
 assert.deepEqual(
  manifestParquetFiles(
   "exported",
   "s3://reports/export/",
   "s3://reports/export/manifest.json",
   firstManifestText,
  ),
  firstEntries.map((entry) => `s3://reports/export/${entry}`),
 );
 const firstSidecar = JSON.parse(await readFile(path.join(output, "export.json"), "utf8"));
 assert.equal(firstSidecar.delta_version, 2);
 assert.ok(!Number.isNaN(Date.parse(firstSidecar.exported_at)));

 // Failure mode (a): exported rows/counts equal native delta_scan, not the
 // exporter's own claim. Expected values are authored from the fixture above.
 const firstCheck = await runHelper(helper, [
  "compare",
  table,
  ...firstEntries.map((entry) => path.join(output, entry)),
 ]);
 assert.deepEqual(firstCheck.exported, [8, 2, 0]);
 assert.deepEqual(firstCheck.delta, [8, 2, 0]);
 assert.equal(firstCheck.symmetric_difference, 0);

 // Failure mode (b): after an observable append (v3 adds id 13), a re-export
 // keeps every previous part file byte-identical and points the manifest at
 // the new export only.
 const firstHashes = new Map();
 for (const entry of firstEntries) {
  firstHashes.set(entry, await sha256(path.join(output, entry)));
 }
 await writeFile(
  path.join(table, logFile(3)),
  commit([
   commitInfo(3, "WRITE"),
   add("f3.parquet", (await stat(path.join(table, "f3.parquet"))).size),
  ]),
 );
 const second = await runExport(table, output);
 assert.equal(second.stdout.includes(dir), false);
 for (const [entry, hash] of firstHashes) {
  assert.equal(
   await sha256(path.join(output, entry)),
   hash,
   `previous part ${entry} must keep its bytes`,
  );
 }
 const secondManifest = JSON.parse(
  await readFile(path.join(output, "manifest.json"), "utf8"),
 );
 for (const entry of secondManifest.files) {
  assert.equal(
   firstHashes.has(entry),
   false,
   "a re-export must write new part paths, not reuse old ones",
  );
 }
 // Only the root manifest and sidecar may be overwritten; nothing else sits at
 // the published root.
 const rootFiles = (await readdir(output, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
 assert.deepEqual(rootFiles, ["export.json", "manifest.json"]);
 const secondSidecar = JSON.parse(await readFile(path.join(output, "export.json"), "utf8"));
 assert.equal(secondSidecar.delta_version, 3);
 const secondCheck = await runHelper(helper, [
  "compare",
  table,
  ...secondManifest.files.map((entry) => path.join(output, entry)),
 ]);
 assert.deepEqual(secondCheck.exported, [9, 2, 0]);
 assert.deepEqual(secondCheck.delta, [9, 2, 0]);
 assert.equal(secondCheck.symmetric_difference, 0);
});

test("a native-readable s3 table location exports its snapshot", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-export-delta-"));
 const { table, helper } = await buildTable(dir);
 const output = path.join(dir, "published");
 const fixture = await serveS3DeltaTable(table);
 try {
  const env = await s3AuthorEnv(fixture.host);
  const result = await runExport("s3://reports/table", output, env);
  assert.equal(result.stdout.includes(dir), false, "stdout must not leak local paths");
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest), ["files"]);
  assert.ok(manifest.files.length >= 1);
  for (const entry of manifest.files) {
   assert.match(entry, /^exp-\d{8}-[0-9a-f]{4}\/part-\d{3}\.parquet$/);
  }
  const sidecar = JSON.parse(await readFile(path.join(output, "export.json"), "utf8"));
  assert.equal(sidecar.delta_version, 2);
  assert.ok(!Number.isNaN(Date.parse(sidecar.exported_at)));
  // The exported rows equal native delta_scan of the same fixture (8 rows,
  // 2 fixed, 0 XX after the update and delete), not the exporter's claim.
  const check = await runHelper(helper, [
   "compare",
   table,
   ...manifest.files.map((entry) => path.join(output, entry)),
  ]);
  assert.deepEqual(check.exported, [8, 2, 0]);
  assert.deepEqual(check.delta, [8, 2, 0]);
  assert.equal(check.symmetric_difference, 0);
 } finally {
  await fixture.close();
 }
});

test("a commit between version discovery and the scan cannot be misidentified by the sidecar", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-export-delta-"));
 const { table, helper } = await buildTable(dir);
 const output = path.join(dir, "published");
 // The fixture server lands the v3 commit (f3.parquet adds id 13) in the
 // flush callback of the exporter's first `_delta_log` listing: after
 // version discovery recorded 2, before the COPY scans. Unpinned, that scan
 // would export 9 rows while export.json still says version 2.
 const control = { commitAfterDiscoveryListing: true };
 const fixture = await serveS3DeltaTable(table, control);
 try {
  const env = await s3AuthorEnv(fixture.host);
  await runExport("s3://reports/table", output, env);
  await control.commitPromise;
  assert.equal(control.commitError, undefined, "the fixture must commit v3 successfully");
  assert.equal(control.committed, true, "the fixture must have raced a v3 commit in");
  assert.ok(
   control.deltaLogListings >= 2,
   "the scan must list the Delta log again after the version discovery",
  );
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  const sidecar = JSON.parse(await readFile(path.join(output, "export.json"), "utf8"));
  // The sidecar identifies the exact exported snapshot: version 2, not the
  // v3 that landed mid-export.
  assert.equal(sidecar.delta_version, 2);
  const parts = manifest.files.map((entry) => path.join(output, entry));
  // The pinned native oracle (delta_scan at version 2) matches the export
  // byte-for-byte in row multiset: 8 rows, 2 fixed, 0 XX.
  const pinned = await runHelper(helper, ["compare-pinned", table, "2", ...parts]);
  assert.deepEqual(pinned.exported, [8, 2, 0]);
  assert.deepEqual(pinned.delta, [8, 2, 0]);
  assert.equal(pinned.symmetric_difference, 0);
  // The raced commit is real: the table's current head is v3 with 9 rows —
  // different from what was exported — so the pinned snapshot above is not
  // vacuously equal to the head.
  const current = await runHelper(helper, ["compare", table, ...parts]);
  assert.deepEqual(current.delta, [9, 2, 0]);
  assert.deepEqual(current.exported, [8, 2, 0]);
  assert.equal(current.symmetric_difference, 1);
 } finally {
  await fixture.close();
 }
});

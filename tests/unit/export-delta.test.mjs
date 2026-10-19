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
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
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


def compare(table, parts):
    con = duckdb.connect()
    con.execute("LOAD delta")
    delta = counts(con, "delta_scan(" + lit(table) + ")")
    exported = counts(con, "read_parquet(" + json.dumps(parts) + ")")
    left = con.execute(
        "SELECT count(*) FROM (SELECT * FROM delta_scan(" + lit(table)
        + ") EXCEPT ALL SELECT * FROM read_parquet(" + json.dumps(parts) + "))"
    ).fetchone()[0]
    right = con.execute(
        "SELECT count(*) FROM (SELECT * FROM read_parquet(" + json.dumps(parts)
        + ") EXCEPT ALL SELECT * FROM delta_scan(" + lit(table) + "))"
    ).fetchone()[0]
    print(json.dumps({
        "delta": delta,
        "exported": exported,
        "symmetric_difference": left + right,
    }))


if __name__ == "__main__":
    if sys.argv[1] == "write-parts":
        write_parts(sys.argv[2])
    else:
        compare(sys.argv[2], sys.argv[3:])
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

async function runExport(table, output) {
 return execFileAsync(
  process.execPath,
  [
   path.join(rootDir, "bin", "featherbi.mjs"),
   "export",
   "delta",
   "--input", table,
   "--output", output,
  ],
  { maxBuffer: 100_000 },
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

test("export delta matches delta_scan after update and delete, and a re-export never rewrites a part", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-export-delta-"));
 const table = path.join(dir, "table");
 const output = path.join(dir, "published");
 await mkdir(path.join(table, "_delta_log"), { recursive: true });
 const helper = path.join(dir, "oracle.py");
 await writeFile(helper, HELPER, "utf8");
 await execFileAsync("uv", ["run", "--script", helper, "write-parts", table]);
 const size = async (name) => (await stat(path.join(table, name))).size;

 // v0: 12 rows in f1 + f2. v1 update: ids 1 and 4 become 'fixed' (remove f1,
 // rewritten add). v2 delete: station XX rows disappear with f2 (remove f2,
 // keep surviving ids 7 and 12). Current snapshot: 8 rows, 2 fixed, 0 XX.
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
   add("f3.parquet", await size("f3.parquet")),
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

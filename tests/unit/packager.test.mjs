import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertSafeZipMembers, buildArtifact } from "../../packager/build.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

/** Serve one fixture from 127.0.0.1 with Range support; 404 for other names. */
async function serveFixture(fileName, { missing = [] } = {}) {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", fileName),
 );
 const server = http.createServer((request, response) => {
  const name = request.url.split("/").pop().split("?")[0];
  if (name !== fileName || missing.includes(name)) {
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
   return;
  }
  const range = request.headers.range;
  if (range) {
   // Return exactly the requested slice; httpfs rejects over-long bodies.
   const match = /bytes=(\d*)-(\d*)/.exec(range);
   const start = match[1] === "" ? Math.max(0, bytes.length - Number(match[2])) : Number(match[1]);
   const end = match[2] === "" || match[1] === "" ? bytes.length - 1 : Math.min(Number(match[2]), bytes.length - 1);
   const body = bytes.subarray(start, end + 1);
   response.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    "Content-Length": body.length,
    "Accept-Ranges": "bytes",
   });
   response.end(body);
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
  origin: `http://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

test("packaging produces one deterministic external-data ZIP", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-packager-"));
 const sourcePath = path.join(dir, "ap.json");
 const configPath = path.join(dir, "config.json");
 const config = {
  contract: 2,
  app: "grid",
  theme: "neutral",
  title: "</script><script>globalThis.__featherbiInjected = true</script>",
  data: {
   mode: "upload",
   sources: [
    {
     id: "ap",
     type: "json",
     file: "ap.json",
     schema: { station: { type: "string", nullable: false } },
    },
   ],
  },
  filters: [],
  queries: {
   summary: { sql: "SELECT count(*) AS records FROM ap", params: [] },
  },
  layout: [
   {
    id: "records",
    type: "kpi",
    query: "summary",
    field: "records",
    label: "Records",
    x: 1,
    y: 1,
    width: 12,
    height: 1,
   },
  ],
 };
 const sourcePayload = '[{"station":"SJ"}]';
 await writeFile(sourcePath, sourcePayload);
 await writeFile(configPath, JSON.stringify(config));

 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "../escape.json"]),
 );
 assert.throws(() => assertSafeZipMembers(["dashboard.html", "/escape.json"]));
 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "data\\escape.json"]),
 );
 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "dashboard.html"]),
 );
 assert.throws(() => assertSafeZipMembers(["ap.json", "AP.json"]));

 const zip = path.join(dir, "dashboard.zip");
 const zipCopy = path.join(dir, "dashboard-copy.zip");
 const options = {
  configPath,
  sources: { ap: sourcePath },
 };
 await buildArtifact({ ...options, outPath: zip });
 await buildArtifact({ ...options, outPath: zipCopy });
 assert.deepEqual(await readFile(zip), await readFile(zipCopy));

 const extracted = path.join(dir, "extracted");
 await execFileAsync("uv", [
  "run",
  "python",
  "-m",
  "zipfile",
  "-e",
  zip,
  extracted,
 ]);
 const html = await readFile(path.join(extracted, "dashboard.html"), "utf8");
 assert.doesNotMatch(html, /<\/script><script>globalThis\.__featherbiInjected/);
 assert.ok(!html.includes(sourcePayload), "HTML must not contain source bytes");
 assert.ok(
  !html.includes(sourcePath),
  "HTML must not contain local source paths",
 );
 assert.deepEqual(
  await readFile(path.join(extracted, "ap.json")),
  Buffer.from(sourcePayload),
 );

 const original = await readFile(zip);
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: zip }),
  /overwrite/i,
 );
 assert.deepEqual(await readFile(zip), original);
 const source = await readFile(sourcePath);
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: sourcePath, overwrite: true }),
  /must not replace/i,
 );
 assert.deepEqual(await readFile(sourcePath), source);

 await writeFile(configPath, JSON.stringify({ ...config, contract: 3 }));
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: zip, overwrite: true }),
  /invalid dashboard config/i,
 );
 assert.deepEqual(await readFile(zip), original);
 assert.equal(
  (await readdir(dir)).some((name) => name.endsWith(".tmp")),
  false,
 );
});

test("build materializes a remote source into the standard ZIP and fails atomically", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-remote-pack-"));
 await mkdir(path.join(dir, "queries"));
 await writeFile(
  path.join(dir, "dashboard.yaml"),
  `project: 1
title: Remote dashboard
sources:
  - id: inspections
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: true}
    remote:
      uri: https://example.com/inspections.parquet
      format: parquet
      auth: none
  - id: local_notes
    type: json
    file: local_notes.json
    schema:
      note: {type: string, nullable: false}
filters: []
queries:
  total: {sql: queries/total.sql, params: []}
layout:
  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}
`,
 );
 await writeFile(
  path.join(dir, "queries", "total.sql"),
  "SELECT count(*) AS value FROM inspections\n",
 );
 await execFileAsync(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  "compile",
  "--project", path.join(dir, "dashboard.yaml"),
 ]);
 const configDir = path.join(dir, ".featherbi");
 const configPath = path.join(configDir, "dashboard.config.json");
 const remotePath = path.join(configDir, "remote-sources.json");
 const remotes = JSON.parse(await readFile(remotePath, "utf8"));
 assert.deepEqual(remotes, [
  {
   id: "inspections",
   uri: "https://example.com/inspections.parquet",
   format: "parquet",
   auth: "none",
   filename: "inspections.parquet",
  },
 ]);

 const fixture = await serveFixture("inspections.parquet");
 const notesPath = path.join(dir, "local_notes.json");
 await writeFile(notesPath, '[{"note":"n"}]');
 const zip = path.join(dir, "dashboard.zip");
 const options = { configPath, sources: { local_notes: notesPath }, outPath: zip };

 // Owner machines materialize the declared https URI; tests substitute the
 // localhost fixture so the identical build path runs without external network.
 const declared = JSON.parse(await readFile(remotePath, "utf8"));
 declared[0].uri = `${fixture.origin}/inspections.parquet`;
 await writeFile(remotePath, `${JSON.stringify(declared, null, 2)}\n`);

 try {
  await buildArtifact(options);
  const extracted = path.join(dir, "extracted");
  await execFileAsync("uv", [
   "run", "python", "-m", "zipfile", "-e", zip, extracted,
  ]);
  const html = await readFile(path.join(extracted, "dashboard.html"), "utf8");
  assert.equal(html.includes("example.com"), false, "HTML must not carry remote metadata");
  assert.equal(html.includes(fixture.origin), false);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(JSON.stringify(config).includes("example.com"), false);
  assert.deepEqual(
   await readFile(path.join(extracted, "inspections.parquet")),
   await readFile(path.join(rootDir, ".artifacts", "fixtures", "inspections.parquet")),
  );
  assert.deepEqual(
   await readFile(path.join(extracted, "local_notes.json")),
   Buffer.from('[{"note":"n"}]'),
  );

  // Remote ids reject explicit --source assignments.
  await assert.rejects(
   () =>
    buildArtifact({
     ...options,
     sources: { inspections: notesPath, local_notes: notesPath },
    }),
   /source "inspections" is a remote source materialized at build time/,
  );

  // A failed materialization fails atomically naming the source.
  const original = await readFile(zip);
  declared[0].uri = `${fixture.origin}/missing.parquet`;
  await writeFile(remotePath, `${JSON.stringify(declared, null, 2)}\n`);
  await assert.rejects(
   () => buildArtifact({ ...options, overwrite: true }),
   /cannot materialize source "inspections"/,
  );
  assert.deepEqual(await readFile(zip), original);
  assert.equal(
   (await readdir(dir)).some((name) => name.endsWith(".tmp")),
   false,
  );
 } finally {
  await fixture.close();
 }
});

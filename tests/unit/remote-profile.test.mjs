import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

/** Serve one fixture file from 127.0.0.1 with Range support (httpfs needs it). */
async function serveFixture(fileName) {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", fileName),
 );
 const server = http.createServer((request, response) => {
  if (request.method === "HEAD") {
   response.writeHead(200, {
    "Content-Length": bytes.length,
    "Accept-Ranges": "bytes",
   });
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
  url: `http://127.0.0.1:${server.address().port}/${fileName}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/** Environment with a fresh HOME: no AWS/featherBI credentials, and a
 * gitignored per-repo cache for DuckDB's httpfs extension (auto-installed on
 * first LOAD like any other dependency; data endpoints stay localhost). */
async function credentiallessEnv() {
 const home = path.join(rootDir, ".artifacts", "test-home");
 await mkdir(home, { recursive: true });
 const env = {};
 for (const [key, value] of Object.entries(process.env)) {
  if (!/^(AWS|FTHR_S3)_/.test(key)) env[key] = value;
 }
 env.HOME = home;
 return env;
}

async function runProfile(input, extraArgs, env = process.env) {
 return execFileAsync(
  process.execPath,
  [
   path.join(rootDir, "bin", "featherbi.mjs"),
   "profile",
   "--input", input,
   "--source-id", "inspections",
   "--format", "parquet",
   ...extraArgs,
  ],
  { env, maxBuffer: 100_000 },
 );
}

test("profiles a localhost remote URI with bounded output and no URI or path inside", async () => {
 const fixture = await serveFixture("inspections.parquet");
 try {
  const { stdout } = await runProfile(fixture.url, [], await credentiallessEnv());
  const value = JSON.parse(stdout);
  assert.equal(value.source_id, "inspections");
  assert.equal(value.format, "parquet");
  assert.equal(value.row_count, 5);
  assert.equal(value.file_bytes, null);
  assert.equal(value.columns.length, 8);
  assert.equal(stdout.includes("127.0.0.1"), false);
  assert.equal(stdout.includes("inspections.parquet"), false);
  assert.equal(stdout.length < 15_000, true);
 } finally {
  await fixture.close();
 }
});

test("auth s3 without credentials fails naming the source and the required secret", async () => {
 const fixture = await serveFixture("inspections.parquet");
 try {
  await assert.rejects(
   async () => runProfile(fixture.url, ["--auth", "s3"], await credentiallessEnv()),
   (error) => {
    assert.match(error.code === undefined ? "" : String(error), /exited/i);
    assert.match(error.stderr, /source 'inspections'/);
    assert.match(error.stderr, /FTHR_S3_KEY_ID/);
    assert.match(error.stderr, /FTHR_S3_SECRET/);
    assert.equal(error.stderr.includes("127.0.0.1"), false);
    return true;
   },
  );
 } finally {
  await fixture.close();
 }
});

test("profile errors scrub the input path from local reads", async () => {
 const scratch = await mkdtemp(path.join(os.tmpdir(), "featherbi-remote-"));
 await assert.rejects(
  async () =>
   runProfile(path.join(scratch, "missing.parquet"), [], await credentiallessEnv()),
  (error) => {
   assert.match(error.stderr, /source 'inspections'/);
   assert.equal(error.stderr.includes(scratch), false);
   return true;
  },
 );
});

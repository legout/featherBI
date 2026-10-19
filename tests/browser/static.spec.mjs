/**
 * Static build target (spec 2026-10-19-0005 §2; SL-02/SL-04): the real CLI
 * writes exactly one dashboard.html for a live-source project. The page is
 * served from one local origin and reads a public live CSV fixture from a
 * separate https origin with CORS — no file selection — and the output
 * carries no dataset bytes, local absolute paths, or author credentials.
 */

import { execFile } from "node:child_process";
import { readFile, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const workDir = path.join(rootDir, ".artifacts", "browser", "static-target");
const projectDir = path.join(workDir, "project");
const outputDir = path.join(workDir, "output");
const pagePath = path.join(outputDir, "dashboard.html");
const DATASET_SENTINEL = "ZZ-STATIC-DATASET-SENTINEL";
const CREDENTIAL_SENTINEL = "zz-static-credential-sentinel";

async function cli(...args) {
 return execFileAsync(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  ...args,
 ]);
}

/** Serve the static output directory from one local http origin. */
async function serveStaticDir(dir) {
 const server = http.createServer(async (request, response) => {
  if (request.url.split("?")[0] !== "/dashboard.html") {
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
   return;
  }
  const bytes = await readFile(path.join(dir, "dashboard.html"));
  response.writeHead(200, {
   "Content-Type": "text/html; charset=utf-8",
   "Content-Length": bytes.length,
  });
  response.end(bytes);
 });
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `http://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/**
 * Serve the live CSV fixture from a separate https origin with permissive
 * CORS and Range support, mirroring a public data host. The certificate is
 * self-signed for localhost; the recipient context ignores TLS errors.
 */
async function serveLiveFixture(bytes) {
 const cert = await selfSignedLocalhostCert();
 const server = https.createServer(cert, (request, response) => {
  if (request.url.split("/").pop().split("?")[0] !== "stations.csv") {
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
   return;
  }
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Range, If-Range");
  if (request.method === "OPTIONS") {
   response.writeHead(204);
   response.end();
   return;
  }
  const range = request.headers.range;
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
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
  origin: `https://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

async function selfSignedLocalhostCert() {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-static-tls-"));
 const keyPath = path.join(dir, "key.pem");
 const certPath = path.join(dir, "cert.pem");
 try {
  await execFileAsync(
   "openssl",
   [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
   ],
   { timeout: 30_000 },
  );
  return {
   key: await readFile(keyPath),
   cert: await readFile(certPath),
  };
 } finally {
  await rm(dir, { recursive: true, force: true });
 }
}

let staticHost;
let liveHost;

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
 await rm(workDir, { recursive: true, force: true });
 const csv = Buffer.from(
  `station,amount\nSJ,3\nSD,5\n${DATASET_SENTINEL},7\n`,
  "utf8",
 );
 liveHost = await serveLiveFixture(csv);

 // One live single-file source, authored against a placeholder public URI.
 await mkdir(path.join(projectDir, "queries"), { recursive: true });
 await writeFile(
  path.join(projectDir, "dashboard.yaml"),
  `project: 1
title: Static live dashboard
sources:
  - id: live_station
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: true}
    remote:
      uri: https://fixture.example/stations.csv
      format: csv
      auth: none
      delivery: live
filters: []
queries:
  records: {sql: queries/records.sql, params: []}
layout:
  - {id: kpi_records, type: kpi, query: records, field: records, label: Records, x: 1, y: 1, width: 12, height: 1}
`,
 );
 await writeFile(
  path.join(projectDir, "queries", "records.sql"),
  "SELECT count(*) AS records FROM live_station\n",
 );
 await cli("compile", "--project", path.join(projectDir, "dashboard.yaml"));

 // Point the compiled live declaration at the local https fixture host —
 // the same delivery:live authoring decision, resolved to a test origin.
 const configPath = path.join(projectDir, ".featherbi", "dashboard.config.json");
 const config = JSON.parse(await readFile(configPath, "utf8"));
 config.data.sources[0].remote.uri = `${liveHost.origin}/stations.csv`;
 await writeFile(configPath, JSON.stringify(config, null, 2));

 await execFileAsync(
  process.execPath,
  [
   path.join(rootDir, "bin", "featherbi.mjs"),
   "build", "--target", "static",
   "--config", configPath,
   "--output", pagePath,
  ],
  { env: { ...process.env, FTHR_S3_SECRET: CREDENTIAL_SENTINEL } },
 );
 staticHost = await serveStaticDir(outputDir);
});

test.afterAll(async () => {
 await staticHost?.close();
 await liveHost?.close();
});

test("the static dashboard.html loads its live source cross-origin without file selection", async ({
 browser,
}) => {
 // SL-02: the output is exactly one file.
 const assert = (await import("node:assert/strict")).default;
 assert.deepEqual(await readdir(outputDir), ["dashboard.html"]);
 const html = await readFile(pagePath, "utf8");
 assert.ok(!html.includes(DATASET_SENTINEL), "HTML must not contain dataset bytes");
 assert.ok(!html.includes(workDir), "HTML must not contain absolute local paths");
 assert.ok(!html.includes(CREDENTIAL_SENTINEL), "HTML must not contain credentials");

 // #43 (spec 0005 §7, S1 probe): the artifact embeds its own CSP before any
 // executable content; connect-src lists the declared live origin and the
 // pinned DuckDB-WASM asset origins exactly — no wildcard. The boot and
 // cross-origin read below then prove the policy blocks nothing the real
 // artifact needs, including the dynamic httpfs extension load.
 const cspTag = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
 assert.ok(cspTag, "static dashboard.html must embed a Content-Security-Policy meta tag");
 const policy = cspTag[1];
 assert.ok(
  html.indexOf(cspTag[0]) < html.indexOf("<style"),
  "the CSP meta tag must precede executable content",
 );
 const connectSrc = /connect-src ([^;]*)/.exec(policy)?.[1] ?? "";
 assert.ok(
  connectSrc.includes(liveHost.origin),
  `connect-src must list the declared live origin ${liveHost.origin}`,
 );
 assert.ok(
  connectSrc.includes("https://cdn.jsdelivr.net"),
  "connect-src must list the pinned DuckDB-WASM asset origin",
 );
 assert.ok(
  connectSrc.includes("https://extensions.duckdb.org"),
  "connect-src must list the DuckDB extension repository origin",
 );
 assert.ok(!policy.includes("*"), "the policy must not use wildcards");

 // SL-04: separate origins, no file picker, results on open.
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  await page.goto(`${staticHost.origin}/dashboard.html`, { waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "3",
  );
  await expect(page.locator("#source-live_station")).toHaveCount(0);
  await expect(page.locator("#refresh-live")).toBeVisible();
 } finally {
  await context.close();
 }
});

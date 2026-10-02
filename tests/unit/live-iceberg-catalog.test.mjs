/**
 * Live Iceberg tables by REST catalog identity (spec 2026-09-28-0004 §2.2,
 * §3, §4; LT-04, LT-07; ticket #34): `remote: {kind: iceberg, catalog:
 * {endpoint, warehouse, namespace, table}, catalogAuth}` compiles to a
 * live-only runtime source carrying only the declared non-secret identity;
 * conflicting identities and auth combinations fail naming the source and
 * field; the runtime resolve is one fetch whose bearer token never leaves the
 * request's Authorization header; and every unpinnable catalog outcome is a
 * catalog error naming the endpoint (LT-06 snapshot-not-pinned modes).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import {
 catalogTableUrl,
 classifyLiveError,
 resolveCatalogMetadataLocation,
} from "../../runtime/sources.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

const CATALOG = `{endpoint: "https://catalog.example.com", warehouse: analytics, namespace: sales, table: orders}`;
const CATALOG_REMOTE = `{kind: iceberg, catalog: ${CATALOG}, catalogAuth: bearer, auth: s3, region: eu-central-1, delivery: live}`;

/** Compile one minimal project with the given remote declaration. */
async function project(remote, querySql = "SELECT count(*) AS value FROM orders\n") {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-catalog-"));
 await mkdir(path.join(dir, "queries"));
 await writeFile(
  path.join(dir, "dashboard.yaml"),
  `project: 1
title: Catalog dashboard
sources:
  - id: orders
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
 await writeFile(path.join(dir, "queries", "total.sql"), querySql);
 return path.join(dir, "dashboard.yaml");
}

test("a catalog identity compiles live-only with only the declared identity", async () => {
 const dashboard = await project(CATALOG_REMOTE);
 const { config, json, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0].remote, {
  kind: "iceberg",
  catalog: {
   endpoint: "https://catalog.example.com",
   warehouse: "analytics",
   namespace: "sales",
   table: "orders",
  },
  catalogAuth: "bearer",
  auth: "s3",
  region: "eu-central-1",
 });
 assert.equal(validateConfig(config).ok, true);
 assert.deepEqual(remoteSources, [], "live-only iceberg tables never materialize");
 // The compiled config carries only the declared non-secret identity: no
 // resolved metadata location, snapshot inventory, token, or delivery mode
 // (LT-07).
 assert.equal(json.includes("catalog.example.com"), true);
 for (const inventory of ["metadata-location", "v1.metadata.json", "snap-", ".avro", "token", "delivery"]) {
  assert.equal(json.includes(inventory), false, inventory);
 }
 // catalogAuth none with public storage compiles too (independent axes).
 const anonymous = await project(
  `{kind: iceberg, catalog: ${CATALOG}, catalogAuth: none, auth: none, delivery: live}`,
 );
 const anonymousConfig = await compileProject(anonymous);
 assert.equal(validateConfig(anonymousConfig.config).ok, true);
});

test("catalog identity conflicts fail naming the source and field", async () => {
 const metadataUri = "s3://reports/orders/metadata/v3.metadata.json";
 const cases = [
  {
   remote: `{kind: iceberg, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*requires exactly one of "catalog" or "metadataUri"/,
  },
  {
   remote: `{kind: iceberg, catalog: ${CATALOG}, metadataUri: "${metadataUri}", catalogAuth: bearer, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*cannot declare both "catalog" and "metadataUri"/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "${metadataUri}", catalogAuth: none, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*"catalogAuth" requires a catalog identity/,
  },
  {
   remote: `{kind: iceberg, catalog: ${CATALOG}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*catalog identity requires "catalogAuth: none" or "catalogAuth: bearer"/,
  },
  {
   remote: `{kind: iceberg, catalog: {endpoint: "http://catalog.example.com", warehouse: analytics, namespace: sales, table: orders}, catalogAuth: bearer, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*catalog endpoint must be an HTTPS URL/,
  },
  {
   remote: `{kind: iceberg, catalog: {endpoint: "https://catalog.example.com/?X-Amz-Credential=AKIAIOSFODNN7", warehouse: analytics, namespace: sales, table: orders}, catalogAuth: bearer, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*catalog endpoint must not contain credentials/,
  },
  {
   remote: `{kind: iceberg, catalog: ${CATALOG}, uri: "s3://reports/orders/", catalogAuth: bearer, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*cannot declare "uri".*exactly one of "catalog" or "metadataUri"/,
  },
  {
   remote: `{kind: parquet-set, uri: "s3://reports/sales/", selector: {glob: "part-*.parquet"}, catalog: ${CATALOG}, catalogAuth: bearer, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*catalog requires remote\.kind: iceberg/,
  },
  {
   remote: `{uri: "https://example.com/x.parquet", format: parquet, auth: none, catalogAuth: bearer}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*catalogAuth requires remote\.kind: iceberg/,
  },
 ];
 for (const fixture of cases) {
  const dashboard = await project(fixture.remote);
  await assert.rejects(() => compileProject(dashboard), fixture.match);
 }
});

test("the runtime contract accepts the catalog identity and nothing wider", () => {
 const base = {
  contract: 2,
  app: "grid",
  title: "Catalog runtime",
  data: {
   mode: "upload",
   sources: [
    {
     id: "orders",
     schema: { station: { type: "string", nullable: false } },
     remote: {
      kind: "iceberg",
      catalog: {
       endpoint: "https://catalog.example.com",
       warehouse: "analytics",
       namespace: "sales",
       table: "orders",
      },
      catalogAuth: "bearer",
      auth: "s3",
     },
    },
   ],
  },
  filters: [],
  queries: { total: { sql: "SELECT count(*) AS value FROM orders", params: [] } },
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
  theme: "neutral",
 };
 assert.equal(validateConfig(base).ok, true);
 for (const extra of [
  { metadataUri: "s3://reports/orders/metadata/v3.metadata.json" },
  { delivery: "live" },
  { catalogAuth: undefined },
 ]) {
  const config = structuredClone(base);
  if (extra.catalogAuth === undefined) delete config.data.sources[0].remote.catalogAuth;
  else Object.assign(config.data.sources[0].remote, extra);
  assert.equal(validateConfig(config).ok, false, JSON.stringify(extra));
 }
 // A catalog identity on a non-iceberg kind is structurally rejected too.
 const parquetSet = structuredClone(base);
 parquetSet.data.sources[0].remote = {
  kind: "parquet-set",
  uri: "s3://reports/sales/",
  selector: { glob: "part-*.parquet" },
  auth: "none",
  catalog: base.data.sources[0].remote.catalog,
  catalogAuth: "bearer",
 };
 assert.equal(validateConfig(parquetSet).ok, false);
 // A credential-looking catalog endpoint is a semantic rejection even though
 // it matches the https pattern.
 const config = structuredClone(base);
 config.data.sources[0].remote.catalog.endpoint =
  "https://catalog.example.com/?token=sekrit";
 const issues = validateConfig(config).issues;
 assert.equal(validateConfig(config).ok, false);
 assert.equal(
  issues.some(({ path }) => path === "data.sources[0].remote.catalog.endpoint"),
  true,
 );
});

test("the catalog table URL pins the REST shape and encodes segments", () => {
 assert.equal(
  catalogTableUrl({
   endpoint: "https://catalog.example.com/",
   warehouse: "analytics",
   namespace: "sales",
   table: "orders",
  }),
  "https://catalog.example.com/v1/analytics/namespaces/sales/tables/orders",
 );
 assert.equal(
  catalogTableUrl({
   endpoint: "https://catalog.example.com",
   warehouse: "a b",
   namespace: "sales/db",
   table: "order's",
  }),
  "https://catalog.example.com/v1/a%20b/namespaces/sales%2Fdb/tables/order's",
 );
});

/** One fetch result for the resolver tests. */
function fetchResult(body, { status = 200, url = null, redirected = false } = {}) {
 return {
  status,
  ok: status >= 200 && status < 300,
  redirected,
  url: url ?? "https://catalog.example.com/v1/analytics/namespaces/sales/tables/orders",
  json: async () => body,
 };
}

/** Serve the generated Iceberg fixture as a plain-http S3-style bucket
 * (Range/HEAD support) plus an https REST catalog over a self-signed
 * localhost certificate, for the native profiler tests. The catalog
 * `control` holds the response mode and records arriving Authorization
 * headers; `SSL_CERT_FILE` must point the profiler's urllib at the cert. */
async function serveCatalogProfileFixture({ redirect = false, failWith = 0 } = {}) {
 const { execFile } = await import("node:child_process");
 const { promisify } = await import("node:util");
 const execFileAsync = promisify(execFile);
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-catalog-profile-"));
 const keyPath = path.join(dir, "key.pem");
 const certPath = path.join(dir, "cert.pem");
 await execFileAsync(
  "openssl",
  ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
  { timeout: 30_000 },
 );
 const tls = { key: await readFile(keyPath), cert: await readFile(certPath) };
 const control = { authorizations: [] };
 const catalog = https.createServer(tls, (request, response) => {
  control.authorizations.push(request.headers.authorization ?? null);
  if (request.method === "GET" && request.url === "/v1/analytics/namespaces/sales/tables/orders") {
   if (redirect) {
    response.writeHead(302, { Location: "https://127.0.0.1:1/other" });
    response.end();
    return;
   }
   if (failWith) {
    response.writeHead(failWith, { "Content-Length": 0 });
    response.end();
    return;
   }
   const body = JSON.stringify({
    "metadata-location": "s3://reports/orders/metadata/v1.metadata.json",
    config: {},
   });
   response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
   response.end(body);
   return;
  }
  response.writeHead(404, { "Content-Length": 0 });
  response.end();
 });
 await new Promise((resolve) => catalog.listen(0, "127.0.0.1", resolve));
 const objects = new Map();
 for (const key of [
  "orders/data/00001.parquet",
  "orders/data/00001-delete.parquet",
  "orders/metadata/00001-m0.avro",
  "orders/metadata/00001-m1.avro",
  "orders/metadata/snap-555000001-00001.avro",
  "orders/metadata/v1.metadata.json",
 ]) {
  objects.set(
   `/reports/${key}`,
   await readFile(path.join(rootDir, ".artifacts", "fixtures", "iceberg", key.replace(/^orders\//, ""))),
  );
 }
 const bucket = http.createServer((request, response) => {
  const payload = objects.get(request.url.split("?")[0]);
  if (!payload) {
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
   return;
  }
  if (request.method === "HEAD") {
   response.writeHead(200, { "Content-Length": payload.length, "Accept-Ranges": "bytes" });
   response.end();
   return;
  }
  const range = request.headers.range;
  if (range) {
   const match = /bytes=(\d*)-(\d*)/.exec(range);
   const start = match[1] === "" ? Math.max(0, payload.length - Number(match[2])) : Number(match[1]);
   const end = match[2] === "" || match[1] === "" ? payload.length - 1 : Math.min(Number(match[2]), payload.length - 1);
   const body = payload.subarray(start, end + 1);
   response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${payload.length}`, "Content-Length": body.length });
   response.end(body);
   return;
  }
  response.writeHead(200, { "Content-Length": payload.length });
  response.end(payload);
 });
 await new Promise((resolve) => bucket.listen(0, "127.0.0.1", resolve));
 return {
  control,
  certPath,
  catalogOrigin: `https://127.0.0.1:${catalog.address().port}`,
  bucketEndpoint: `127.0.0.1:${bucket.address().port}`,
  close: async () => {
   await Promise.all([
    new Promise((resolve) => catalog.close(resolve)),
    new Promise((resolve) => bucket.close(resolve)),
   ]);
   await rm(dir, { recursive: true, force: true });
  },
 };
}

/** Run the profiler with a credential-free environment plus the fixture's
 * catalog token and trust anchor (FTHR_S3_USE_SSL=false keeps the plain-http
 * bucket local-only, like the native fixture verification). */
async function runCatalogProfile(fixture, extraArgs, token = "profile-token-check") {
 const env = {};
 for (const [key, value] of Object.entries(process.env)) {
  if (!/^(AWS|FTHR_S3|FTHR_ICEBERG)_/.test(key)) env[key] = value;
 }
 env.SSL_CERT_FILE = fixture.certPath;
 env.FTHR_S3_USE_SSL = "false";
 if (token !== null) env.FTHR_ICEBERG_TOKEN = token;
 return execFileAsync(
  process.execPath,
  [
   path.join(rootDir, "bin", "featherbi.mjs"),
   "profile",
   "--input",
   fixture.catalogOrigin,
   "--source-id",
   "orders",
   "--format",
   "parquet",
   "--iceberg-catalog",
   "--catalog-warehouse",
   "analytics",
   "--catalog-namespace",
   "sales",
   "--catalog-table",
   "orders",
   "--catalog-auth",
   "bearer",
   "--auth",
   "none",
   "--endpoint",
   fixture.bucketEndpoint,
   ...extraArgs,
  ],
  { env, maxBuffer: 200_000 },
 );
}

test("the profiler resolves a catalog identity natively with no token in output", async () => {
 const fixture = await serveCatalogProfileFixture();
 try {
  const { stdout } = await runCatalogProfile(fixture, []);
  const payload = JSON.parse(stdout);
  // The pinned v1 snapshot applies the positional delete: 2 rows, not the
  // raw file's 3 — the profile read true Iceberg semantics.
  assert.equal(payload.kind, "iceberg");
  assert.equal(payload.row_count, 2);
  assert.equal(payload.snapshot_rows, 2);
  assert.deepEqual(payload.columns.map(({ name }) => name), ["id", "n"]);
  // Portable output only: no token, no resolved metadata location, no file
  // inventory (spec §5).
  assert.equal(stdout.includes("profile-token-check"), false);
  assert.equal(stdout.includes("v1.metadata.json"), false);
  assert.equal(stdout.includes(".avro"), false);
  // The token was used only for the catalog request.
  assert.deepEqual(fixture.control.authorizations, ["Bearer profile-token-check"]);
 } finally {
  await fixture.close();
 }
});

test("a redirecting or unauthorized catalog fails profiling without the token in the error", async () => {
 for (const mode of [{ redirect: true }, { failWith: 401 }]) {
  const fixture = await serveCatalogProfileFixture(mode);
  try {
   await assert.rejects(
    () => runCatalogProfile(fixture, []),
    (error) => {
     const message = String(error.stderr ?? error.message);
     assert.equal(message.includes("orders"), true);
     // The failing endpoint is named as the redacted input (the profiler
     // never prints URIs), and the failure mode is identified.
     assert.equal(message.includes("catalog endpoint"), true);
     assert.equal(message.includes(mode.redirect ? "redirected" : "401"), true);
     assert.equal(message.includes("profile-token-check"), false);
     return true;
    },
   );
  } finally {
   await fixture.close();
  }
 }
});

const REMOTE = {
 kind: "iceberg",
 catalog: {
  endpoint: "https://catalog.example.com",
  warehouse: "analytics",
  namespace: "sales",
  table: "orders",
 },
 catalogAuth: "bearer",
 auth: "none",
};

test("the catalog resolve sends the token only in the Authorization header", async () => {
 const seen = [];
 const originalFetch = globalThis.fetch;
 globalThis.fetch = async (url, options) => {
  seen.push({ url, options });
  return fetchResult({ "metadata-location": "s3://reports/orders/metadata/v1.metadata.json" });
 };
 try {
  const location = await resolveCatalogMetadataLocation("orders", REMOTE, "secret-token");
  assert.equal(location, "s3://reports/orders/metadata/v1.metadata.json");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://catalog.example.com/v1/analytics/namespaces/sales/tables/orders");
  // The token travels only in this one request's header; nothing else (URL,
  // query, payload) carries it.
  assert.deepEqual(seen[0].options, { headers: { Authorization: "Bearer secret-token" } });
  // catalogAuth none sends no header at all.
  const anonymousSeen = [];
  globalThis.fetch = async (url, options) => {
   anonymousSeen.push({ url, options });
   return fetchResult({ "metadata-location": "s3://reports/orders/metadata/v1.metadata.json" });
  };
  await resolveCatalogMetadataLocation("orders", { ...REMOTE, catalogAuth: "none" }, null);
  assert.deepEqual(anonymousSeen[0].options, { headers: {} });
 } finally {
  globalThis.fetch = originalFetch;
 }
});

test("a missing bearer token fails as a credential requirement", async () => {
 await assert.rejects(
  () => resolveCatalogMetadataLocation("orders", REMOTE, null),
  (error) => {
   assert.equal(error.code, "sources.credentials-required");
   assert.equal(error.sourceId, "orders");
   return true;
  },
 );
});

test("a 401 catalog response is a credential failure naming the endpoint", async () => {
 const originalFetch = globalThis.fetch;
 globalThis.fetch = async () => fetchResult("", { status: 401 });
 try {
  await assert.rejects(
   () => resolveCatalogMetadataLocation("orders", REMOTE, "secret-token"),
   (error) => {
    assert.equal(error.code, "sources.iceberg-catalog-auth");
    assert.equal(error.sourceId, "orders");
    assert.equal(error.message.includes("https://catalog.example.com"), true);
    assert.equal(error.message.includes("401 Unauthorized"), true);
    assert.equal(classifyLiveError(error), "credentials");
    assert.equal(error.message.includes("secret-token"), false);
    return true;
   },
  );
 } finally {
  globalThis.fetch = originalFetch;
 }
});

test("unpinnable catalog responses are catalog errors naming the endpoint", async () => {
 const originalFetch = globalThis.fetch;
 try {
  // No metadata-location at all.
  globalThis.fetch = async () => fetchResult({ config: {} });
  await assert.rejects(
   () => resolveCatalogMetadataLocation("orders", REMOTE, "t"),
   (error) => {
    assert.equal(error.code, "sources.iceberg-catalog");
    assert.equal(error.message.includes("https://catalog.example.com"), true);
    assert.equal(error.message.includes("metadata-location"), true);
    return true;
   },
  );
  // A non-s3 metadata-location cannot be pinned by the storage machinery.
  globalThis.fetch = async () =>
   fetchResult({ "metadata-location": "https://elsewhere.example.com/v1.metadata.json" });
  await assert.rejects(
   () => resolveCatalogMetadataLocation("orders", REMOTE, "t"),
   (error) => error.code === "sources.iceberg-catalog",
  );
  // An unreachable catalog is a network-class failure naming the endpoint.
  globalThis.fetch = async () => {
   throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
   () => resolveCatalogMetadataLocation("orders", REMOTE, "t"),
   (error) => {
    assert.equal(error.code, "sources.iceberg-catalog");
    assert.equal(classifyLiveError(error), "network");
    return true;
   },
  );
 } finally {
  globalThis.fetch = originalFetch;
 }
});

test("a cross-authority catalog redirect fails naming the endpoint, never the token", async () => {
 const originalFetch = globalThis.fetch;
 // The browser follows the redirect (stripping Authorization) and the fetch
 // resolves on the other authority; the resolver must fail it visibly.
 globalThis.fetch = async () =>
  fetchResult({ "metadata-location": "s3://reports/orders/metadata/v1.metadata.json" }, {
   redirected: true,
   url: "https://other-authority.example.com/v1/analytics/namespaces/sales/tables/orders",
  });
 try {
  await assert.rejects(
   () => resolveCatalogMetadataLocation("orders", REMOTE, "secret-token"),
   (error) => {
    assert.equal(error.code, "sources.iceberg-catalog-redirect");
    assert.equal(error.sourceId, "orders");
    assert.equal(error.message.includes("https://catalog.example.com"), true);
    assert.equal(error.message.includes("different authority"), true);
    assert.equal(error.message.includes("secret-token"), false);
    return true;
   },
  );
  // A same-origin redirect keeps the pinned catalog authority and resolves.
  globalThis.fetch = async () =>
   fetchResult({ "metadata-location": "s3://reports/orders/metadata/v1.metadata.json" }, {
    redirected: true,
    url: "https://catalog.example.com/v1/other-path",
   });
  assert.equal(
   await resolveCatalogMetadataLocation("orders", REMOTE, "secret-token"),
   "s3://reports/orders/metadata/v1.metadata.json",
  );
 } finally {
  globalThis.fetch = originalFetch;
 }
});

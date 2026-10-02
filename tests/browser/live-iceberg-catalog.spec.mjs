/**
 * Live Iceberg tables by REST catalog identity (spec 2026-09-28-0004 §2.2,
 * §3, §4; LT-04, LT-06, LT-07; ADR 0009): `remote: {kind: iceberg, catalog:
 * {endpoint, warehouse, namespace, table}, catalogAuth: bearer}` resolves
 * `metadata-location` exactly once per candidate generation with one browser
 * fetch — never a REST ATTACH, which re-resolves the latest snapshot per
 * scan — and scans the returned versioned metadata URI through the T3
 * Iceberg reader path. The recipient's bearer token lives only in the page's
 * session memory, travels only in the resolve request's Authorization
 * header, and is prompted separately from the S3 credentials. The fixture
 * reuses the T3 iceberg bucket: v1's snapshot deletes row B (2 rows), v2's
 * snapshot keeps all three rows — so a leaked re-resolve is observable as a
 * row-count change.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { renderDashboard } from "../../scripts/build.mjs";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const icebergDir = path.join(rootDir, ".artifacts", "fixtures", "iceberg");
/** Distinct literal secrets asserted absent from every artifact and error. */
const CATALOG_TOKEN = "catalog-secret-3f9d2b7c";
const S3_SECRET = "s3-secret-9e1c4a";

/** Self-signed localhost certificate for the https fixture servers. */
async function selfSignedLocalhostCert() {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-catalog-tls-"));
 const keyPath = path.join(dir, "key.pem");
 const certPath = path.join(dir, "cert.pem");
 try {
  await execFileAsync(
   "openssl",
   [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
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

/** Permissive CORS headers for a localhost https fixture server. */
function permissiveCors(request, response) {
 response.setHeader("Access-Control-Allow-Origin", "*");
 response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
 const allow = request.headers["access-control-request-headers"];
 response.setHeader("Access-Control-Allow-Headers", allow ?? "Authorization, Range");
 response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
 if (request.method === "OPTIONS") {
  response.writeHead(204);
  response.end();
  return true;
 }
 return false;
}

/**
 * Serve the T3-generated Iceberg fixture as an S3-style bucket over https
 * from 127.0.0.1 (object GET/HEAD with Range support). `requests` records
 * every object key so tests can prove which snapshot family was read.
 */
async function serveIcebergBucket(tls) {
 const objects = new Map();
 for (const key of [
  "orders/data/00001.parquet",
  "orders/data/00001-delete.parquet",
  "orders/metadata/00001-m0.avro",
  "orders/metadata/00001-m1.avro",
  "orders/metadata/snap-555000001-00001.avro",
  "orders/metadata/snap-555000002-00001.avro",
  "orders/metadata/v1.metadata.json",
  "orders/metadata/v2.metadata.json",
 ]) {
  objects.set(key, await readFile(path.join(icebergDir, key.replace(/^orders\//, ""))));
 }
 const requests = new Set();
 const server = https.createServer(
  { key: tls.key, cert: tls.cert },
  (request, response) => {
   if (permissiveCors(request, response)) return;
   const url = new URL(request.url, "https://s3.local");
   const key = url.pathname.replace(/^\/reports\//, "");
   requests.add(key);
   const payload = objects.get(key);
   if (!payload) {
    response.writeHead(404, { "Content-Length": 0 });
    response.end();
    return;
   }
   if (request.method === "HEAD") {
    response.writeHead(200, {
     "Content-Length": payload.length,
     "Accept-Ranges": "bytes",
    });
    response.end();
    return;
   }
   const range = request.headers.range;
   if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start =
     match[1] === "" ? Math.max(0, payload.length - Number(match[2])) : Number(match[1]);
    const end =
     match[2] === "" || match[1] === "" ? payload.length - 1 : Math.min(Number(match[2]), payload.length - 1);
    const body = payload.subarray(start, end + 1);
    response.writeHead(206, {
     "Content-Range": `bytes ${start}-${end}/${payload.length}`,
     "Content-Length": body.length,
     "Accept-Ranges": "bytes",
    });
    response.end(body);
    return;
   }
   response.writeHead(200, {
    "Content-Length": payload.length,
    "Accept-Ranges": "bytes",
   });
   response.end(payload);
  },
 );
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `https://127.0.0.1:${server.address().port}`,
  requests,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/** The catalog's REST table URL for the declared identity. */
const CATALOG_TABLE_PATH = "/v1/analytics/namespaces/sales/tables/orders";

/**
 * Serve an Iceberg REST catalog over https from 127.0.0.1. `control` holds
 * the mutable `metadataLocation` the table resolves to (v1 or v2), an
 * optional `failWith` HTTP status, and an optional cross-authority
 * `redirect` target; `requests`/`authorizations` record what arrived so
 * tests can prove pinning and non-forwarding.
 */
async function serveCatalog(tls, control) {
 const server = https.createServer(
  { key: tls.key, cert: tls.cert },
  (request, response) => {
   if (permissiveCors(request, response)) return;
   const url = new URL(request.url, "https://catalog.local");
   if (request.method === "GET" && url.pathname === CATALOG_TABLE_PATH) {
    control.requests.push(url.pathname);
    control.authorizations.push(request.headers.authorization ?? null);
    if (control.redirect) {
     response.writeHead(302, { Location: control.redirect, "Content-Length": 0 });
     response.end();
     return;
    }
    if (control.failWith) {
     response.writeHead(control.failWith, { "Content-Length": 0 });
     response.end();
     return;
    }
    const body = JSON.stringify({
     "metadata-location": control.metadataLocation,
     config: {},
    });
    response.writeHead(200, {
     "Content-Type": "application/json",
     "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
   }
   response.writeHead(404, { "Content-Length": 0 });
   response.end();
  },
 );
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `https://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/**
 * Serve the redirect target the failing catalog test points at: fully
 * permissive CORS and a valid table response, so ONLY the cross-authority
 * rule can fail the resolution. `authorizations` records whether the
 * redirected request carried the bearer token (it must never).
 */
async function serveRedirectTarget(tls, control) {
 const server = https.createServer(
  { key: tls.key, cert: tls.cert },
  (request, response) => {
   if (permissiveCors(request, response)) return;
   control.requests.push(request.url);
   control.authorizations.push(request.headers.authorization ?? null);
   const body = JSON.stringify({
    "metadata-location": "s3://reports/orders/metadata/v1.metadata.json",
    config: {},
   });
   response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
   });
   response.end(body);
  },
 );
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `https://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/** One dashboard config declaring the catalog-identified Iceberg source. */
function catalogDashboardConfig({ auth, catalogOrigin, storageHost, catalogAuth = "bearer" }) {
 return {
  contract: 2,
  app: "grid",
  title: "Live iceberg catalog table",
  data: {
   mode: "upload",
   sources: [
    {
     id: "orders",
     schema: {
      id: { type: "string", nullable: false },
      n: { type: "integer", nullable: false },
     },
     remote: {
      kind: "iceberg",
      catalog: {
       endpoint: catalogOrigin,
       warehouse: "analytics",
       namespace: "sales",
       table: "orders",
      },
      catalogAuth,
      auth,
      ...(storageHost ? { endpoint: storageHost } : {}),
     },
    },
   ],
  },
  filters: [
   {
    id: "row",
    kind: "select",
    source: "orders",
    column: "id",
    default: null,
   },
  ],
  queries: {
   records: {
    sql: "SELECT count(*) AS records FROM orders WHERE ($row IS NULL OR id = $row)",
    params: ["row"],
   },
  },
  layout: [
   {
    id: "kpi_records",
    type: "kpi",
    query: "records",
    field: "records",
    label: "Orders",
    x: 1,
    y: 1,
    width: 12,
    height: 1,
   },
  ],
  theme: "neutral",
 };
}

async function writeDashboardPage(config, name) {
 const { html } = await renderDashboard({ config });
 const pagePath = path.join(rootDir, ".artifacts", "browser", name);
 await writeFile(pagePath, html, "utf8");
 return { pagePath, html };
}

/** Answer the catalog token prompt, then (when present) the S3 prompt. */
async function answerPrompts(page, { token = CATALOG_TOKEN, s3 = false } = {}) {
 await expect(
  page.locator("dialog [data-credential-destination]"),
 ).toContainText("catalog");
 await page.locator('dialog input[aria-label="Bearer token"]').fill(token);
 await page.locator('dialog button[type="submit"]').click();
 if (s3) {
  await page.locator('dialog input[aria-label="Key ID"]').fill("key-one");
  await page.locator('dialog input[aria-label="Secret"]').fill(S3_SECRET);
  await page.locator('dialog button[type="submit"]').click();
 }
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

/**
 * LT-04 (TDD fail-first): the catalog identity resolves exactly once per
 * generation. The catalog returns metadata-location v1 (snapshot deleting
 * row B); the dashboard opens on 2 rows; a new Iceberg commit changes the
 * catalog's metadata-location to v2 (3 rows); a filter interaction must
 * still see v1 results — no leak — and only the explicit Refresh
 * re-resolves the catalog and publishes v2 atomically.
 */
test("a catalog identity pins its resolved snapshot until an explicit Refresh", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: null,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "none",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath } = await writeDashboardPage(config, "live-iceberg-catalog.html");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // Public storage asks for nothing; only the private catalog prompts.
  await expect(
   page.locator("dialog [data-credential-destination]"),
  ).toContainText(catalog.origin);
  await expect(page.locator('dialog input[aria-label="Key ID"]')).toHaveCount(0);
  await answerPrompts(page);

  // The pinned v1 snapshot applies the positional delete: 2 rows (A, C).
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");
  expect(catalogControl.authorizations[0]).toBe(`Bearer ${CATALOG_TOKEN}`);

  // A new Iceberg commit lands: the catalog now resolves v2 (all 3 rows).
  catalogControl.metadataLocation = "s3://reports/orders/metadata/v2.metadata.json";

  // A filter interaction still sees the pinned v1: B stays deleted and the
  // options stay A/C. A per-scan re-resolve would surface B here.
  await page.locator("#filter-row").selectOption({ label: "A" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("1");
  await expect(page.locator("#filter-row option")).toHaveText(["all", "A", "C"]);
  // The pinned generation never re-asked the catalog.
  expect(catalogControl.requests.length).toBe(1);

  // Explicit Refresh re-resolves the catalog: v2 publishes atomically.
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("3");
  await expect(page.locator("#filter-row option")).toHaveText(["all", "A", "B", "C"]);
  expect(catalogControl.requests.length).toBe(2);
  expect(catalogControl.authorizations[1]).toBe(`Bearer ${CATALOG_TOKEN}`);
 } finally {
  await context.close();
  await catalog.close();
  await bucket.close();
 }
});

/**
 * LT-04: a private catalog and private S3 store use separate memory-only
 * prompts (distinct dialogs, only when needed), and a reload asks for both
 * again — the session memory did not survive.
 */
test("a private catalog and private storage prompt separately and again after reload", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: null,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "s3",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath } = await writeDashboardPage(config, "live-iceberg-catalog-prompts.html");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // The catalog token prompt comes first and is distinct: it names the HTTPS
  // catalog endpoint, has no S3 fields, and takes one bearer token.
  await expect(page.locator("dialog h2")).toHaveText("Catalog token for orders");
  await expect(
   page.locator("dialog [data-credential-destination]"),
  ).toContainText(catalog.origin);
  await expect(page.locator('dialog input[aria-label="Key ID"]')).toHaveCount(0);
  await expect(page.locator('dialog input[aria-label="Secret"]')).toHaveCount(0);
  await page.locator('dialog input[aria-label="Bearer token"]').fill(CATALOG_TOKEN);
  await page.locator('dialog button[type="submit"]').click();

  // The S3 prompt is separate: it names the storage endpoint and takes key
  // material, never a bearer token.
  await expect(page.locator("dialog h2")).toHaveText("Credentials for orders");
  await expect(
   page.locator("dialog [data-credential-destination]"),
  ).toContainText(new URL(bucket.origin).host);
  await expect(page.locator('dialog input[aria-label="Bearer token"]')).toHaveCount(0);
  await page.locator('dialog input[aria-label="Key ID"]').fill("key-one");
  await page.locator('dialog input[aria-label="Secret"]').fill(S3_SECRET);
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");

  // A reload drops the session memory: both prompts appear again, distinct.
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("dialog h2")).toHaveText("Catalog token for orders");
  await expect(page.locator('dialog input[aria-label="Key ID"]')).toHaveCount(0);
  await page.locator('dialog input[aria-label="Bearer token"]').fill(CATALOG_TOKEN);
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("dialog h2")).toHaveText("Credentials for orders");
  await expect(page.locator('dialog input[aria-label="Bearer token"]')).toHaveCount(0);
  await page.locator('dialog input[aria-label="Key ID"]').fill("key-one");
  await page.locator('dialog input[aria-label="Secret"]').fill(S3_SECRET);
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");
 } finally {
  await context.close();
  await catalog.close();
  await bucket.close();
 }
});

/**
 * LT-06/LT-07: a catalog authentication failure during Refresh re-prompts
 * once with the failing endpoint identified, retains the prior generation's
 * results on repeated failure with a source-specific error naming the
 * endpoint, and recovers on a later Refresh. The retained error never
 * contains the bearer token.
 */
test("a 401 catalog refresh re-prompts once and retains the prior generation", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: null,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "none",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath } = await writeDashboardPage(config, "live-iceberg-catalog-401.html");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
  await answerPrompts(page);
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");

  // The token expires: the catalog now rejects it.
  catalogControl.failWith = 401;
  await page.locator("#refresh-live").click();

  // Exactly one re-prompt, showing the failing attempt and its endpoint.
  await expect(page.locator("dialog h2")).toHaveText("Catalog token for orders");
  await expect(
   page.locator("dialog [data-credential-destination]"),
  ).toContainText(catalog.origin);
  await expect(page.locator("dialog [data-credential-error]")).toContainText("401");
  await page.locator('dialog input[aria-label="Bearer token"]').fill(CATALOG_TOKEN);
  await page.locator('dialog button[type="submit"]').click();

  // The repeated failure retains the prior generation with a visible,
  // source-specific error naming the endpoint; results stay usable.
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "error");
  const failure = await page.locator("#dashboard-status").textContent();
  expect(failure).toContain("orders");
  expect(failure).toContain(catalog.origin);
  expect(failure).toContain("Showing prior results");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");
  expect(failure).not.toContain(CATALOG_TOKEN);

  // The retained generation keeps serving reads after the failed candidate.
  await page.locator("#filter-row").selectOption({ label: "C" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("1");

  // A later Refresh with the catalog accepting the token publishes again;
  // the repeated failure dropped the session token, so it asks once more.
  catalogControl.failWith = 0;
  await page.locator("#refresh-live").click();
  await expect(page.locator("dialog h2")).toHaveText("Catalog token for orders");
  await page.locator('dialog input[aria-label="Bearer token"]').fill(CATALOG_TOKEN);
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");
 } finally {
  await context.close();
  await catalog.close();
  await bucket.close();
 }
});

/**
 * LT-07: the bearer token and the S3 secret never appear in the built
 * artifact, the live DOM, or any error text. The 401 path also exercises
 * the only place a token-adjacent failure becomes user-visible text.
 */
test("no catalog token or S3 secret appears in the artifact, DOM, or errors", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: null,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "s3",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath, html } = await writeDashboardPage(config, "live-iceberg-catalog-secrets.html");
  // The built artifact knows only the declared non-secret catalog identity.
  expect(html).toContain(catalog.origin);
  expect(html.includes(CATALOG_TOKEN)).toBe(false);
  expect(html.includes(S3_SECRET)).toBe(false);
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
  await answerPrompts(page, { s3: true });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");

  // Drive a failure so error text exists, then assert absence everywhere.
  catalogControl.failWith = 401;
  await page.locator("#refresh-live").click();
  await expect(page.locator("dialog [data-credential-error]")).toContainText("401");
  await page.locator('dialog input[aria-label="Bearer token"]').fill(CATALOG_TOKEN);
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "error");

  const dom = await page.content();
  expect(dom.includes(CATALOG_TOKEN)).toBe(false);
  expect(dom.includes(S3_SECRET)).toBe(false);
  const status = await page.locator("#dashboard-status").textContent();
  expect(status.includes(CATALOG_TOKEN)).toBe(false);
  expect(status.includes(S3_SECRET)).toBe(false);
 } finally {
  await context.close();
  await catalog.close();
  await bucket.close();
 }
});

/**
 * Spec §4 prompt conditionality (the negative case): a public catalog
 * (`catalogAuth: none`) with public storage (`auth: none`) needs no
 * credential at all — the dashboard opens live with no dialog.
 */
test("a public catalog with public storage opens without any prompt", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: null,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "none",
   catalogAuth: "none",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath } = await writeDashboardPage(config, "live-iceberg-catalog-public.html");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("2");
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(catalogControl.authorizations).toEqual([null]);
 } finally {
  await context.close();
  await catalog.close();
  await bucket.close();
 }
});
/**
 * Spec §4 redirect rule: a catalog that redirects the table request to a
 * different authority fails the resolution visibly naming the endpoint, and
 * the bearer token is never forwarded — the browser strips Authorization on
 * cross-origin redirects and the redirected request arrives unsigned.
 */
test("a cross-authority catalog redirect fails visibly and never forwards the token", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const bucket = await serveIcebergBucket(tls);
 const targetControl = { requests: [], authorizations: [] };
 const target = await serveRedirectTarget(tls, targetControl);
 const catalogControl = {
  metadataLocation: "s3://reports/orders/metadata/v1.metadata.json",
  failWith: 0,
  redirect: `${target.origin}${CATALOG_TABLE_PATH}`,
  requests: [],
  authorizations: [],
 };
 const catalog = await serveCatalog(tls, catalogControl);
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const config = catalogDashboardConfig({
   auth: "none",
   catalogOrigin: catalog.origin,
   storageHost: new URL(bucket.origin).host,
  });
  const { pagePath } = await writeDashboardPage(config, "live-iceberg-catalog-redirect.html");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
  await answerPrompts(page);

  // Initial open fails as a visible boot error naming the source and the
  // catalog endpoint; no fabricated results and no storage read happened.
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "error");
  const failure = await page.locator("#dashboard-status").textContent();
  expect(failure).toContain("orders");
  expect(failure).toContain(catalog.origin);
  expect(failure).toContain("different authority");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("—");
  expect([...bucket.requests]).toEqual([]);
  expect(failure.includes(CATALOG_TOKEN)).toBe(false);

  // The redirected request was followed (CORS permissive) yet arrived
  // unsigned: the token never crossed the authority boundary.
  expect(targetControl.requests.length).toBeGreaterThan(0);
  for (const authorization of targetControl.authorizations) {
   expect(authorization).toBeNull();
  }
 } finally {
  await context.close();
  await catalog.close();
  await target.close();
  await bucket.close();
 }
});

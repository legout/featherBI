/**
 * Live Parquet file sets, glob selector (spec 2026-09-28-0004 §2.1, LT-02,
 * LT-06): a `remote: {kind: parquet-set}` source resolves its S3 prefix glob
 * once per generation through a ListObjectsV2-style endpoint. Membership
 * stays pinned for filtering; only the visible Refresh control resolves
 * anew. A refresh that fails on its objects leaves the prior generation's
 * results usable with a source-specific error.
 */

import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { renderDashboard } from "../../scripts/build.mjs";
import {
 closeHarness,
 expect,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

/**
 * Self-signed localhost certificate for the https S3-style fixture server.
 * Recipient contexts open with `ignoreHTTPSErrors`; no certificate is trusted
 * outside the test.
 */
async function selfSignedLocalhostCert() {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-set-tls-"));
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

/**
 * Serve a minimal S3-style endpoint from 127.0.0.1 over https: ListObjectsV2
 * XML on `?list-type=2` (path-style bucket root) plus object HEAD/GET with
 * Range support and permissive CORS. The served key set is mutable so the test
 * can land a new object under the declared prefix mid-session,
 * `control.manifest` serves a mutable JSON manifest document at the
 * bucket-root object `manifest.json` (outside the declared prefix) with
 * `control.failManifest` failing only that document,
 * `control.failObjects` makes object reads fail while listing keeps working
 * so a refresh can fail after membership resolved, and `control.rejectKeys`
 * answers 403 for requests signed with one of those SigV4 access key IDs so a
 * working private source can fail as a credential error on demand.
 */
async function serveS3StyleBucket(tls, bytes, keys, control = { failObjects: false }) {
 const server = https.createServer(
  { key: tls.key, cert: tls.cert },
  (request, response) => {
   response.setHeader("Access-Control-Allow-Origin", "*");
   response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, OPTIONS",
   );
   const allow = request.headers["access-control-request-headers"];
   response.setHeader("Access-Control-Allow-Headers", allow ?? "Range");
   response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length",
   );
   if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
   }
   const signedKey = /Credential=([^/]+)\//.exec(
    request.headers.authorization ?? "",
   )?.[1];
   if (signedKey && control.rejectKeys?.has(signedKey)) {
    response.writeHead(403, { "Content-Length": 0 });
    response.end();
    return;
   }
   const url = new URL(request.url, "https://s3.local");
   if (url.searchParams.get("list-type") === "2") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const matched = [...keys].filter((key) => key.startsWith(prefix)).sort();
    const entries = matched
     .map(
      (key) =>
       `<Contents><Key>${key}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;etag&quot;</ETag><Size>${bytes.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
     )
     .join("");
    const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>reports</Name><Prefix>${prefix}</Prefix><KeyCount>${matched.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${entries}</ListBucketResult>`;
    response.writeHead(200, {
     "Content-Type": "application/xml",
     "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
   }
   const key = url.pathname.replace(/^\/reports\//, "");
   // A mutable manifest document (bucket-root object, outside the declared
   // prefix) so a manifest-selector source can observe membership changing
   // between generations; `control.failManifest` makes only the manifest
   // unreadable while the Parquet objects stay readable.
   if (control.manifest && key === "manifest.json") {
    if (control.failManifest) {
     response.writeHead(404, { "Content-Length": 0 });
     response.end();
     return;
    }
    const body = Buffer.from(JSON.stringify({ files: control.manifest.files }));
    if (request.method === "HEAD") {
     response.writeHead(200, {
      "Content-Length": body.length,
      "Accept-Ranges": "bytes",
     });
     response.end();
     return;
    }
    response.writeHead(200, {
     "Content-Length": body.length,
     "Accept-Ranges": "bytes",
    });
    response.end(body);
    return;
   }
   if (control.failObjects) {
    response.writeHead(404, { "Content-Length": 0 });
    response.end();
    return;
   }
   if (!keys.has(key)) {
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
   const range = request.headers.range;
   if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start =
     match[1] === "" ? Math.max(0, bytes.length - Number(match[2])) : Number(match[1]);
    const end =
     match[2] === "" || match[1] === ""
      ? bytes.length - 1
      : Math.min(Number(match[2]), bytes.length - 1);
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
  },
 );
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `https://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

test("a live parquet set pins glob membership until an explicit Refresh", async ({
 browser,
}) => {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", "inspections.parquet"),
 );
 // Each part serves the same 5-row fixture (3 rows station SJ per part).
 const keys = new Set(["reports/part-1.parquet", "reports/part-2.parquet"]);
 const control = { failObjects: false };
 const tls = await selfSignedLocalhostCert();
 const fixture = await serveS3StyleBucket(tls, bytes, keys, control);
 const pagePath = path.join(rootDir, ".artifacts", "browser", "live-parquet-set.html");
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const { html } = await renderDashboard({
   config: {
    contract: 2,
    app: "grid",
    title: "Live parquet set",
    data: {
     mode: "upload",
     sources: [
      {
       id: "sales",
       schema: {
        order_number: { type: "string", nullable: false },
        test_station_identifier: { type: "string", nullable: false },
       },
       remote: {
        kind: "parquet-set",
        uri: "s3://reports/reports/",
        selector: { glob: "part-*.parquet" },
        auth: "none",
        endpoint: new URL(fixture.origin).host,
       },
      },
     ],
    },
    filters: [
     {
      id: "station",
      kind: "select",
      source: "sales",
      column: "test_station_identifier",
      default: null,
     },
    ],
    queries: {
     records: {
      sql: "SELECT count(*) AS records FROM sales WHERE ($station IS NULL OR test_station_identifier = $station)",
      params: ["station"],
     },
    },
    layout: [
     {
      id: "kpi_records",
      type: "kpi",
      query: "records",
      field: "records",
      label: "Sales records",
      x: 1,
      y: 1,
      width: 12,
      height: 1,
     },
    ],
    theme: "neutral",
   },
  });
  await writeFile(pagePath, html, "utf8");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // Open: the glob resolves both parts into one source (2 x 5 rows).
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );
  // The station select offers "all" plus the two fixture stations.
  await expect(page.locator("#filter-station option")).toHaveCount(3);

  // Filtering reads the pinned generation: 2 parts x 3 SJ rows.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "6",
  );

  // A new object lands under the declared prefix after the generation opened.
  keys.add("reports/part-3.parquet");

  // Filtering must not re-resolve membership: clearing the filter still sees
  // only the two pinned parts.
  await page.locator("#filter-station").selectOption({ label: "all" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // LT-06: a refresh whose objects cannot be read (the listing works, the
  // object GETs fail) keeps the prior active generation usable with a
  // source-specific error and never publishes a partial refresh.
  control.failObjects = true;
  await expect(page.locator("#refresh-live")).toBeVisible();
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  const failure = await page.locator("#dashboard-status").textContent();
  expect(failure).toContain("sales");
  expect(failure).toContain("Showing prior results");
  // Live-only sources point at endpoint/CORS access, never packaged delivery
  // (spec 2026-09-28-0004 §4).
  expect(failure).toContain("CORS");
  expect(failure).not.toContain("packaged build");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // The retained generation still serves filtered reads after the failed
  // candidate was retired (its objects readable again): 2 pinned parts x 3
  // SJ rows. A candidate secret leak would break this read even now.
  control.failObjects = false;
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "6",
  );

  // Explicit Refresh re-resolves the glob: the new part joins the source.
  // (Refresh also resets filters to their declared defaults.)
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "15",
  );
  // The refreshed generation keeps serving filtered reads from its own
  // membership: 3 parts x 3 SJ rows.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "9",
  );
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await fixture.close();
 }
});

/**
 * LT-02 for private sets: a credential failure during a filtered read
 * re-prompts and re-stages the ACTIVE generation's pinned membership — the
 * glob is not re-resolved, so an object added after open stays invisible
 * until the explicit Refresh resolves anew (spec 2026-09-28-0004 §3). The
 * private prompt also displays the named destination before credential
 * entry (spec §4).
 */
test("a credential retry re-stages the pinned membership until an explicit Refresh", async ({
 browser,
}) => {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", "inspections.parquet"),
 );
 const keys = new Set(["reports/part-1.parquet", "reports/part-2.parquet"]);
 const control = { failObjects: false, rejectKeys: new Set() };
 const tls = await selfSignedLocalhostCert();
 const fixture = await serveS3StyleBucket(tls, bytes, keys, control);
 const pagePath = path.join(
  rootDir,
  ".artifacts",
  "browser",
  "live-parquet-set-retry.html",
 );
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const { html } = await renderDashboard({
   config: {
    contract: 2,
    app: "grid",
    title: "Live parquet set retry",
    data: {
     mode: "upload",
     sources: [
      {
       id: "sales",
       schema: {
        order_number: { type: "string", nullable: false },
        test_station_identifier: { type: "string", nullable: false },
       },
       remote: {
        kind: "parquet-set",
        uri: "s3://reports/reports/",
        selector: { glob: "part-*.parquet" },
        auth: "s3",
        endpoint: new URL(fixture.origin).host,
       },
      },
     ],
    },
    filters: [
     {
      id: "station",
      kind: "select",
      source: "sales",
      column: "test_station_identifier",
      default: null,
     },
    ],
    queries: {
     records: {
      sql: "SELECT count(*) AS records FROM sales WHERE ($station IS NULL OR test_station_identifier = $station)",
      params: ["station"],
     },
    },
    layout: [
     {
      id: "kpi_records",
      type: "kpi",
      query: "records",
      field: "records",
      label: "Sales records",
      x: 1,
      y: 1,
      width: 12,
      height: 1,
     },
    ],
    theme: "neutral",
   },
  });
  await writeFile(pagePath, html, "utf8");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // Initial open prompts once, showing the declared destination and the
  // effective endpoint before credential entry.
  await expect(page.locator("dialog [data-credential-destination]")).toContainText(
   "s3://reports/reports/",
  );
  await expect(page.locator("dialog [data-credential-destination]")).toContainText(
   new URL(fixture.origin).host,
  );
  await page.locator('dialog input[aria-label="Key ID"]').fill("key-one");
  await page.locator('dialog input[aria-label="Secret"]').fill("secret-one");
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // A third object lands under the declared prefix after the generation
  // opened, and the accepted key starts being rejected.
  keys.add("reports/part-3.parquet");
  control.rejectKeys.add("key-one");

  // The next filtered read fails as a credential error; the retry re-prompts
  // and must re-stage the PINNED membership: still two parts, not three.
  await page.locator("#filter-station").selectOption({ label: "all" });
  await page.locator("#apply-filters").click();
  await page.locator('dialog input[aria-label="Key ID"]').fill("key-two");
  await page.locator('dialog input[aria-label="Secret"]').fill("secret-two");
  await page.locator('dialog button[type="submit"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // Explicit Refresh re-resolves the glob: the new part joins the source.
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "15",
  );
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await fixture.close();
 }
});

/**
 * LT-03 for manifest selectors: a remote JSON manifest resolves relative
 * keys under the declared prefix (exact duplicates deduplicate before any
 * view publishes), membership stays pinned for filtering, and a changed
 * manifest appears only in a new generation through the explicit Refresh.
 * The manifest lives outside the declared prefix, so its fetch also proves
 * the manifest-scoped credential path, and a manifest that becomes
 * unreadable fails the refresh while the prior generation stays usable
 * (LT-06) — never recommending packaged delivery for a live-only kind.
 */
test("a manifest selector pins its resolved membership until an explicit Refresh", async ({
 browser,
}) => {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", "inspections.parquet"),
 );
 // Each part serves the same 5-row fixture (3 rows station SJ per part).
 const keys = new Set(["reports/part-1.parquet", "reports/part-2.parquet"]);
 const control = {
  failObjects: false,
  failManifest: false,
  // The duplicate entry must deduplicate: two parts, not three reads.
  manifest: { files: ["part-1.parquet", "part-2.parquet", "part-1.parquet"] },
 };
 const tls = await selfSignedLocalhostCert();
 const fixture = await serveS3StyleBucket(tls, bytes, keys, control);
 const pagePath = path.join(
  rootDir,
  ".artifacts",
  "browser",
  "live-parquet-manifest.html",
 );
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const { html } = await renderDashboard({
   config: {
    contract: 2,
    app: "grid",
    title: "Live parquet manifest set",
    data: {
     mode: "upload",
     sources: [
      {
       id: "sales",
       schema: {
        order_number: { type: "string", nullable: false },
        test_station_identifier: { type: "string", nullable: false },
       },
       remote: {
        kind: "parquet-set",
        uri: "s3://reports/reports/",
        selector: { manifest: "s3://reports/manifest.json" },
        auth: "none",
        endpoint: new URL(fixture.origin).host,
       },
      },
     ],
    },
    filters: [
     {
      id: "station",
      kind: "select",
      source: "sales",
      column: "test_station_identifier",
      default: null,
     },
    ],
    queries: {
     records: {
      sql: "SELECT count(*) AS records FROM sales WHERE ($station IS NULL OR test_station_identifier = $station)",
      params: ["station"],
     },
    },
    layout: [
     {
      id: "kpi_records",
      type: "kpi",
      query: "records",
      field: "records",
      label: "Sales records",
      x: 1,
      y: 1,
      width: 12,
      height: 1,
     },
    ],
    theme: "neutral",
   },
  });
  await writeFile(pagePath, html, "utf8");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // Open: the manifest resolves both parts (duplicates deduplicated).
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // The manifest changes after the generation opened: a third part joins it
  // and lands under the declared prefix.
  control.manifest.files = [
   "part-1.parquet",
   "part-2.parquet",
   "part-3.parquet",
  ];
  keys.add("reports/part-3.parquet");

  // Filtering must not re-fetch the manifest: the pinned two parts stay.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "6",
  );

  // Explicit Refresh re-fetches the manifest: the third part joins the
  // source only in the new generation.
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "15",
  );
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "9",
  );

  // LT-06: a refresh whose manifest cannot be read keeps the prior active
  // generation usable with a source-specific error and never publishes a
  // partial refresh; the remedy never suggests packaged delivery.
  control.failManifest = true;
  await page.locator("#refresh-live").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  const failure = await page.locator("#dashboard-status").textContent();
  expect(failure).toContain("sales");
  expect(failure).toContain("Showing prior results");
  expect(failure).toContain("manifest");
  expect(failure).not.toContain("packaged build");
  // The retained snapshot is the last committed read: the SJ filter over the
  // refreshed three-part generation.
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "9",
  );

  // The retained generation keeps serving filtered reads after the failed
  // candidate (and its manifest fetch secret) was cleaned up.
  control.failManifest = false;
  await page.locator("#filter-station").selectOption({ label: "all" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "15",
  );
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await fixture.close();
 }
});

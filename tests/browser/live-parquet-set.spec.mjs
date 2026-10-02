/**
 * Live Parquet file sets, glob selector (spec 2026-09-28-0004 §2.1, LT-02):
 * a `remote: {kind: parquet-set}` source resolves its S3 prefix glob once per
 * generation through a ListObjectsV2-style endpoint. Membership stays pinned
 * for filtering; only an explicit Refresh resolves anew and can see an object
 * that landed under the prefix after open.
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
 * can land a new object under the declared prefix mid-session.
 */
async function serveS3StyleBucket(tls, bytes, keys) {
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
 const tls = await selfSignedLocalhostCert();
 const fixture = await serveS3StyleBucket(tls, bytes, keys);
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
  await expect(page.locator("#filter-station option")).toHaveCount(4);

  // Filtering reads the pinned generation: 2 parts x 3 SJ rows.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "6",
  );

  // A new object lands under the declared prefix after the generation opened.
  keys.add("reports/part-3.parquet");

  // Filtering must not re-resolve membership: clearing the filter still sees
  // only the two pinned parts.
  await page.locator("#filter-station").selectOption({ label: "all" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "10",
  );

  // Explicit Refresh re-resolves the glob: the new part joins the source.
  await expect(page.locator("#refresh-live")).toBeVisible();
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
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "9",
  );
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await fixture.close();
 }
});

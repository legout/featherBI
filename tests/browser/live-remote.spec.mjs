/**
 * Public live remote reads (RS-03): a source declared with `remote` reads its
 * URI through DuckDB-WASM's httpfs from a `file://` page against a localhost
 * served fixture. The fixture server answers CORS preflights and Range
 * requests, which httpfs issues from the worker; no external network is used.
 */

import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
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
 openHarness,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

async function harnessCall(page, method, ...args) {
 return page.evaluate(
  ({ method: call, args: values }) =>
   window.__featherbiHarness[call](...values),
  { method, args },
 );
}

/**
 * Serve one fixture from 127.0.0.1 with Range support and permissive CORS.
 * `tls` serves the same fixture over https for live dashboard configs (the
 * runtime contract admits only `s3://` and `https://` URIs); `control.fail`
 * destroys the connection without a response to simulate network loss, and
 * `control.delayMs` stalls each response to widen race windows deterministically.
 */
async function serveFixture(fileName, { tls = null, control = null } = {}) {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", fileName),
 );
 const server = (tls ? https : http).createServer(
  tls ? { key: tls.key, cert: tls.cert } : {},
  (request, response) => {
   const serve = () => {
    if (control?.fail) {
     request.socket.destroy();
     return;
    }
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader(
     "Access-Control-Allow-Methods",
     "GET, HEAD, OPTIONS",
    );
    response.setHeader("Access-Control-Allow-Headers", "Range, If-Range");
    response.setHeader(
     "Access-Control-Expose-Headers",
     "Content-Range, Accept-Ranges, Content-Length",
    );
    if (request.method === "OPTIONS") {
     response.writeHead(204);
     response.end();
     return;
    }
    if (request.url.split("/").pop() !== fileName) {
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
   };
   if (control?.delayMs) setTimeout(serve, control.delayMs);
   else serve();
  },
 );
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
}

/**
 * Self-signed localhost certificate for the https fixture server. Recipient
 * contexts open with `ignoreHTTPSErrors`; no certificate is trusted outside
 * the test.
 */
async function selfSignedLocalhostCert() {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-live-tls-"));
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

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

test("a public live remote source reads over httpfs from the file:// harness", async ({
 browser,
}) => {
 const fixture = await serveFixture("inspections.parquet");
 const { page, context } = await openHarness(browser);
 try {
  const source = {
   id: "remote_inspections",
   schema: {
    source: { type: "string", nullable: false },
    order_number: { type: "string", nullable: false },
    test_station_identifier: { type: "string", nullable: false },
    inspection_date: { type: "timestamp", nullable: false },
   },
   remote: {
    uri: `${fixture.origin}/inspections.parquet`,
    format: "parquet",
    auth: "none",
   },
  };
  const { id } = await harnessCall(page, "createEngine");
  try {
   await harnessCall(page, "registerSources", id, [{ source }]);
   const rows = await harnessCall(
    page,
    "query",
    id,
    "SELECT order_number, test_station_identifier FROM remote_inspections ORDER BY order_number DESC LIMIT 2",
   );
   expect(rows).toHaveLength(2);
   expect(rows[0].order_number).toBeTruthy();
   expect(rows[0].test_station_identifier).toBeTruthy();
   const count = await harnessCall(
    page,
    "query",
    id,
    "SELECT CAST(count(*) AS INTEGER) AS n FROM remote_inspections",
   );
   expect(count).toEqual([{ n: 5 }]);

   // A declared column the remote data does not have fails precisely.
   const wrong = {
    ...source,
    id: "wrong_schema",
    schema: { missing_column: { type: "string", nullable: false } },
    remote: { ...source.remote },
   };
   await expect(
    harnessCall(page, "registerSources", id, [{ source: wrong }]),
   ).rejects.toThrow(/missing declared column "missing_column"/);
  } finally {
   await harnessCall(page, "dispose", id);
  }
 } finally {
  await closeHarness(context);
  await fixture.close();
 }
});

/**
 * RI-04 — recoverable option search: after a working public live dashboard,
 * the fixture stops responding mid option read. The retained error names the
 * source with its remedy, prior results/options and the recipient's pending
 * edits survive, and a retry after the source recovers succeeds.
 */
test("a failed live option search retains state visibly and recovers on retry", async ({
 browser,
}) => {
 const control = { fail: false };
 const tls = await selfSignedLocalhostCert();
 const fixture = await serveFixture("inspections.parquet", { tls, control });
 const pagePath = path.join(rootDir, ".artifacts", "browser", "live-option-search.html");
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const { html } = await renderDashboard({
   config: {
    contract: 2,
    app: "grid",
    title: "Live option search",
    data: {
     mode: "upload",
     sources: [
      {
       id: "remote_inspections",
       schema: {
        source: { type: "string", nullable: false },
        order_number: { type: "string", nullable: false },
        test_station_identifier: { type: "string", nullable: false },
        inspection_date: { type: "timestamp", nullable: false },
       },
       remote: {
        uri: `${fixture.origin}/inspections.parquet`,
        format: "parquet",
        auth: "none",
       },
      },
     ],
    },
    filters: [
     {
      id: "station",
      kind: "select",
      source: "remote_inspections",
      column: "test_station_identifier",
      default: null,
     },
     {
      id: "order",
      kind: "option-search",
      source: "remote_inspections",
      column: "order_number",
      default: null,
     },
    ],
    queries: {
     records: {
      sql: "SELECT count(*) AS records FROM remote_inspections WHERE ($station IS NULL OR test_station_identifier = $station) AND ($order IS NULL OR order_number = $order)",
      params: ["station", "order"],
     },
    },
    layout: [
     {
      id: "kpi_records",
      type: "kpi",
      query: "records",
      field: "records",
      label: "Inspection records",
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
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "5",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(4);

  // Pending edit on one filter, unapplied.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await expect(page.locator("#active-filter-state")).toContainText(
   "station: all",
  );

  // The source stops responding mid option read (debounced search).
  control.fail = true;
  await page.locator("#filter-order-search").fill("7007");
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  const status = await page
   .locator("#dashboard-status")
   .textContent();
  expect(status).toContain("remote_inspections");
  expect(status).toContain("packaged build");
  expect(status).toContain("Showing prior results");

  // Prior results and options remain; the draft, typed search, and focus stay.
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "5",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(4);
  await expect(page.locator("#filter-station")).toHaveValue('"SJ"');
  await expect(page.locator("#active-filter-state")).toContainText(
   "station: all",
  );
  await expect(page.locator("#filter-order-search")).toHaveValue("7007");
  expect(
   await page.evaluate(() => document.activeElement?.id),
  ).toBe("filter-order-search");

  // The source recovers and the recipient retries the same search.
  control.fail = false;
  await page.locator("#filter-order-search").fill("7009");
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(2);
  await expect(page.locator("#filter-station")).toHaveValue('"SJ"');
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await fixture.close();
 }
});

/**
 * RI-03 — a queued option-search failure cannot undo a newer accepted
 * revision: the recipient types a search, clicks Apply before the 250 ms
 * debounce fires, and the option source dies. Apply accepts while the queued
 * option read is still pending; its later failure must retain the accepted
 * revision (RI-04's visible, retryable error) instead of republishing the
 * pre-Apply snapshot. Two sources keep the race deterministic: the query
 * source is slowed so acceptance cannot beat the debounce, and the option
 * source fails outright.
 */
test("a queued option-search failure keeps the accepted revision it raced", async ({
 browser,
}) => {
 const tls = await selfSignedLocalhostCert();
 const queryControl = { fail: false, delayMs: 0 };
 const optionControl = { fail: false, delayMs: 0 };
 const queryFixture = await serveFixture("inspections.parquet", {
  tls,
  control: queryControl,
 });
 const optionFixture = await serveFixture("inspections.parquet", {
  tls,
  control: optionControl,
 });
 const pagePath = path.join(
  rootDir,
  ".artifacts",
  "browser",
  "live-option-race.html",
 );
 const context = await browser.newContext({ ignoreHTTPSErrors: true });
 const page = await context.newPage();
 try {
  const { html } = await renderDashboard({
   config: {
    contract: 2,
    app: "grid",
    title: "Live option search race",
    data: {
     mode: "upload",
     sources: [
      {
       id: "remote_inspections",
       schema: {
        test_station_identifier: { type: "string", nullable: false },
       },
       remote: {
        uri: `${queryFixture.origin}/inspections.parquet`,
        format: "parquet",
        auth: "none",
       },
      },
      {
       id: "remote_orders",
       schema: {
        order_number: { type: "string", nullable: false },
       },
       remote: {
        uri: `${optionFixture.origin}/inspections.parquet`,
        format: "parquet",
        auth: "none",
       },
      },
     ],
    },
    filters: [
     {
      id: "station",
      kind: "select",
      source: "remote_inspections",
      column: "test_station_identifier",
      default: null,
     },
     {
      id: "order",
      kind: "option-search",
      source: "remote_orders",
      column: "order_number",
      default: null,
     },
    ],
    queries: {
     records: {
      sql: "SELECT count(*) AS records FROM remote_inspections WHERE ($station IS NULL OR test_station_identifier = $station)",
      params: ["station"],
     },
    },
    layout: [
     {
      id: "kpi_records",
      type: "kpi",
      query: "records",
      field: "records",
      label: "Inspection records",
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
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "5",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(4);

  // Pending edit, then the race: search text in, Apply before the debounce
  // fires, while the option source is already failing and the query source
  // answers slowly so the queued search cannot beat the accepted Apply.
  await page.locator("#filter-station").selectOption({ label: "SJ" });
  optionControl.fail = true;
  queryControl.delayMs = 400;
  await page.locator("#filter-order-search").fill("7007");
  await page.locator("#apply-filters").click();

  // Apply accepts (station SJ, 3 records); the queued option read then fails.
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  const status = await page.locator("#dashboard-status").textContent();
  expect(status).toContain("remote_orders");
  expect(status).toContain("Showing prior results");
  await expect(page.locator("#active-filter-state")).toContainText(
   "station: SJ",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "3",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(4);
  await expect(page.locator("#filter-order-search")).toHaveValue("7007");

  // Recovery: retry the search against a healthy option source.
  optionControl.fail = false;
  queryControl.delayMs = 0;
  await page.locator("#filter-order-search").fill("7009");
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#filter-order option")).toHaveCount(2);
  await expect(page.locator("#active-filter-state")).toContainText(
   "station: SJ",
  );
 } finally {
  await rm(pagePath, { force: true });
  await context.close();
  await queryFixture.close();
  await optionFixture.close();
 }
});

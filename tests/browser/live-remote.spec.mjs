/**
 * Public live remote reads (RS-03): a source declared with `remote` reads its
 * URI through DuckDB-WASM's httpfs from a `file://` page against a localhost
 * served fixture. The fixture server answers CORS preflights and Range
 * requests, which httpfs issues from the worker; no external network is used.
 */

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test } from "@playwright/test";
import {
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

async function harnessCall(page, method, ...args) {
 return page.evaluate(
  ({ method: call, args: values }) =>
   window.__featherbiHarness[call](...values),
  { method, args },
 );
}

/** Serve one fixture from 127.0.0.1 with Range support and permissive CORS. */
async function serveFixture(fileName) {
 const bytes = await readFile(
  path.join(rootDir, ".artifacts", "fixtures", fileName),
 );
 const server = http.createServer((request, response) => {
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
 });
 await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
 return {
  origin: `http://127.0.0.1:${server.address().port}`,
  close: () => new Promise((resolve) => server.close(resolve)),
 };
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

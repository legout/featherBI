import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import {
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

async function fixtureData() {
 const config = JSON.parse(
  await readFile(path.join(rootDir, "tests/fixtures/runtime.config.json"), "utf8"),
 );
 const inputs = await Promise.all(
  config.data.sources.map(async (source) => ({
   source,
   bytes: {
    encoding: "base64",
    value: (
     await readFile(path.join(rootDir, ".artifacts/fixtures", source.file))
    ).toString("base64"),
   },
  })),
 );
 return { config, inputs };
}

async function harnessCall(page, method, ...args) {
 return page.evaluate(
  ({ method: call, args: values }) =>
   window.__featherbiHarness[call](...values),
  { method, args },
 );
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

test("query boundary admits a bound CTE join and rejects escaped sources", async ({
 browser,
}) => {
 const { page, context } = await openHarness(browser);
 try {
  const { config, inputs } = await fixtureData();
  const { id } = await harnessCall(page, "createEngine");
  try {
   await harnessCall(page, "registerSources", id, inputs);
   const cteJoin = {
    sql: "WITH matched AS (SELECT COALESCE(p.product_label, i.product_mlfb) AS product FROM inspections i LEFT JOIN products p ON i.product_mlfb = p.product_mlfb WHERE ($source IS NULL OR i.source = $source)) SELECT product, count(*) AS records FROM matched GROUP BY product ORDER BY product",
    params: ["source"],
   };
   expect(
    await harnessCall(
     page,
     "runAuthoredQuery",
     id,
     cteJoin,
     { source: "ap1' OR TRUE --" },
     config.data.sources.map(({ id: sourceId }) => sourceId),
    ),
   ).toEqual([]);

   for (const sql of [
    "SELECT 1; SELECT 2",
    "SELECT * FROM read_csv_auto('x.csv')",
   ]) {
    await expect(
     harnessCall(
      page,
      "runAuthoredQuery",
      id,
      { sql, params: [] },
      {},
      config.data.sources.map(({ id: sourceId }) => sourceId),
     ),
    ).rejects.toThrow(/authored query/i);
   }
  } finally {
   await harnessCall(page, "dispose", id);
  }
 } finally {
  await closeHarness(context);
 }
});

test("coherent replacement retains the prior labeled state then publishes together", async ({
 browser,
}) => {
 const context = await browser.newContext();
 const page = await context.newPage();
 try {
  const dashboardPath = path.join(
   rootDir,
   ".artifacts/browser/dashboard.html",
  );
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "4",
  );

  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "3",
  );
  await expect(page.locator("#active-filter-state")).toContainText("station: SJ");

  await page.locator("#source-inspections").setInputFiles(
   path.join(rootDir, ".artifacts/fixtures/neg-missing-column.csv"),
  );
  await page.locator("#source-products").setInputFiles(
   path.join(rootDir, ".artifacts/fixtures/products.parquet"),
  );
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  await expect(page.locator("#dashboard-status")).toContainText(
   "Showing prior results",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "3",
  );
  await expect(page.locator("#filter-station")).toHaveValue('"SJ"');
  await expect(page.locator("#active-filter-state")).toContainText("station: SJ");

  await page.locator("#source-inspections").setInputFiles(
   path.join(rootDir, ".artifacts/fixtures/inspections.parquet"),
  );
  await page.locator("#source-products").setInputFiles(
   path.join(rootDir, ".artifacts/fixtures/products.parquet"),
  );
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "4",
  );
  await expect(page.locator("#filter-station")).toHaveValue("null");
  await expect(page.locator("#active-filter-state")).toContainText("station: all");
 } finally {
  await context.close();
 }
});

test("AP dashboard keeps one population across bounded views", async ({
 browser,
}) => {
 const privateFile = process.env.FEATHERBI_AP_FILE;
 test.setTimeout(privateFile ? 600_000 : 90_000);
 const chrome = requireInstalledDesktopChrome(browser);
 const context = await browser.newContext();
 const page = await context.newPage();
 const started = performance.now();
 try {
  const name = privateFile ? "ap-dashboard-upload.html" : "ap-dashboard.html";
  await page.goto(pathToFileURL(path.join(rootDir, ".artifacts/browser", name)).href, {
   waitUntil: "load",
  });
  if (privateFile) {
   await expect(page.locator("#dashboard-status")).toHaveAttribute(
    "data-state",
    "waiting",
   );
   await page.locator("#source-ap").setInputFiles(privateFile);
   await page.locator("#replace-files").click();
  }
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
   { timeout: privateFile ? 540_000 : 30_000 },
  );

  const expected = privateFile
   ? {
      records: "34,596",
      orders: "11,151",
      products: "4,618",
      stations: "27",
      code: "3,105",
      code_pct: "8.98",
      non_last: "2,120",
      non_last_pct: "6.13",
     }
   : {
      records: "120",
      orders: "120",
      products: "3",
      stations: "2",
      code: "40",
      code_pct: "33.33",
      non_last: "24",
      non_last_pct: "20.00",
     };
  for (const [id, value] of Object.entries(expected)) {
   await expect(page.locator(`#component-kpi_${id} [data-value]`)).toHaveText(value);
  }
  await expect(page.locator("#snapshot-note")).toContainText(
   "2026-08-26 may be incomplete",
  );
  const stationSummary = page.locator(
   "#component-station_activity [data-chart-summary]",
  );
  await expect(stationSummary).toContainText(privateFile ? "SJ: 2,585" : "SJ: 70");
  await expect(stationSummary).toContainText(privateFile ? "SD: 2,476" : "SD: 50");
  const codeSummary = page.locator(
   "#component-g0003_frequency [data-chart-summary]",
  );
  await expect(codeSummary).toContainText(privateFile ? "PE100: 1,547" : "PE100: 40");
  if (privateFile) {
   await expect(codeSummary).toContainText("PE101: 467");
   await expect(codeSummary).toContainText("F165: 365");
  }
  await expect(page.locator("#component-recent_records .ag-row")).toHaveCount(100);
  await expect(page.locator('#component-recent_records [data-page-action="next"]'))
   .toBeEnabled();

  if (!privateFile) {
   await page.locator("#filter-product").selectOption({ label: "(empty)" });
   await page.locator("#apply-filters").click();
   await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("30");
   await expect(page.locator("#active-filter-state")).toContainText("product: (empty)");
   await page.locator("#filter-product").selectOption({ label: "all" });
   await page.locator("#apply-filters").click();
   await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("120");
  }

  if (privateFile) {
   const evidence = await page.evaluate(() => ({
    build: window.__featherbiBuild,
    loadMs: Number(document.querySelector("#dashboard-status").dataset.loadMs),
    queryMs: Number(document.querySelector("#dashboard-status").dataset.queryMs),
    memory: window.performance.memory
     ? {
        jsHeapSizeLimit: window.performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: window.performance.memory.totalJSHeapSize,
        usedJSHeapSize: window.performance.memory.usedJSHeapSize,
       }
     : null,
   }));
   console.log(
    `AP07_EVIDENCE ${JSON.stringify({
     ...evidence,
     chrome,
     node: process.version,
     inputBytes: (await stat(privateFile)).size,
     host: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? null,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
     },
     elapsedMs: Math.round(performance.now() - started),
    })}`,
   );
   return;
  }

  await page.locator('#component-recent_records [data-page-action="next"]').click();
  await expect(page.locator("#component-recent_records .ag-row")).toHaveCount(20);
  await expect(page.locator("#component-recent_records [data-page-label]"))
   .toHaveText("Page 2");

  await page.locator("#filter-station").selectOption({ label: "SJ" });
  await page.locator("#apply-filters").click();
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("70");
  await expect(page.locator("#component-station_activity [data-chart-summary]"))
   .toContainText("SJ: 70");
  await expect(page.locator("#component-recent_records .ag-row")).toHaveCount(70);

  await page.locator("#filter-order").fill("not-an-order");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("0");
  await expect(page.locator("#component-kpi_code_pct [data-value]")).toHaveText("—");
  await expect(page.locator("#component-station_activity [data-empty]"))
   .toHaveText("No rows");
  await expect(page.locator("#component-recent_records [data-empty]"))
   .toHaveText("No rows");

  await page.locator("#source-ap").setInputFiles({
   name: "ap.json",
   mimeType: "application/json",
   buffer: Buffer.from('[{"source":"broken"}]'),
  });
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "error",
  );
  await expect(page.locator("#dashboard-status")).toContainText(
   "Showing prior results",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText("0");
 } finally {
  await context.close();
 }
});

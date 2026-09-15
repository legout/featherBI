import { readFile } from "node:fs/promises";
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

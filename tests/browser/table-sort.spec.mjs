import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";
import { compileProject } from "../../authoring/compiler.mjs";
import { buildDashboard } from "../../scripts/build.mjs";

const work = path.join(rootDir, ".artifacts", "browser", "table-sort");
const dashboardPath = path.join(work, "dashboard.html");
const ROWS = 150;

/**
 * Test-local scratch dashboard: one paged table (page size 100) over 150
 * rows with unique amounts, ordered by station first so the global maximum
 * amount only reaches page 1 through a query-level sort.
 */
async function buildTableDashboard() {
 const scratch = path.join(work, "project");
 await rm(work, { recursive: true, force: true });
 await mkdir(path.join(scratch, "models"), { recursive: true });
 await mkdir(path.join(scratch, "queries"), { recursive: true });
 await writeFile(
  path.join(scratch, "dashboard.yaml"),
  `project: 1
title: Table sort
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: false}
models:
  inspection_model:
    sql: models/inspection_model.sql
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: false}
dimensions:
  station: {model: inspection_model, field: station, label: Station}
filters:
  - id: station_filter
    kind: multi-select
    source: inspections
    column: station
    dimension: station
    default: []
queries:
  grid_rows: {sql: queries/grid_rows.sql, params: [station_filter]}
layout:
  - id: rows
    type: table
    query: grid_rows
    label: Inspection records
    columns:
      - {field: station, label: Station}
      - {field: amount, label: Amount}
    x: 1
    y: 1
    width: 12
    height: 4
`,
  "utf8",
 );
 await writeFile(
  path.join(scratch, "models", "inspection_model.sql"),
  "SELECT station, amount FROM inspections",
  "utf8",
 );
 await writeFile(
  path.join(scratch, "queries", "grid_rows.sql"),
  `SELECT station, amount
FROM inspection_model
WHERE ($station_filter IS NULL OR json_contains($station_filter, to_json(station)))
ORDER BY station, amount`,
  "utf8",
 );
 const { config } = await compileProject(path.join(scratch, "dashboard.yaml"));
 await buildDashboard({
  config,
  outPath: dashboardPath,
  inputs: [
   {
    id: "inspections",
    value: Buffer.from(
     JSON.stringify(
      Array.from({ length: ROWS }, (_, index) => ({
       station: `S${index % 5}`,
       amount: index + 1,
      })),
     ),
    ).toString("base64"),
   },
  ],
 });
 return dashboardPath;
}

test.beforeAll(async ({ browser }) => requireInstalledDesktopChrome(browser));

test("paged table sorts the full result by query and offers no page-local filter", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(await buildTableDashboard()).href, { waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(100);
  await expect(page.locator("#component-rows [data-page-label]")).toHaveText("Page 1");

  // Station-first order keeps every large amount off page 1, so only a
  // query-level sort can put the global maximum (150) in the first row.
  const pageOneAmounts = await page
   .locator('#component-rows .ag-cell[col-id="amount"]')
   .allTextContents();
  expect(Math.max(...pageOneAmounts.map(Number))).toBeLessThan(ROWS);

  // AG Grid header sort cycles none -> ascending -> descending; waiting on
  // the first row (not the status attribute) keeps the second click off the
  // mid-transition header state.
  const amountHeader = page.locator("#component-rows .ag-header-cell", { hasText: "Amount" });
  const firstAmount = page.locator(
   '#component-rows .ag-row[row-index="0"] .ag-cell[col-id="amount"]',
  );
  await amountHeader.click();
  await expect(firstAmount).toHaveText("1");
  await amountHeader.click();
  await expect(firstAmount).toHaveText(String(ROWS));

  // The global order continues on page 2 instead of restarting per page.
  await page.locator('#component-rows [data-page-action="next"]').click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-rows [data-page-label]")).toHaveText("Page 2");
  await expect(
   page.locator('#component-rows .ag-row[row-index="0"] .ag-cell[col-id="amount"]'),
  ).toHaveText(String(ROWS - 100));

  // A page-local column filter could only hide rows of the current page
  // while implying it filters the full result, so paged tables never offer
  // one: no filter menu or header filter affordance appears.
  await amountHeader.hover();
  await expect(page.locator("#component-rows .ag-menu")).toHaveCount(0);
  await expect(
   await page
    .locator("#component-rows .ag-filter-icon")
    .evaluateAll((nodes) => nodes.every((node) => node.offsetParent === null)),
  ).toBe(true);
 } finally {
  await context.close();
 }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const deliveryDir = path.join(rootDir, ".artifacts", "browser", "delivery");
const projectDir = path.join(deliveryDir, "project");
const sourcePath = path.join(deliveryDir, "ap.json");
const zipPath = path.join(projectDir, ".featherbi", "dashboard.zip");
const extractedDir = path.join(deliveryDir, "bundle");

const rows = Array.from({ length: 4 }, (_, index) => ({
 source: "ap1",
 order_number: `ORDER-${index}`,
 test_station_identifier: index < 2 ? "SJ" : "SD",
 sequence_number: String(index),
 G0003: "PE100",
 product_mlfb: "P1",
 inspection_date: "2026-08-26T08:00:00",
 is_last_measurement: true,
}));

async function cli(...args) {
 return execFileAsync(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  ...args,
 ]);
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
 await rm(deliveryDir, { recursive: true, force: true });
 await mkdir(deliveryDir, { recursive: true });
 await cp(path.join(rootDir, "examples", "ap-dashboard"), projectDir, {
  recursive: true,
 });
 await writeFile(
  sourcePath.replace(/\.json$/, ".ndjson"),
  rows.map((row) => JSON.stringify(row)).join("\n"),
 );
 await execFileAsync("uv", [
  "run",
  "--with",
  "duckdb",
  "python",
  "-c",
  [
   "import duckdb, sys",
   "rows_path, parquet_path = sys.argv[1], sys.argv[2]",
   "con = duckdb.connect()",
   "con.execute(f\"CREATE TABLE ap AS SELECT * FROM read_ndjson_auto('{rows_path}')\")",
   `con.execute(f"COPY ap TO '{parquet_path}' (FORMAT PARQUET)")`,
  ].join("; "),
  sourcePath.replace(/\.json$/, ".ndjson"),
  sourcePath,
 ]);
 await cli("compile", "--project", path.join(projectDir, "dashboard.yaml"));
 await cli(
  "build",
  "--config",
  path.join(projectDir, ".featherbi", "dashboard.config.json"),
  "--source",
  `ap=${sourcePath}`,
  "--output",
  zipPath,
 );
 await mkdir(extractedDir, { recursive: true });
 await execFileAsync("uv", [
  "run",
  "python",
  "-m",
  "zipfile",
  "-e",
  zipPath,
  extractedDir,
 ]);
});

test("AP project ZIP members stay external, secret, and reopen after explicit selection", async ({
 browser,
}) => {
 assert.deepEqual((await readdir(extractedDir)).sort(), [
  "dashboard.html",
  "unified_ap.parquet",
 ]);
 const html = await readFile(path.join(extractedDir, "dashboard.html"), "utf8");
 assert.ok(
  !html.includes(sourcePath),
  "HTML must not contain local source paths",
 );
 assert.ok(!html.includes("PE100"), "HTML must not contain dataset bytes");

 const context = await browser.newContext();
 const page = await context.newPage();
 try {
  await page.goto(
   pathToFileURL(path.join(extractedDir, "dashboard.html")).href,
   {
    waitUntil: "load",
   },
  );
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "waiting",
  );
  await page
   .locator("#source-ap")
   .setInputFiles(path.join(extractedDir, "unified_ap.parquet"));
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   "4",
  );
 } finally {
  await context.close();
 }
});

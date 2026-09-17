import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const work = path.join(rootDir, ".artifacts", "browser", "exploration-delivery");
const project = path.join(work, "project");
const data = path.join(work, "inspections.json");
const archive = path.join(work, "dashboard.zip");
const extracted = path.join(work, "extracted");

async function cli(...args) {
 return execFileAsync(process.execPath, [path.join(rootDir, "bin", "featherbi.mjs"), ...args]);
}

async function setSql(page, sql) {
 const editor = page.locator("[data-playground-editor] .cm-content");
 await editor.click();
 await page.keyboard.press("Meta+A");
 await page.keyboard.insertText(sql);
}

async function load(page) {
 await page.goto(pathToFileURL(path.join(extracted, "dashboard.html")).href, { waitUntil: "load" });
 await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "waiting");
 await page.locator("#source-inspections").setInputFiles(path.join(extracted, "inspections.json"));
 await page.locator("#replace-files").click();
 await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
 await rm(work, { recursive: true, force: true });
 await mkdir(work, { recursive: true });
 await cp(path.join(rootDir, "examples", "exploration-dashboard"), project, { recursive: true });
 await writeFile(data, JSON.stringify(Array.from({ length: 12 }, (_, index) => ({ station: `S${index % 3}`, amount: index + 1 }))));
 await cli("compile", "--project", path.join(project, "dashboard.yaml"));
 await cli("build", "--config", path.join(project, ".featherbi", "dashboard.config.json"), "--source", `inspections=${data}`, "--output", archive);
 await mkdir(extracted, { recursive: true });
 await execFileAsync("uv", ["run", "python", "-m", "zipfile", "-e", archive, extracted]);
});

test("file exploration uses Community grid, bounded Perspective, and recoverable ephemeral SQL", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await load(page);
  await expect(page.locator("#component-rows .ag-root")).toBeVisible();
  await expect(page.locator("#component-explore perspective-viewer")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => page.locator("#component-explore perspective-viewer").evaluate((viewer) => viewer.save().then((config) => config.plugin))).toBe("Y Bar");
  await expect(page.locator("[data-playground-editor] .cm-editor")).toBeVisible();
  await expect(page.locator("[data-playground-editor]")).toHaveAttribute("data-completions", "inspection_model,inspections");

  const stationCells = page.locator('#component-rows .ag-cell[col-id="station"]');
  await stationCells.filter({ hasText: "S0" }).first().click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S0");
  await stationCells.filter({ hasText: "S1" }).first().click({ modifiers: ["Shift"] });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S0, S1");
  await stationCells.filter({ hasText: "S0" }).first().click({ modifiers: ["Shift"] });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S1");
  await page.locator("#filter-station_filter").selectOption([]);
  await page.locator("#apply-filters").click();
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: all");

  await setSql(page, "WITH chosen AS (SELECT station, amount FROM inspection_model) SELECT * FROM chosen ORDER BY amount");
  await page.locator("[data-playground-run]").click();
  await expect(page.locator("[data-playground-result] .ag-root")).toBeVisible();
  await expect(page.locator("[data-playground-result] .ag-row")).toHaveCount(12);

  await setSql(page, "SELECT station, station FROM inspections LIMIT 1");
  await page.locator("[data-playground-run]").click();
  await expect(page.locator("[data-playground-error]")).toContainText("duplicate column names");
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");

  for (const sql of [
   "DELETE FROM inspections",
   "CREATE TABLE nope AS SELECT * FROM inspections",
   "SELECT * FROM read_csv_auto('/tmp/private.csv')",
   "SELECT * FROM inspections; SELECT 1",
   "SELECT 'https://example.test/data.csv' AS url FROM inspections",
   "SELECT '/tmp/private.csv' AS path FROM inspections",
   "SELECT * FROM unknown_source",
   "INSTALL httpfs",
   "LOAD httpfs",
   "COPY inspections TO 'https://example.test/out.csv'",
  ]) {
   await setSql(page, sql);
   await page.locator("[data-playground-run]").click();
   await expect(page.locator("[data-playground-error]")).not.toBeEmpty();
   await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  }

  const excess = "SELECT a.station FROM inspections a, inspections b, inspections c, inspections d";
  await setSql(page, excess);
  await page.locator("[data-playground-run]").click();
  await expect(page.locator("[data-playground-error]")).toContainText("10,000-row limit");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(12);

  await setSql(page, "SELECT repeat(station, 1000000) AS payload FROM inspections");
  await page.locator("[data-playground-run]").click();
  await expect(page.locator("[data-playground-error]")).toContainText("8 MiB Arrow limit");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(12);

  const timeout = await page.evaluate(async () => {
   const dashboard = await window.__featherbiDashboardReady;
   try {
    await dashboard.runPlayground("SELECT sum(a.amount*b.amount*c.amount*d.amount*e.amount*f.amount*g.amount) FROM inspections a, inspections b, inspections c, inspections d, inspections e, inspections f, inspections g", { timeoutMs: 100 });
    return "completed";
   } catch (error) {
    return error.message;
   }
  });
  expect(timeout).toContain("100-ms time limit");
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");

  await setSql(page, "SELECT station, amount FROM inspections ORDER BY amount LIMIT 2");
  await page.locator("[data-playground-run]").click();
  await expect(page.locator("[data-playground-error]")).toBeEmpty();
  await expect(page.locator("[data-playground-result] .ag-row")).toHaveCount(2);

  const build = await page.evaluate(() => window.__featherbiBuild);
  expect(build.capabilities.map(({ id }) => id)).toEqual(["core", "ag-grid", "perspective", "codemirror"]);
  expect(build.capabilities.find(({ id }) => id === "perspective").assets).toHaveLength(3);

  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "waiting");
  await page.locator("#source-inspections").setInputFiles(path.join(extracted, "inspections.json"));
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(12);
 } finally {
  await context.close();
 }
});

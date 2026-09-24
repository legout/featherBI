import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";
import { compileProject } from "../../authoring/compiler.mjs";
import { buildDashboard } from "../../scripts/build.mjs";

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
 await editor.fill(sql);
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

/**
 * Test-local scratch project copied from examples/exploration-dashboard:
 * a grouped-and-split Perspective mark whose group/split fields map to two
 * compatible dimensions, one ambiguous dimension owned by two filters, and
 * one unmapped group field. Data ships inline so the focused case does not
 * repeat the delivery flow of the test above.
 */
const selectionWork = path.join(rootDir, ".artifacts", "browser", "exploration-selection");
const selectionDashboard = path.join(selectionWork, "dashboard.html");

const selectionRows = [
 { station: "S1", region: "east", line: "L1", area: "north", amount: 10 },
 { station: "S1", region: "east", line: "L2", area: "south", amount: 20 },
 { station: "S1", region: "west", line: "L1", area: "south", amount: 30 },
 { station: "S1", region: "west", line: "L2", area: "north", amount: 40 },
 { station: "S2", region: "east", line: "L1", area: "south", amount: 50 },
 { station: "S2", region: "east", line: "L2", area: "north", amount: 60 },
 { station: "S2", region: "west", line: "L1", area: "north", amount: 70 },
 { station: "S2", region: "west", line: "L2", area: "south", amount: 80 },
];

async function buildSelectionDashboard() {
 const scratch = path.join(selectionWork, "project");
 await rm(selectionWork, { recursive: true, force: true });
 await cp(path.join(rootDir, "examples", "exploration-dashboard"), scratch, { recursive: true });
 await rm(path.join(scratch, ".featherbi"), { recursive: true, force: true });
 await rm(path.join(scratch, "queries", "heatmap_cells.sql"), { force: true });
 await writeFile(
  path.join(scratch, "dashboard.yaml"),
  `project: 1
title: Exploration selection
rendererPreset: perspective-first
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema:
      station: {type: string, nullable: false}
      region: {type: string, nullable: false}
      line: {type: string, nullable: false}
      area: {type: string, nullable: false}
      amount: {type: number, nullable: false}
models:
  inspection_model:
    sql: models/inspection_model.sql
    schema:
      station: {type: string, nullable: false}
      region: {type: string, nullable: false}
      line: {type: string, nullable: false}
      area: {type: string, nullable: false}
      amount: {type: number, nullable: false}
dimensions:
  station: {model: inspection_model, field: station, label: Station}
  line: {model: inspection_model, field: line, label: Line}
  area: {model: inspection_model, field: area, label: Area}
filters:
  - id: station_filter
    kind: multi-select
    source: inspections
    column: station
    dimension: station
    default: []
  - id: area_filter
    kind: multi-select
    source: inspections
    column: area
    dimension: area
    default: []
  - id: line_filter_a
    kind: multi-select
    source: inspections
    column: line
    dimension: line
    default: []
  - id: line_filter_b
    kind: select
    source: inspections
    column: line
    dimension: line
    default: null
relationships: []
queries:
  grid_rows: {sql: queries/grid_rows.sql, params: [station_filter, area_filter, line_filter_a]}
  exploration: {sql: queries/exploration.sql, params: [station_filter, area_filter, line_filter_a]}
layout:
  - id: rows
    type: table
    query: grid_rows
    label: Inspection records
    columns:
      - {field: station, label: Station}
      - {field: region, label: Region}
      - {field: line, label: Line}
      - {field: area, label: Area}
      - {field: amount, label: Amount}
    x: 1
    y: 1
    width: 12
    height: 3
  - id: explore
    type: perspective
    query: exploration
    label: Amount by station, region, line, and area
    perspective:
      plugin: Y Bar
      groupBy: [station, region]
      splitBy: [line, area]
      columns: [amount]
    selectionDimensions: {station: station, line: line, area: area}
    x: 1
    y: 4
    width: 12
    height: 4
`,
  "utf8",
 );
 await writeFile(
  path.join(scratch, "models", "inspection_model.sql"),
  "SELECT station, region, line, area, amount FROM inspections",
  "utf8",
 );
 const bounded = () => `FROM inspection_model
WHERE ($station_filter IS NULL OR json_contains($station_filter, to_json(station)))
  AND ($area_filter IS NULL OR json_contains($area_filter, to_json(area)))
  AND ($line_filter_a IS NULL OR json_contains($line_filter_a, to_json(line)))`;
 await writeFile(
  path.join(scratch, "queries", "grid_rows.sql"),
  `SELECT station, region, line, area, amount
${bounded()}
ORDER BY station, amount`,
  "utf8",
 );
 await writeFile(
  path.join(scratch, "queries", "exploration.sql"),
  `SELECT station, region, line, area, sum(amount) AS amount
${bounded()}
GROUP BY station, region, line, area
ORDER BY station, region, line, area`,
  "utf8",
 );
 const { config } = await compileProject(path.join(scratch, "dashboard.yaml"));
 await buildDashboard({
  config,
  outPath: selectionDashboard,
  inputs: [
   { id: "inspections", value: Buffer.from(JSON.stringify(selectionRows)).toString("base64") },
  ],
 });
 return selectionDashboard;
}

/**
 * Click the plotted Y Bar mark for one cross/split combination with a real
 * mouse event. Marks carry typed data (crossValue "station|region", key
 * "line|area|column"); the clicked point is the mark's visible center. With
 * `shift`, the modifier is held on the keyboard around the click: Playwright's
 * raw mouse.click modifiers option never reaches installed desktop Chrome.
 * The chart re-renders after each committed revision, so the mark is awaited.
 */
async function clickPerspectiveMark(page, crossValue, key, shift = false) {
 const locate = () =>
  page.locator("#component-explore perspective-viewer").evaluate(
   (viewer, { crossValue, key }) => {
    let mark = null;
    const visit = (root) => {
     for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) visit(element.shadowRoot);
      const data = element.__data__;
      if (
      element.tagName === "path" &&
      data &&
      data.crossValue === crossValue &&
      data.key === key &&
      !mark
      )
       mark = element;
     }
    };
    visit(viewer);
    if (!mark) return null;
    mark.scrollIntoView({ block: "center" });
    const box = mark.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
   },
   { crossValue, key },
  );
 let point = null;
 for (let attempt = 0; attempt < 50 && !point; attempt += 1) {
  point = await locate();
  if (!point) await page.waitForTimeout(200);
 }
 if (!point) throw new Error(`no plotted mark for ${crossValue} / ${key}`);
 if (shift) await page.keyboard.down("Shift");
 try {
  await page.mouse.click(point.x, point.y);
 } finally {
  if (shift) await page.keyboard.up("Shift");
 }
}

test("grouped-and-split Perspective mark commits typed selection and pending edits in one revision", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(await buildSelectionDashboard()).href, { waitUntil: "load" });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(8);
  const viewer = page.locator("#component-explore perspective-viewer");
  await expect
   .poll(() => viewer.evaluate((node) => node.save().then((config) => config.plugin)))
   .toBe("Y Bar");

  // Pending edit: L2 chosen in the ambiguous line filter, not yet applied.
  await page.locator("#filter-line_filter_a").selectOption(["L2"]);
  await expect(page.locator("#active-filter-state")).toContainText("line_filter_a: all");

  // Real mark click: station=S1, region=east (unmapped), line=L1
  // (ambiguous dimension), area=north.
  await expect
   .poll(() =>
    viewer.evaluate((node) => {
     let seen = false;
     const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
       if (element.shadowRoot) visit(element.shadowRoot);
       const data = element.__data__;
       if (element.tagName === "path" && data?.crossValue === "S1|east" && data?.key === "L1|north|amount")
        seen = true;
      }
     };
     visit(node);
     return seen;
    }),
   )
   .toBe(true);
  await clickPerspectiveMark(page, "S1|east", "L1|north|amount");
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");

  // The two compatible mappings and the pending edit land in ONE revision:
  // only S1/west/L2/north satisfies station=S1, area=north, and line=L2.
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S1");
  await expect(page.locator("#active-filter-state")).toContainText("area_filter: north");
  await expect(page.locator("#active-filter-state")).toContainText("line_filter_a: L2");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(1);

  // The ambiguous line dimension never guesses a shared filter: the click's
  // L1 is absent and the second owning filter stays untouched.
  await expect(page.locator("#active-filter-state")).toContainText("line_filter_b: all");
  await expect(page.locator("#active-filter-state")).not.toContainText("L1");

  // The unmapped region field stays visibly local next to its component.
  await expect(page.locator("#component-explore")).toHaveAttribute("data-local-selection", "east,L1");

  // Reset the committed revision so every grouped cross is plotted again.
  await page.locator("#filter-station_filter").selectOption([]);
  await page.locator("#filter-area_filter").selectOption([]);
  await page.locator("#filter-line_filter_a").selectOption([]);
  await page.locator("#apply-filters").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: all");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(8);

  // A keyboard-held Shift click ADDS the clicked value to a pending control
  // edit instead of replacing it: pending S2 plus clicked S1 keeps both.
  await page.locator("#filter-station_filter").selectOption(["S2"]);
  await clickPerspectiveMark(page, "S1|east", "L1|north|amount", true);
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S2, S1");
  await expect(page.locator("#active-filter-state")).toContainText("area_filter: north");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(4);

  // The same Shift click on the now-selected value removes only that value.
  await clickPerspectiveMark(page, "S1|east", "L1|north|amount", true);
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#active-filter-state")).toContainText("station_filter: S2; ");
  await expect(page.locator("#active-filter-state")).toContainText("area_filter: all");
  await expect(page.locator("#active-filter-state")).not.toContainText("S1");
  await expect(page.locator("#component-rows .ag-row")).toHaveCount(4);
  await expect(page.locator("#component-explore")).toHaveAttribute("data-local-selection", "east,L1");
 } finally {
  await context.close();
 }
});

test("file exploration uses Community grid, bounded Perspective, and recoverable ephemeral SQL", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await load(page);
  await expect(page.locator("#component-rows .ag-root")).toBeVisible();
  await expect(page.locator("#component-explore perspective-viewer")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => page.locator("#component-explore perspective-viewer").evaluate((viewer) => viewer.save().then((config) => config.plugin))).toBe("Y Bar");
  const heatmapViewer = page.locator("#component-heatmap perspective-viewer");
  await expect(heatmapViewer).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => heatmapViewer.evaluate((viewer) => viewer.getTable().then((table) => table.size()))).toBeGreaterThan(0);
  const heatmapConfig = await heatmapViewer.evaluate((viewer) => viewer.save());
  expect(heatmapConfig.plugin).toBe("Datagrid");
  expect(heatmapConfig.columns).toEqual(["station", "band", "total"]);
  await expect(page.locator("#component-heatmap [data-empty]")).toHaveText("");
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

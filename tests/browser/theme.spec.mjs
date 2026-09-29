import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";
import { compileProject } from "../../authoring/compiler.mjs";
import { buildDashboard } from "../../scripts/build.mjs";

const derivedDir = path.join(rootDir, ".artifacts/browser/derived-theme");
const themeDashboardPath = path.join(derivedDir, "theme-runtime.html");
const overrideDashboardPath = path.join(derivedDir, "theme-override.html");

// Distinctive custom tokens: every asserted value differs from every neutral
// fallback in runtime/viewer.css, so a missing bake cannot pass by accident.
const TOKENS = `version: 1
font: Custom Feather Sans, sans-serif
fontMono: '"Custom Mono", monospace'
radius: 10
surface: "#000028"
surface2: "#0d0d40"
text: "#e6e9f8"
textDim: "#8f96c4"
border: "#262660"
accent: "#00e6dc"
accentContrast: "#000028"
success: "#00ffb9"
warning: "#ffb35c"
danger: "#ff6b8a"
chart:
  palette: ["#00e6dc", "#00ffb9", "#009999"]
`;

const AUTHOR_CSS = `#dashboard-layout > section {
 background: #123456;
}
`;

const TABLE_COMPONENT = `  - id: station_table
    type: table
    query: station_rows
    label: Station records
    columns:
      - {field: station, label: Station}
      - {field: records, label: Records}
    x: 1
    y: 12
    width: 12
    height: 2
`;

/** Rows matching the standard example's packaged inspection source. */
const rows = [
 { station: "SJ", product: "P1", inspected_on: "2026-09-01", amount: 10, successful: true },
 { station: "SJ", product: "P2", inspected_on: "2026-09-02", amount: 20, successful: true },
 { station: "SD", product: "P1", inspected_on: "2026-09-03", amount: 30, successful: false },
 { station: "SJ", product: "P2", inspected_on: "2026-09-04", amount: 40, successful: true },
 { station: "SD", product: "P3", inspected_on: "2026-09-05", amount: 50, successful: false },
 { station: "NY", product: "P1", inspected_on: "2026-09-06", amount: 60, successful: true },
];

async function buildDerived({ outPath, tokens = TOKENS, authorCss }) {
 const exampleDir = path.join(rootDir, "examples/standard-dashboard");
 let source = await readFile(path.join(exampleDir, "dashboard.yaml"), "utf8");
 source = source
  .replace("theme: daisyui\n", "themeTokens: theme.tokens.yaml\n")
  .replace("themeCss: theme.css\n", authorCss ? "themeCss: theme.css\n" : "");
 // Table queries are exclusive; give the table its own copy of the station rollup.
 source = source.replace(
  "layout:",
  `  station_rows:
    model: inspection_model
    dimensions: [station]
    measures: [records]
    filters: [window]
    orderBy: [station]
layout:`,
 );
 source += TABLE_COMPONENT;
 await mkdir(path.join(derivedDir, "models"), { recursive: true });
 await writeFile(path.join(derivedDir, "dashboard.yaml"), source, "utf8");
 await writeFile(
  path.join(derivedDir, "models", "inspection_model.sql"),
  await readFile(path.join(exampleDir, "models", "inspection_model.sql"), "utf8"),
  "utf8",
 );
 await writeFile(path.join(derivedDir, "theme.tokens.yaml"), tokens, "utf8");
 if (authorCss) await writeFile(path.join(derivedDir, "theme.css"), authorCss, "utf8");
 const project = await compileProject(path.join(derivedDir, "dashboard.yaml"));
 await buildDashboard({
  config: project.config,
  outPath,
  inputs: [
   { id: "inspections", value: Buffer.from(JSON.stringify(rows)).toString("base64") },
  ],
 });
 return outPath;
}

function rgb(hex) {
 const value = hex.replace("#", "");
 return [
  Number.parseInt(value.slice(0, 2), 16),
  Number.parseInt(value.slice(2, 4), 16),
  Number.parseInt(value.slice(4, 6), 16),
 ];
}

/** Count canvas device pixels within tolerance of each target color. */
function colorCounts(page, selector, hexColors) {
 return page.locator(selector).evaluate((canvas, targets) => {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const counts = targets.map(() => 0);
  for (let i = 0; i < data.length; i += 4) {
   for (let [index, [red, green, blue]] of targets.entries()) {
    if (
     Math.abs(data[i] - red) <= 3 &&
     Math.abs(data[i + 1] - green) <= 3 &&
     Math.abs(data[i + 2] - blue) <= 3
    )
     counts[index] += 1;
   }
  }
  return counts;
 }, hexColors.map(rgb));
}

async function ready(page) {
 await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
}

async function openDashboard(browser, dashboardPath) {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
 await ready(page);
 return { page, context };
}

test.beforeAll(async ({ browser }) => requireInstalledDesktopChrome(browser));

test("custom theme tokens render baked variables, chart palette, axis, and AG Grid styling (TT-01)", async ({ browser }) => {
 const dashboardPath = await buildDerived({ outPath: themeDashboardPath });
 const { page, context } = await openDashboard(browser, dashboardPath);
 try {
  await expect(page.locator("#dashboard")).toHaveAttribute("data-theme", "custom");
  // Baked variables reach the page shell: surface canvas, font stack.
  expect(
   await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe("rgb(0, 0, 40)");
  expect(
   await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("Custom Feather Sans");
  // Sections consume surface2/border/radius from the baked block.
  const section = page.locator("#component-by_station");
  await expect(section).toHaveCSS("background-color", "rgb(13, 13, 64)");
  await expect(section).toHaveCSS("border-color", "rgb(38, 38, 96)");
  await expect(section).toHaveCSS("border-radius", "10px");
  // AG Grid is themed through the supported --ag-* mappings alone.
  await expect(page.locator("#component-station_table .ag-root-wrapper").first()).toHaveCSS(
   "background-color",
   "rgb(0, 0, 40)",
  );
  await expect(page.locator("#component-station_table .ag-header").first()).toHaveCSS(
   "background-color",
   "rgb(13, 13, 64)",
  );
  await expect(page.locator("#component-station_table .ag-row").first()).toHaveCSS(
   "color",
   "rgb(230, 233, 248)",
  );
  // Numeric cells use the optional mono token, unlike the table's text cells.
  const numericCell = page.locator('#component-station_table .ag-cell[col-id="records"]').first();
  expect(await numericCell.getAttribute("class")).toContain("featherbi-numeric-cell");
  expect(
   await numericCell.evaluate((cell) => getComputedStyle(cell).fontFamily),
  ).toContain("Custom Mono");
  // The registered ECharts theme drives real pixels: bars use the palette
  // head and the axis line uses the border token.
  const [palettePixels, borderPixels] = await colorCounts(
   page,
   "#component-by_station .chart canvas",
   ["#00e6dc", "#262660"],
  );
  expect(palettePixels).toBeGreaterThan(200);
  expect(borderPixels).toBeGreaterThan(30);
 } finally {
  await context.close();
 }
});

test("author theme.css applies after the baked theme and wins conflicts (TT-08)", async ({ browser }) => {
 const dashboardPath = await buildDerived({
  outPath: overrideDashboardPath,
  authorCss: AUTHOR_CSS,
 });
 const { page, context } = await openDashboard(browser, dashboardPath);
 try {
  await expect(page.locator("#dashboard")).toHaveAttribute("data-theme", "custom");
  const section = page.locator("#component-by_station");
  // The scoped author rule wins the background conflict...
  await expect(section).toHaveCSS("background-color", "rgb(18, 52, 86)");
  // ...while the rest of the baked theme keeps applying.
  await expect(section).toHaveCSS("border-color", "rgb(38, 38, 96)");
  expect(
   await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe("rgb(0, 0, 40)");
 } finally {
  await context.close();
 }
});

test("invalid token errors identify the file and key (TT-02)", async () => {
 await buildDerived({ outPath: themeDashboardPath });
 await writeFile(path.join(derivedDir, "theme.tokens.yaml"), TOKENS + "\nserif: Arial\n", "utf8");
 await assertCompileError(/theme\.tokens\.yaml:\d+:\d+: unknown theme token key "serif"/);
 await writeFile(
  path.join(derivedDir, "theme.tokens.yaml"),
  TOKENS.replace('surface: "#000028"', 'surface: "purple"'),
  "utf8",
 );
 await assertCompileError(/theme\.tokens\.yaml:\d+:\d+: theme token "surface" must be/);
 // Restore the valid token file for the TT-04 mutation below.
 await writeFile(path.join(derivedDir, "theme.tokens.yaml"), TOKENS, "utf8");
});

test("themeTokens combined with a non-neutral theme fails naming both fields (TT-04)", async () => {
 const source = await readFile(path.join(derivedDir, "dashboard.yaml"), "utf8");
 await writeFile(
  path.join(derivedDir, "dashboard.yaml"),
  source.replace(
   "themeTokens: theme.tokens.yaml\n",
   "theme: daisyui\nthemeTokens: theme.tokens.yaml\n",
  ),
  "utf8",
 );
 await assertCompileError(/dashboard\.yaml:\d+:\d+: themeTokens cannot be combined with theme: daisyui/);
 // Restore the valid derived project.
 await buildDerived({ outPath: themeDashboardPath });
});

async function assertCompileError(pattern) {
 await expect(compileProject(path.join(derivedDir, "dashboard.yaml"))).rejects.toThrow(pattern);
}

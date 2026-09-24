import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";
import { compileProject } from "../../authoring/compiler.mjs";
import { buildDashboard } from "../../scripts/build.mjs";

const dashboardPath = path.join(rootDir, ".artifacts/browser/standard-runtime.html");
const derivedProjectDir = path.join(rootDir, ".artifacts/browser/derived-standard");
const derivedDashboardPath = path.join(rootDir, ".artifacts/browser/standard-derived.html");

/**
 * Test-local dashboard derived from the standard example, adding the
 * explicit selectionDimensions bindings the shipped fixture cannot carry:
 * a category+series mark with a boolean category, and a mark whose two
 * fields map to one dimension with different values.
 */
async function buildDerivedDashboard() {
 const exampleDir = path.join(rootDir, "examples/standard-dashboard");
 const source = await readFile(path.join(exampleDir, "dashboard.yaml"), "utf8");
 const derived = source.replace(
  "layout:",
  `  by_success_station:
    model: inspection_model
    dimensions: [successful, station, product]
    measures: [records]
    filters: [window]
    orderBy: [successful, station, product]
layout:`,
 ) + `
  - id: success_station
    type: bar
    query: by_success_station
    label: Success by station
    xField: successful
    series: station
    yField: records
    selectionDimensions: {successful: successful, station: station}
    x: 1
    y: 13
    width: 12
    height: 2
  - id: conflicting_pairs
    type: bar
    query: by_success_station
    label: Conflicting pairs
    xField: station
    series: product
    yField: records
    selectionDimensions: {station: station, product: station}
    x: 1
    y: 15
    width: 12
    height: 2
`;
 await mkdir(path.join(derivedProjectDir, "models"), { recursive: true });
 await writeFile(path.join(derivedProjectDir, "dashboard.yaml"), derived, "utf8");
 await writeFile(
  path.join(derivedProjectDir, "models/inspection_model.sql"),
  await readFile(path.join(exampleDir, "models/inspection_model.sql"), "utf8"),
  "utf8",
 );
 await writeFile(
  path.join(derivedProjectDir, "theme.css"),
  await readFile(path.join(exampleDir, "theme.css"), "utf8"),
  "utf8",
 );
 const project = await compileProject(path.join(derivedProjectDir, "dashboard.yaml"));
 await buildDashboard({
  config: project.config,
  outPath: derivedDashboardPath,
  inputs: [
   { id: "inspections", value: Buffer.from(JSON.stringify(standardRows)).toString("base64") },
  ],
 });
 return derivedDashboardPath;
}

/**
 * Test-local dashboard derived from the standard example, adding the content
 * fixtures the shipped example deliberately does not carry: markdown holding
 * unsupported and unsafe constructs, plus literal text/heading siblings.
 */
async function buildMarkdownDashboard() {
 const exampleDir = path.join(rootDir, "examples/standard-dashboard");
 const derivedProjectDir = path.join(rootDir, ".artifacts/browser/derived-standard-markdown");
 const derivedDashboardPath = path.join(rootDir, ".artifacts/browser/standard-markdown.html");
 const derived = (await readFile(path.join(exampleDir, "dashboard.yaml"), "utf8")) + `
  - id: unsafe_notes
    type: markdown
    label: Unsupported markdown stays literal
    content: |
      Raw HTML never renders: <img src="https://example.com/pixel.png" onerror="alert(1)"> and <b>bold</b>.

      Disallowed destinations stay plain text:
      [self-destruct](javascript:alert(document.domain)) and
      [packaged file](file:///etc/passwd).
    x: 1
    y: 13
    width: 12
    height: 2
  - id: plain_note
    type: text
    label: Literal note
    content: Plain text keeps <em>markup</em> escaped.
    x: 1
    y: 15
    width: 6
    height: 1
  - id: plain_heading
    type: heading
    label: Literal heading
    content: A heading is not markdown
    x: 7
    y: 15
    width: 6
    height: 1
`;
 await mkdir(path.join(derivedProjectDir, "models"), { recursive: true });
 await writeFile(path.join(derivedProjectDir, "dashboard.yaml"), derived, "utf8");
 await writeFile(
  path.join(derivedProjectDir, "models/inspection_model.sql"),
  await readFile(path.join(exampleDir, "models/inspection_model.sql"), "utf8"),
  "utf8",
 );
 await writeFile(
  path.join(derivedProjectDir, "theme.css"),
  await readFile(path.join(exampleDir, "theme.css"), "utf8"),
  "utf8",
 );
 const project = await compileProject(path.join(derivedProjectDir, "dashboard.yaml"));
 await buildDashboard({
  config: project.config,
  outPath: derivedDashboardPath,
  inputs: [
   { id: "inspections", value: Buffer.from(JSON.stringify(standardRows)).toString("base64") },
  ],
 });
 return derivedDashboardPath;
}

let derivedDashboard;
let markdownDashboard;

/** Rows matching the harness standard dashboard fixture. */
const standardRows = [
 { station: "SJ", product: "P1", inspected_on: "2026-09-01", amount: 10, successful: true },
 { station: "SJ", product: "P2", inspected_on: "2026-09-02", amount: 20, successful: true },
 { station: "SD", product: "P1", inspected_on: "2026-09-03", amount: 30, successful: false },
 { station: "SJ", product: "P2", inspected_on: "2026-09-04", amount: 40, successful: true },
 { station: "SD", product: "P3", inspected_on: "2026-09-05", amount: 50, successful: false },
 { station: "NY", product: "P1", inspected_on: "2026-09-06", amount: 60, successful: true },
];

/** X centers of the visible plotted bars in one canvas row, left to right. */
async function barCenters(page, selector, y) {
 return page.locator(selector).evaluate(
  (canvas, y) => {
   const ctx = canvas.getContext("2d");
   const { width } = canvas;
   const img = ctx.getImageData(0, 0, width, canvas.height).data;
   const runs = [];
   let run = null;
   for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const max = Math.max(img[i], img[i + 1], img[i + 2]);
    const min = Math.min(img[i], img[i + 1], img[i + 2]);
    const colored = img[i + 3] > 30 && (max - min > 40 || max < 200);
    if (colored && run) run.end = x;
    else if (colored) run = { start: x, end: x };
    else if (run) {
     runs.push(run);
     run = null;
    }
   }
   if (run) runs.push(run);
   return runs
    .filter((entry) => entry.end - entry.start >= 20) // bars, not tick text
    .map((entry) => Math.round((entry.start + entry.end) / 2));
  },
  y,
 );
}

async function ready(page) {
 await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
}

test.beforeAll(async ({ browser }) => requireInstalledDesktopChrome(browser));

test("chart mark click commits pending filter edits and typed selection in one revision", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await ready(page);

  // Pending edit without Apply: numeric range narrowed in the control only.
  await page.locator("#filter-amount_range-through").fill("30");
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 100");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  // Pending single-select edit on the option-search filter.
  await page.locator("#filter-station_lookup").selectOption({ label: "NY" });
  await expect(page.locator("#active-filter-state")).toContainText("station_lookup: all");

  // An option search refreshes that filter's options; drafts, the off-page
  // selected value, typed search text, and focus must survive the re-render.
  await page.locator("#filter-station_lookup-search").fill("D");
  await page.locator("#filter-station_lookup").focus();
  await expect
   .poll(() => page.locator("#filter-station_lookup option").allTextContents())
   .toEqual(["all", "NY", "SD"]);
  await expect(page.locator("#filter-amount_range-through")).toHaveValue("30");
  await expect(page.locator("#filter-station_lookup-search")).toHaveValue("D");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("filter-station_lookup");
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 100");

  // Unmapped plotted mark: typed selection stays local with visible feedback.
  await page.locator("#component-local_product .chart canvas").click({ position: { x: 350, y: 63 } });
  await expect(page.locator("#component-local_product")).toHaveAttribute("data-local-selection", "P1");
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 100");

  // Mapped plotted mark (bar, station SJ): the typed selection and BOTH
  // pending control edits land in one accepted revision. Only stations=SJ
  // gives 3 records, only amount<=30 gives 3; together they give 2.
  await page.locator("#component-by_station .chart canvas").click({ position: { x: 610, y: 230 } });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 30");
  await expect(page.locator("#active-filter-state")).toContainText("stations: SJ");
  await expect(page.locator("#active-filter-state")).toContainText("station_lookup: NY");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("2");
  await expect(page.locator("#filter-station_lookup-search")).toHaveValue("D");

  // A cleared (null) draft must also survive an option refresh: selecting
  // "all" after the committed NY must not resurrect NY on the next render.
  await page.locator("#filter-station_lookup").selectOption({ label: "all" });
  await page.locator("#filter-station_lookup-search").fill("N");
  await expect
   .poll(() => page.locator("#filter-station_lookup option").allTextContents())
   .toEqual(["all", "NY"]);
  await expect(page.locator("#filter-station_lookup")).toHaveValue("null");
  await expect(page.locator("#active-filter-state")).toContainText("station_lookup: NY");

  // Derived dashboard: explicit selectionDimensions on a category+series
  // mark. The category is boolean (typed true), displayed as the text label
  // "true"; the click must commit both dimensions atomically with the typed
  // values, not the labels.
  derivedDashboard ??= await buildDerivedDashboard();
  const derived = await context.newPage();
  await derived.goto(pathToFileURL(derivedDashboard).href, { waitUntil: "load" });
  await ready(derived);
  const seriesCenters = await barCenters(derived, "#component-success_station .chart canvas", 200);
  expect(seriesCenters.length).toBe(3); // false:SD, true:NY, true:SJ
  await derived
   .locator("#component-success_station .chart canvas")
   .click({ position: { x: seriesCenters[2], y: 200 } });
  await ready(derived);
  await expect(derived.locator("#active-filter-state")).toContainText("successful_only: true");
  await expect(derived.locator("#active-filter-state")).toContainText("stations: SJ");
  await expect(derived.locator("#filter-successful_only-yes")).toBeChecked();
  await expect(derived.locator("#component-summary [data-metric=records]")).toHaveText("3");

  // Two fields of one mark mapped to the same dimension with different
  // values (station=SJ, product=P2 -> dimension station) stay local.
  const conflictCenters = await barCenters(derived, "#component-conflicting_pairs .chart canvas", 200);
  expect(conflictCenters.length).toBe(5); // SD:P1, SD:P3, NY:P1, SJ:P1, SJ:P2
  await derived
   .locator("#component-conflicting_pairs .chart canvas")
   .click({ position: { x: conflictCenters[4], y: 200 } });
  await expect(derived.locator("#component-conflicting_pairs")).toHaveAttribute("data-local-selection", "SJ,P2");
  await expect(derived.locator("#active-filter-state")).toContainText("stations: SJ");
  await expect(derived.locator("#component-summary [data-metric=records]")).toHaveText("3");
 } finally {
  await context.close();
 }
});

test("boolean filter moves All to Yes to No and back to All with keyboard", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await ready(page);

  // Default null renders as the checked All choice (typed "all").
  await expect(page.locator("#filter-successful_only-all")).toBeChecked();
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: all");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  // Keyboard All -> Yes stays a pending draft until Apply commits it.
  await page.locator("#filter-successful_only-all").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#filter-successful_only-yes")).toBeChecked();
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: all");
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: true");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("4");
  await expect(page.locator("#filter-successful_only-yes")).toBeChecked();

  // From the committed non-null Yes, keyboard moves to No (typed false).
  await page.locator("#filter-successful_only-yes").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#filter-successful_only-no")).toBeChecked();
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: false");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("2");

  // The named failure: the group wraps No -> All without a reload, and the
  // null typed value restores the unfiltered result.
  await page.locator("#filter-successful_only-no").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#filter-successful_only-all")).toBeChecked();
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: all");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");
 } finally {
  await context.close();
 }
});

test("markdown renders the safe subset; unsupported markup and unsafe links stay inert", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await ready(page);
  const notes = page.locator("#component-reading_notes");

  // Supported subset renders as real elements (red while markdown is literal).
  await expect(notes.locator("strong")).toHaveText("daily inspection records");
  await expect(notes.locator("em")).toHaveText("pending");
  await expect(notes.locator("ul > li")).toHaveCount(4);
  await expect(notes.locator("ol > li")).toHaveCount(3);
  await expect(notes.locator("ol > li").first()).toHaveText("Check the Summary KPIs for the active filters.");

  // Allowed links are https/mailto only and isolated from the dashboard.
  const links = notes.locator("a");
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute("href", "mailto:insights@example.com");
  await expect(links.nth(0)).toHaveText("insights@example.com");
  await expect(links.nth(1)).toHaveAttribute("href", "https://example.com/featherbi/sharing");
  await expect(links.nth(1)).toHaveText("sharing handbook");
  for (const anchor of await links.all()) {
   await expect(anchor).toHaveAttribute("target", "_blank");
   await expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
  }

  // Unsupported and unsafe constructs stay literal; nothing executes/fetches.
  markdownDashboard ??= await buildMarkdownDashboard();
  const unsafe = await context.newPage();
  await unsafe.goto(pathToFileURL(markdownDashboard).href, { waitUntil: "load" });
  await ready(unsafe);
  const probe = unsafe.locator("#component-unsafe_notes");
  await expect(probe).toContainText('<img src="https://example.com/pixel.png" onerror="alert(1)">');
  await expect(probe).toContainText("<b>bold</b>");
  expect(await probe.locator("img, script, iframe, b").count()).toBe(0);
  await expect(probe).toContainText("[self-destruct](javascript:alert(document.domain))");
  await expect(probe).toContainText("[packaged file](file:///etc/passwd)");
  await expect(probe.locator("a")).toHaveCount(0);

  // Plain text and heading stay literal escaped content.
  await expect(unsafe.locator("#component-plain_note p")).toHaveText("Plain text keeps <em>markup</em> escaped.");
  expect(await unsafe.locator("#component-plain_note em").count()).toBe(0);
  await expect(unsafe.locator("#component-plain_heading h3")).toHaveText("A heading is not markdown");
 } finally {
  await context.close();
 }
});

test("standard dashboard stays coherent across layout, theme, interactions, and stale revisions", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await ready(page);

  await expect(page.locator("#dashboard")).toHaveAttribute("data-theme", "daisyui");
  expect(await page.evaluate(() => window.__featherbiBuild.themeVersion)).toBe("5.2.1");
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("featherbi-theme:daisyui@5.2.1"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("featherbi-theme:siemens-ix"))).toBe(false);
  await expect(page.locator("#dashboard-status")).toBeVisible();
  await expect(page.locator("#dashboard-sources")).toBeVisible();
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");
  await expect(page.locator("#component-summary [data-metric=success_rate]")).toHaveText("0.67");
  await expect(page.locator("#component-by_station [data-chart-summary]")).toContainText("SJ: 3");

  await page.locator("#filter-amount_range-through").fill("30");
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 30");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("3");
  await page.locator("#filter-amount_range-through").fill("100");
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  await page.locator("#component-by_success [data-action-value=true]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: true");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("4");
  await page.locator("#component-by_success [data-action-value=true]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: all");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  const first = await page.locator("#component-summary").boundingBox();
  const second = await page.locator("#component-by_station").boundingBox();
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);

  await page.locator("#component-by_station [data-action-value=SJ]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SJ");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("3");

  await page.locator("#component-by_station [data-action-value=SD]").click({ modifiers: ["Shift"] });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SJ, SD");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("5");
  await page.locator("#component-by_station [data-action-value=SJ]").click({ modifiers: ["Shift"] });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SD");
  await page.locator("#component-by_station [data-action-value=SD]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: all");

  await page.locator("#component-by_day [data-brush-from]").fill("2026-09-02");
  await page.locator("#component-by_day [data-brush-through]").fill("2026-09-03");
  await page.locator("#component-by_day [data-brush-apply]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("window: 2026-09-02 through 2026-09-03");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("2");

  const beforeLocal = await page.locator("#active-filter-state").textContent();
  await page.locator("#component-local_product [data-action-value=P1]").click();
  await expect(page.locator("#active-filter-state")).toHaveText(beforeLocal);
  await expect(page.locator("#component-local_product")).toHaveAttribute("data-local-selection", "P1");

  await page.evaluate(async () => {
   const select = document.querySelector("#filter-stations");
   for (const value of ['SJ', 'SD']) {
    const option = [...select.options].find((entry) => entry.textContent === value);
    option.selected = value === 'SJ';
   }
   const apply = document.querySelector("#apply-filters");
   apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
   await Promise.resolve(); // Let the obsolete revision enter DuckDB before superseding it.
   for (const option of select.options) option.selected = option.textContent === 'SD';
   apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SD");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("1");

  await page.setViewportSize({ width: 480, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const tops = await page.locator("#dashboard-layout > section").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(tops).toEqual([...tops].sort((left, right) => left - right));
  await expect(page.locator("#dashboard-status")).toBeVisible();
  await expect(page.locator("#replace-files")).toBeVisible();
 } finally {
  await context.close();
 }
});

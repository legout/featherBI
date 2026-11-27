// Spec 0005 §2 and acceptance 4: `locale` and the richer `format` on KPIs, a chart tooltip, the pivot, table cells and dates.
// Expected strings are hand-derived from the spec and fixtures/hand/README.md; \u00a0 is the non-breaking space Intl writes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const revenue = "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}";

// A config generated in the test, built next to a copy of the hand fixture's sales rows; `check` runs on the opened page and gets the built HTML.
async function generated(page, config, check) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locale-"));
  try {
    fs.copyFileSync(root + "fixtures/hand/sales.parquet", path.join(tmp, "sales.parquet"));
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify({ title: "Locale", name: "generated", sources: { sales: { read: "read_parquet('sales.parquet')" } }, date: { col: "order_date", default: "all" }, ...config }));
    execFileSync("node", [root + "skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml"], { cwd: tmp, stdio: "pipe" });
    const html = fs.readFileSync(path.join(tmp, "dist/generated.html"), "utf8");
    const errors = [];
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(tmp, "dist/generated.html")).href);
    await check(html);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const tile = (page, title) => page.getByRole("group", { name: new RegExp(`^${title}`) }); // a table title also carries its row count
// The exact characters, non-breaking spaces included (toHaveText would normalize them).
const exactly = (locator, text) => expect.poll(() => locator.textContent()).toBe(text);
const kpi = (page, title, text) => exactly(tile(page, title).locator(".stat-value"), text);
// Drawn on canvas, so read from the chart itself: the tooltip the library shows for the first item, and an axis's label format.
const chartOf = (page, title, read) =>
  tile(page, title).getByRole("img").evaluate(async (node, read) => {
    const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
    const instance = (await import(charts.url)).getInstanceByDom(node);
    if (read === "tip") return instance.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 0 });
    const { formatter } = instance.getOption().yAxis[read].axisLabel;
    return typeof formatter === "function" ? formatter(100) : formatter;
  }, read);
const drawn = (page, title) => expect(tile(page, title)).not.toHaveAttribute("aria-busy", "true");
const BINS = "SELECT floor(revenue / 50) * 50 AS lo, floor(revenue / 50) * 50 + 50 AS hi, COUNT(*) AS count FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1";
const PARETO = "SELECT region || ' ' || channel AS x, SUM(revenue) AS y FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1";
const firstRow = table => table.locator('[role="row"][aria-rowindex="2"]').getByRole("gridcell");

test("locale de-DE: currency, decimals with a unit, percent, pivot cells, a chart tooltip, table numbers and dates", async ({ page }) => {
  const euro = { style: "currency", currency: "EUR" };
  const tiles = [
    { type: "kpi", title: "Revenue", format: euro, sql: revenue },
    { type: "kpi", title: "Tonnes", format: { decimals: 1, unit: "t" }, sql: "SELECT 1234.5 AS value" },
    { type: "kpi", title: "Share", format: "percent", sql: "SELECT 0.25 AS value" },
    { type: "kpi", title: "Growth", sql: "SELECT 1.25 AS value", compare: "SELECT 1 AS value" },
    { type: "echarts", preset: "bar", title: "By region", format: euro, sql: "SELECT region AS x, SUM(revenue) AS y FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1" },
    { type: "pivot", title: "Region × channel", format: euro, sql: "SELECT region AS r, channel AS c, SUM(revenue) AS v FROM sales WHERE {{filters:sales}} GROUP BY 1, 2 ORDER BY 1, 2" },
    { type: "table", title: "Rows", source: "sales", columns: ["order_date", "region", "revenue"] },
    { type: "echarts", preset: "histogram", title: "Order values", format: { decimals: 3 }, sql: BINS },
    { type: "echarts", preset: "pareto", title: "Pareto", sql: PARETO },
    { type: "echarts", preset: "pareto", title: "Own-axis Pareto", option: { yAxis: [{}, { axisLabel: { formatter: "{value} pct" } }] }, sql: PARETO },
    { type: "table", title: "Days", sql: "SELECT order_date, SUM(revenue) AS revenue, COUNT(*) * 1000 AS n, AVG(revenue)::DOUBLE / 3 AS third FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1" },
  ];
  await generated(page, { locale: "de-DE", tiles }, async () => {
    await kpi(page, "Revenue", "2.260,50\u00a0€"); // README: the hand total
    await kpi(page, "Tonnes", "1.234,5\u00a0t");
    await kpi(page, "Share", "25\u00a0%");
    await exactly(tile(page, "Growth").locator(".stat-desc"), "+25\u00a0%"); // Δ %: (1.25 − 1) / 1
    await exactly(tile(page, "Region × channel").getByRole("row", { name: /^EU/ }).getByRole("cell").first(), "360,00\u00a0€"); // README: EU Online
    await expect(firstRow(tile(page, "Rows"))).toHaveText(["05.01.2025", "EU", "100,00"]); // README row 1, DECIMAL(10,2)
    // 2025-01-05: 100 + 200 = 300.00 in two rows; a BIGINT gets the locale's grouping, a DOUBLE at most 2 digits (150 / 3 = 50).
    await expect(firstRow(tile(page, "Days"))).toHaveText(["05.01.2025", "300,00", "2.000", "50"]);
    // The tooltip of the first bar (EU, README total 850.00), shown by the chart library itself.
    const chart = tile(page, "By region");
    await expect(chart).not.toHaveAttribute("aria-busy", "true");
    const axisLabel = await chart.getByRole("img").evaluate(async node => {
      const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
      const instance = (await import(charts.url)).getInstanceByDom(node);
      instance.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 0 });
      return instance.getOption().yAxis[0].axisLabel.formatter(1500); // the value axis writes its ticks with this
    });
    expect(axisLabel).toBe("1.500");
    // README: the first bin is 100..150 with 3 orders; the edges take the tile's `format`, the count is a count.
    await drawn(page, "Order values");
    await chartOf(page, "Order values", "tip");
    await expect.poll(() => tile(page, "Order values").textContent()).toContain("100,000 – 150,000: 3");
    // The Pareto preset's own percentage axis (0–100) follows the locale; an author's axis label format stays as written.
    await drawn(page, "Own-axis Pareto");
    expect(await chartOf(page, "Pareto", 1)).toBe("100\u00a0%");
    expect(await chartOf(page, "Own-axis Pareto", 1)).toBe("{value} pct");
    await expect.poll(() => chart.textContent()).toContain("850,00\u00a0€");
  });
});

test("locale en-US: the table date column takes the numeric short form; numbers stay as without a locale", async ({ page }) => {
  const tiles = [
    { type: "kpi", title: "Revenue", format: "currency", sql: revenue },
    { type: "table", title: "Rows", source: "sales", columns: ["order_date", "revenue"] },
  ];
  await generated(page, { locale: "en-US", tiles }, async () => {
    await kpi(page, "Revenue", "$2,260.50");
    await expect(firstRow(tile(page, "Rows"))).toHaveText(["01/05/2025", "100.00"]);
  });
});

test("without a locale a `format` object still applies: currency other than dollars, fixed decimals, a unit", async ({ page }) => {
  const tiles = [
    { type: "kpi", title: "Revenue", format: { style: "currency", currency: "EUR" }, sql: revenue },
    { type: "kpi", title: "Intensity", format: { decimals: 2, unit: "m³/t" }, sql: "SELECT 88.656 AS value" },
    { type: "echarts", preset: "histogram", title: "Order values", sql: BINS },
    { type: "echarts", preset: "pareto", title: "Pareto", sql: PARETO },
    // A text column whose name every object inherits is not a number column.
    { type: "table", title: "Regions", sql: 'SELECT region AS "constructor", SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1' },
  ];
  await generated(page, { tiles }, async () => {
    await kpi(page, "Revenue", "€2,260.50");
    await kpi(page, "Intensity", "88.66\u00a0m³/t"); // the spec's own example
    await expect(firstRow(tile(page, "Regions")).nth(1)).toHaveText("850.00"); // README: the EU total; the row renders
    // Without `format` and `locale` the histogram tooltip and the Pareto percentage axis are as before.
    await drawn(page, "Pareto");
    await chartOf(page, "Order values", "tip");
    await expect.poll(() => tile(page, "Order values").textContent()).toContain("100 – 150: 3");
    expect(await chartOf(page, "Pareto", 1)).toBe("{value} %");
  });
});

// Spec 0005 §3, §4 and acceptance 5, 6. The dates are the first and last order date of the hand fixture (README).
const hand = { sales: { read: `read_parquet('${root}fixtures/hand/sales.parquet')` } }; // the source SQL names the fixture's path
const headerLine = page => page.locator("header h1 ~ p").last();

test("header line without a locale: data status, period and source label in en-US; a KPI note under the value; no source path in the page", async ({ page }) => {
  const tiles = [
    { type: "kpi", title: "Revenue", format: "currency", note: "Sum of revenue, net", sql: revenue },
    { type: "kpi", title: "Plain", format: "currency", sql: revenue },
  ];
  await generated(page, { sources: hand, source_label: "Sales export", tiles }, async html => {
    await exactly(headerLine(page), "Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025 · Source Sales export");
    await expect(page.locator("header p")).toHaveCount(1); // no subtitle, no other line
    expect(html).not.toContain("fixtures/hand");
    expect(html).not.toContain("sales.parquet");
    await kpi(page, "Revenue", "$2,260.50");
    const note = tile(page, "Revenue").getByText("Sum of revenue, net", { exact: true });
    await expect(note).toBeVisible();
    const below = async locator => (await locator.boundingBox()).y;
    expect(await below(note)).toBeGreaterThan(await below(tile(page, "Revenue").locator(".stat-value")));
    // Without `note`: the title and the value, nothing else.
    await kpi(page, "Plain", "$2,260.50");
    await exactly(tile(page, "Plain"), "Plain$2,260.50");
  });
});

test("header line with locale de-DE: the dates in the locale; the subtitle before the line", async ({ page }) => {
  const tiles = [{ type: "kpi", title: "Revenue", sql: revenue }];
  await generated(page, { locale: "de-DE", subtitle: "Weekly sales review", source_label: "Sales export", tiles }, async () => {
    await exactly(headerLine(page), "Data as of 25.03.2025 · Period 05.01.2025 – 25.03.2025 · Source Sales export");
    await expect(page.locator("header h1 ~ p")).toHaveText(["Weekly sales review", /^Data as of/]);
  });
});

// An open-ended contract: DuckDB's DATE 'infinity' as the last date. The header line takes the last real date, and the
// tiles and filters mount (the hand fixture's rows plus one open-ended row of 0 revenue).
test("header line over a date column with DATE 'infinity': the last real date; the tiles still mount", async ({ page }) => {
  const sources = { sales: { read: `(SELECT order_date AS valid_to, revenue FROM read_parquet('sales.parquet') UNION ALL SELECT DATE 'infinity', 0)` } };
  const tiles = [{ type: "kpi", title: "Revenue", format: "currency", sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}" }];
  await generated(page, { sources, date: { col: "valid_to", default: { from: "2025-01-01", to: "2025-03-31" } }, tiles }, async () => {
    await exactly(headerLine(page), "Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025");
    await kpi(page, "Revenue", "$2,260.50");
    await expect(page.getByLabel("From")).toHaveValue("2025-01-01");
  });
});

test("the build rejects a note, subtitle or source label over 200 characters, counted as characters", () => {
  const long = "x".repeat(201);
  const tiles = [{ type: "kpi", title: "Revenue", sql: revenue }];
  // 198 letters and "📈!": 200 characters (201 UTF-16 units) are within the limit.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locale-"));
  try {
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify({ title: "Locale", sources: hand, subtitle: "x".repeat(198) + "📈!", tiles }));
    execFileSync("node", [root + "skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml"], { cwd: tmp, stdio: "pipe" });
    expect(fs.existsSync(path.join(tmp, "dist/locale.html"))).toBe(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const [config, named] of [[{ subtitle: long, tiles }, /subtitle/], [{ source_label: long, tiles }, /source_label/], [{ tiles: [{ ...tiles[0], note: long }] }, /note/]]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locale-"));
    try {
      fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify({ title: "Locale", sources: hand, ...config }));
      expect(() => execFileSync("node", [root + "skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml"], { cwd: tmp, stdio: "pipe" })).toThrow(named);
      expect(fs.existsSync(path.join(tmp, "dist"))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

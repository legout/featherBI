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

// A config generated in the test, built next to a copy of the hand fixture's sales rows; `check` gets the opened page.
async function generated(page, config, check) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locale-"));
  try {
    fs.copyFileSync(root + "fixtures/hand/sales.parquet", path.join(tmp, "sales.parquet"));
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify({ title: "Locale", name: "generated", sources: { sales: { read: "read_parquet('sales.parquet')" } }, date: { col: "order_date", default: "all" }, ...config }));
    execFileSync("node", [root + "skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml"], { cwd: tmp, stdio: "pipe" });
    const errors = [];
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(tmp, "dist/generated.html")).href);
    await check();
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const tile = (page, title) => page.getByRole("group", { name: new RegExp(`^${title}`) }); // a table title also carries its row count
// The exact characters, non-breaking spaces included (toHaveText would normalize them).
const exactly = (locator, text) => expect.poll(() => locator.textContent()).toBe(text);
const kpi = (page, title, text) => exactly(tile(page, title).locator(".stat-value"), text);
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
  ];
  await generated(page, { tiles }, async () => {
    await kpi(page, "Revenue", "€2,260.50");
    await kpi(page, "Intensity", "88.66\u00a0m³/t"); // the spec's own example
  });
});

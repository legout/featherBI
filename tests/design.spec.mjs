// Spec 0006 acceptance 1, 3 and 5 for the default design (classic-bi): the hand acceptance fixture with one `size: large`
// chart, one `size: wide` table and an Orders KPI placed after the first chart (README: 12 rows), built with the real CLI and opened over file://. Values: fixtures/hand/README.md. Tabs (acceptance 4): sections.spec.mjs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const TITLES = ["Revenue", "Revenue vs target by region", "Orders", "Revenue by channel", "Region × month", "Sales rows", "Revenue by region \\(SQL\\)", "Note"]; // config order

let tmp;
test.beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "design-"));
  for (const file of ["sales.parquet", "targets.xlsx"]) fs.copyFileSync(`${root}fixtures/hand/${file}`, path.join(tmp, file));
  const yaml = fs.readFileSync(`${root}fixtures/hand/acceptance.yaml`, "utf8");
  const edits = [
    ["    title: Revenue vs target by region\n", "    title: Revenue vs target by region\n    size: large\n"],
    ["    title: Sales rows\n", "    title: Sales rows\n    size: wide\n"],
    // A KPI after a chart: on a narrow screen it stays there, on a desktop it joins the KPI row.
    ["  - type: echarts\n    preset: bar\n    title: Revenue by channel\n", '  - type: kpi\n    title: Orders\n    sql: "SELECT COUNT(*) AS value FROM sales WHERE {{filters:sales}}"\n  - type: echarts\n    preset: bar\n    title: Revenue by channel\n'],
  ];
  let large = yaml;
  for (const [was, now] of edits) {
    expect(large.split(was).length).toBe(2);
    large = large.replace(was, now);
  }
  fs.writeFileSync(path.join(tmp, "dashboard.yaml"), large); // no `design`: the default
  fs.writeFileSync(path.join(tmp, "market.yaml"), `design: market-desk\n${large}`);
});
test.afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Built once per worker. -> the page's URL
function built(config, ...args) {
  const out = path.join(tmp, `${config}.html`);
  if (!fs.existsSync(out)) execFileSync("node", [`${root}skill/featherbi/scripts/featherbi.mjs`, "build", config, "--out", out, ...args], { cwd: tmp, stdio: "pipe" });
  return pathToFileURL(out).href;
}
function watch(page) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  return errors;
}
const tile = (page, title) => page.getByRole("group", { name: new RegExp(`^${title}( ·|$)`) }); // a table title also carries its row count
const revenueIs = (page, amount) => expect(tile(page, "Revenue").getByText(amount, { exact: true })).toBeVisible();
const settled = async page => {
  await revenueIs(page, "$2,260.50");
  for (const title of TITLES) await expect(tile(page, title)).not.toHaveAttribute("aria-busy", "true");
};

// 1024×768 is the narrowest viewport with the filter panel docked.
for (const [width, height] of [[1440, 900], [1024, 768]]) {
  test(`default design at ${width}×${height}: the KPIs and the filters are in the first viewport, the filters in a side panel; large and wide tiles are larger than a medium one`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = watch(page);
    await page.goto(built("dashboard.yaml"));
    await settled(page);
    const box = locator => locator.boundingBox();
    const kpi = await box(tile(page, "Revenue"));
    const large = await box(tile(page, "Revenue vs target by region"));
    const medium = await box(tile(page, "Revenue by channel"));
    const wide = await box(tile(page, "Sales rows"));
    const orders = await box(tile(page, "Orders"));
    expect(kpi.y + kpi.height).toBeLessThanOrEqual(height);
    // The KPI row: the KPI configured after the first chart sits beside Revenue, above that chart.
    expect(orders.y).toBe(kpi.y);
    expect(orders.x).toBeGreaterThanOrEqual(kpi.x + kpi.width);
    expect(large.y).toBeGreaterThanOrEqual(orders.y + orders.height);
    // Every filter control is visible without a click or a scroll, right of the tiles.
    for (const control of [page.getByRole("combobox", { name: "region" }), page.getByRole("combobox", { name: "channel" }), page.getByLabel("From"), page.getByLabel("To"), page.getByRole("button", { name: "Reset", exact: true })]) {
      await expect(control).toBeVisible();
      const at = await box(control);
      expect(at.y + at.height).toBeLessThanOrEqual(height);
      for (const tileBox of [kpi, large, medium, wide]) expect(at.x).toBeGreaterThanOrEqual(tileBox.x + tileBox.width);
    }
    for (const bigger of [large, wide]) expect(bigger.width * bigger.height).toBeGreaterThan(medium.width * medium.height * 1.2);
    expect(errors).toEqual([]);
  });
}

test.describe("desktop 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("--shell wins over `design`, and the shell gets the design name and the tile sizes", async ({ page }) => {
    const errors = watch(page);
    await page.goto(built("market.yaml", "--shell", `${root}tests/fixtures/plain-shell.js`));
    await expect(page.getByText("Plain shell", { exact: true })).toBeVisible();
    await expect(page.getByText("Design: market-desk", { exact: true })).toBeVisible();
    await revenueIs(page, "$2,260.50");
    // Without `size` a KPI is small and every other tile medium.
    await expect(tile(page, "Revenue")).toHaveAttribute("data-size", "small");
    await expect(tile(page, "Revenue vs target by region")).toHaveAttribute("data-size", "large");
    await expect(tile(page, "Revenue by channel")).toHaveAttribute("data-size", "medium");
    expect(errors).toEqual([]);
  });
});

test.describe("narrow 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("default design: tiles stack in config order without horizontal overflow; the filters open from a disclosure", async ({ page }) => {
    const errors = watch(page);
    await page.goto(built("dashboard.yaml"));
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    let bottom = 0;
    for (const title of TITLES) {
      const at = await tile(page, title).boundingBox();
      expect(at.y, `${title} is below the tile before it`).toBeGreaterThanOrEqual(bottom);
      bottom = at.y + at.height;
    }
    const region = page.getByRole("combobox", { name: "region" });
    const disclosure = page.getByRole("button", { name: /^Filters/ });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(region).toBeHidden();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    for (const control of [region, page.getByRole("combobox", { name: "channel" }), page.getByLabel("From"), page.getByLabel("To"), page.getByRole("button", { name: "Reset", exact: true })]) await expect(control).toBeVisible();
    await region.selectOption("EU");
    await revenueIs(page, "$850.00");
    await expect(region).toBeVisible(); // the panel stays open over a filter change
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});

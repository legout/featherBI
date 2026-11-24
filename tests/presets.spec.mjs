// Presets journey: every preset on the hand data, opened over file://. Expected values are hand-computed in fixtures/hand/README.md.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
// Spec 0001 §Tile types: the 17 presets of v1.
const PRESETS = ["line", "area", "bar", "stacked-bar", "hbar", "pie", "donut", "scatter", "heatmap", "treemap", "sunburst", "funnel", "gauge", "sankey", "waterfall", "boxplot", "calendar"];

test.beforeAll(() => {
  execFileSync("node", ["skill/featherbi/scripts/featherbi.mjs", "build", "fixtures/hand/presets.yaml"], { cwd: root, stdio: "pipe" });
});

async function open(page) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(pathToFileURL(root + "fixtures/hand/dist/hand-presets.html").href);
  return errors;
}

const tile = (page, title) => page.getByRole("group", { name: title, exact: true });
const revenue = (page, amount) => expect(tile(page, "Revenue").getByText(amount, { exact: true })).toBeVisible();
// True once any canvas of the tile holds a painted pixel.
const painted = chart =>
  chart.evaluate(node =>
    [...node.querySelectorAll("canvas")].some(c => {
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    }),
  );
// Clicks at a fraction of the chart's canvas, once the tile has finished drawing.
async function clickChart(page, title, fx, fy) {
  await expect(tile(page, title)).not.toHaveAttribute("aria-busy", "true");
  const box = await tile(page, title).locator("canvas").first().boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test("all 17 presets render, the bar tile shows revenue and target per region, KPI and text tiles are filled", async ({ page }) => {
  const errors = await open(page);
  const tiles = await page.evaluate(() => JSON.parse(document.getElementById("dashboard").textContent).tiles.filter(t => t.type === "echarts"));
  expect(tiles.map(t => t.preset).sort()).toEqual([...PRESETS].sort());
  for (const t of tiles) await expect.poll(() => painted(tile(page, t.title)), `preset ${t.preset}`).toBe(true);

  // README: EU 850.00 and US 1,410.50 revenue; targets EU 800 and US 1500. The chart describes its data for screen readers.
  const bars = tile(page, "Revenue vs target by region").getByRole("img");
  await expect(bars).toHaveAttribute("aria-label", /revenue.*EU is 850\b.*US is 1410\.5\b.*target.*EU is 800\b.*US is 1500\b/s);

  // KPI: total 2,260.50 against targets 800 + 1500 = 2300, so (2260.5 - 2300) / 2300 = -1.7 %; three months of spark.
  await revenue(page, "$2,260.50");
  await expect(tile(page, "Revenue")).toContainText("-1.7%");
  await expect(tile(page, "Revenue").locator("svg")).toBeVisible();
  await expect(tile(page, "Orders").getByText("12", { exact: true })).toBeVisible();

  const about = tile(page, "About");
  await expect(about.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(about).toContainText("Revenue is net of returns, in US dollars.");
  await expect(about.getByRole("listitem")).toHaveCount(2);
  await expect(about.getByRole("link", { name: "the fixture README" })).toHaveAttribute("href", /^https:\/\/github\.com\/legout\/featherBI\//);
  expect(errors).toEqual([]);
});

test("a click on a bar, a donut slice or a heatmap cell sets the filter, and the same click again clears it", async ({ page }) => {
  const errors = await open(page);
  const chips = page.getByLabel("Active filters");
  await revenue(page, "$2,260.50");

  // Bar: the EU revenue bar is the leftmost one.
  await clickChart(page, "Revenue vs target by region", 0.2, 0.75);
  await revenue(page, "$850.00");
  await expect(chips).toContainText("region: EU");
  await clickChart(page, "Revenue vs target by region", 0.2, 0.75);
  await revenue(page, "$2,260.50");
  await expect(chips).toBeEmpty();

  // Donut: slices start at 12 o'clock and run clockwise, so Online (the first, 45 %) is at 3 o'clock.
  await clickChart(page, "Revenue by channel", 0.62, 0.5);
  await revenue(page, "$1,020.00");
  await expect(chips).toContainText("channel: Online");
  await clickChart(page, "Revenue by channel", 0.62, 0.5);
  await revenue(page, "$2,260.50");
  await expect(chips).toBeEmpty();

  // Heatmap: the lower-left cell is EU (first x) × Online (first y); EU + Online = 100 + 120 + 140.
  await clickChart(page, "Region × channel", 0.3, 0.6);
  await revenue(page, "$360.00");
  await expect(chips).toContainText("region: EU");
  await expect(chips).toContainText("channel: Online");
  await clickChart(page, "Region × channel", 0.3, 0.6);
  await revenue(page, "$2,260.50");
  await expect(chips).toBeEmpty();
  expect(errors).toEqual([]);
});

test("the charts follow the light/dark toggle", async ({ page }) => {
  await open(page);
  const chart = tile(page, "Revenue vs target by region");
  await expect(chart).not.toHaveAttribute("aria-busy", "true");
  const image = () => chart.locator("canvas").first().evaluate(c => c.toDataURL());
  const dark = page.getByRole("checkbox", { name: "Dark theme" });
  await dark.uncheck();
  await expect.poll(() => painted(chart)).toBe(true);
  await expect(chart).not.toHaveAttribute("aria-busy", "true");
  const light = await image();
  await dark.check();
  await expect.poll(image).not.toBe(light);
  await dark.uncheck();
  await expect.poll(image).toBe(light);
});

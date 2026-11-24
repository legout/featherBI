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
// A real mouse click on a chart, at the pixel the chart library reports for a data point (or at the middle of the donut ring).
async function clickChart(page, title, point, dx = 0) {
  const chart = tile(page, title);
  await expect(chart).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => painted(chart)).toBe(true);
  await chart.scrollIntoViewIfNeeded(); // the mouse clicks at viewport coordinates
  const at = await chart.getByRole("img").evaluate(async (node, point) => {
    const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
    const echarts = await import(charts.url); // the page's own, already loaded copy
    const box = node.getBoundingClientRect();
    const [x, y] = point ? echarts.getInstanceByDom(node).convertToPixel({ seriesIndex: 0 }, point) : [box.width / 2 + 0.27 * Math.min(box.width, box.height), box.height / 2];
    return { x: box.x + x, y: box.y + y };
  }, point);
  await page.mouse.click(at.x + dx, at.y);
}

test("all 17 presets render, the bar tile shows revenue and target per region, KPI and text tiles are filled", async ({ page }) => {
  const errors = await open(page);
  const tiles = await page.evaluate(() => JSON.parse(document.getElementById("dashboard").textContent).tiles.filter(t => t.type === "echarts"));
  expect(tiles.map(t => t.preset).sort()).toEqual([...PRESETS].sort());
  for (const t of tiles) await expect.poll(() => painted(tile(page, t.title)), `preset ${t.preset}`).toBe(true);

  // README: EU 850.00 and US 1,410.50 revenue; targets EU 800 and US 1500. The chart describes its data for screen readers.
  const bars = tile(page, "Revenue vs target by region").getByRole("img");
  await expect(bars).toHaveAttribute("aria-label", /representing revenue\..*for EU is 0, 850,.*for US is 1, 1410\.5\..*representing target\..*for EU is 0, 800,.*for US is 1, 1500\./s);

  // A tile `option` restyles (here: names the series) and cannot replace the data: EU 850.00, US 1,410.50.
  const share = tile(page, "Revenue share by region").getByRole("img");
  await expect(share).toHaveAttribute("aria-label", /named Share\b.*for EU is 850,.*for US is 1410\.5\./s);
  await expect(share).not.toHaveAttribute("aria-label", /Injected/);

  // KPI: total 2,260.50 against targets 800 + 1500 = 2300, so (2260.5 - 2300) / 2300 = -1.7 %; three months of spark.
  await revenue(page, "$2,260.50");
  await expect(tile(page, "Revenue")).toContainText("-1.7%");
  await expect(tile(page, "Revenue").locator("svg")).toBeVisible();
  await expect(tile(page, "Orders").getByText("12", { exact: true })).toBeVisible();

  const about = tile(page, "About");
  await expect(about.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(about).toContainText("Revenue is net of returns, in US dollars.");
  await expect(about.getByRole("listitem")).toHaveCount(2);
  await expect(about.getByRole("link", { name: "the fixture README" })).toHaveAttribute("href", "https://github.com/legout/featherBI");
  expect(errors).toEqual([]);
});

test("a click on a bar, a donut slice or a heatmap cell sets the filter, and the same click again clears it", async ({ page }) => {
  const errors = await open(page);
  const chips = page.getByLabel("Active filters");
  await revenue(page, "$2,260.50");

  // Bar: EU has a revenue bar (850) and a target bar (800) side by side; 20 px left of the pair's middle, at 400, is the revenue bar.
  await clickChart(page, "Revenue vs target by region", ["EU", 400], -20);
  await revenue(page, "$850.00");
  await expect(chips).toContainText("region: EU");
  await clickChart(page, "Revenue vs target by region", ["EU", 400], -20);
  await revenue(page, "$2,260.50");
  await expect(chips).toBeEmpty();

  // Donut: slices start at 12 o'clock and run clockwise, so Online (the first, 45 %) covers 3 o'clock.
  await clickChart(page, "Revenue by channel");
  await revenue(page, "$1,020.00");
  await expect(chips).toContainText("channel: Online");
  await clickChart(page, "Revenue by channel");
  await revenue(page, "$2,260.50");
  await expect(chips).toBeEmpty();

  // Heatmap: the EU × Online cell; EU + Online = 100 + 120 + 140.
  await clickChart(page, "Region × channel", ["EU", "Online"]);
  await revenue(page, "$360.00");
  await expect(chips).toContainText("region: EU");
  await expect(chips).toContainText("channel: Online");
  await clickChart(page, "Region × channel", ["EU", "Online"]);
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

// Presets journey: every preset on the hand data, opened over file://. Expected values are hand-computed in fixtures/hand/README.md.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
// Spec 0001 §Tile types: the 17 presets of v1; spec 0004 §Four new presets.
const PRESETS = ["pareto", "histogram", "candlestick", "timeline", "line", "area", "bar", "stacked-bar", "hbar", "pie", "donut", "scatter", "heatmap", "treemap", "sunburst", "funnel", "gauge", "sankey", "waterfall", "boxplot", "calendar"];

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

test("all 21 presets render, the bar tile shows revenue and target per region, KPI and text tiles are filled", async ({ page }) => {
  const errors = await open(page);
  const tiles = await page.evaluate(() => JSON.parse(document.getElementById("dashboard").textContent).tiles.filter(t => t.type === "echarts"));
  expect([...new Set(tiles.map(t => t.preset))].sort()).toEqual([...PRESETS].sort());
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

// The canvas colour [r, g, b, a] at a data point of a chart, with the pixel it was read at.
async function at(page, title, point, seriesIndex = 0) {
  const chart = tile(page, title);
  await expect(chart).not.toHaveAttribute("aria-busy", "true");
  return chart.getByRole("img").evaluate(
    async (node, { point, seriesIndex }) => {
      const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
      const echarts = await import(charts.url);
      const [x, y] = echarts.getInstanceByDom(node).convertToPixel({ seriesIndex }, point);
      const canvas = node.querySelector("canvas");
      const scale = canvas.width / canvas.clientWidth;
      return { x, y, rgba: [...canvas.getContext("2d", { willReadFrequently: true }).getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data] };
    },
    { point, seriesIndex },
  );
}
const colour = (...args) => at(...args).then(p => p.rgba.join());

test("pareto sorts the bars descending and its cumulative line ends at 100 %", async ({ page }) => {
  const errors = await open(page);
  const title = "Revenue Pareto";
  // README: US Retail 750.50, US Online 660, EU Retail 490, EU Online 360; the SQL returns them by name.
  const order = ["US Retail", "US Online", "EU Retail", "EU Online"];
  const xs = [];
  for (const name of order) xs.push((await at(page, title, [name, 0])).x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  expect(new Set(xs).size).toBe(4);
  // The line (series 1, right axis 0..100) passes through the hand-computed cumulative shares and ends at 100.
  const line = name => colour(page, title, [name, { "US Retail": 33.2, "US Online": 62.4, "EU Retail": 84.07, "EU Online": 100 }[name]], 1);
  // The line is drawn from left to right, so its last point matches its first one only when it is complete.
  await expect.poll(async () => (await line("EU Online")) === (await line("US Retail"))).toBe(true);
  const stroke = await line("US Retail");
  expect(stroke).not.toBe(await colour(page, title, ["US Retail", 100])); // the bar under it
  for (const name of order) expect(await line(name), name).toBe(stroke);
  expect(errors).toEqual([]);
});

test("histogram bars share their edges on a value axis and are as high as their count", async ({ page }) => {
  const errors = await open(page);
  const title = "Order value distribution";
  // README: bins 100..150 (3), 150..200 (3), 200..250 (4), 250..300 (2).
  await expect.poll(() => painted(tile(page, title))).toBe(true);
  await expect.poll(async () => (await at(page, title, [225, 3.7])).rgba[3], "the 200..250 bar reaches 4").toBe(255);
  const fill = await colour(page, title, [125, 0.5]);
  // The shared edge itself and both sides of it are bar, with no gap between.
  for (const edge of [150, 200, 250]) for (const x of [edge - 2, edge, edge + 2]) expect(await colour(page, title, [x, 0.5]), `at ${x}`).toBe(fill);
  expect(await colour(page, title, [225, 3.7])).toBe(fill);
  expect(await colour(page, title, [125, 3.3]), "above the 100..150 bar").not.toBe(fill);
  expect(await colour(page, title, [275, 2.3]), "above the 250..300 bar").not.toBe(fill);
  expect(await colour(page, title, [275, 1.7])).toBe(fill);

  // By channel (README): only 200..250 holds both, Online 3 and Retail 1. Both counts show, though Online is drawn last.
  const split = "Order value distribution by channel";
  await expect.poll(async () => (await at(page, split, [225, 2.7])).rgba[3], "the Online 200..250 bar reaches 3").toBe(255);
  const [online, retail] = [await colour(page, split, [125, 0.5]), await colour(page, split, [175, 0.5])];
  expect(online).not.toBe(retail);
  expect(await colour(page, split, [225, 0.5]), "Retail, 1 high").toBe(retail);
  expect(await colour(page, split, [225, 2]), "Online, 3 high").toBe(online);
  expect([online, retail]).not.toContain(await colour(page, split, [225, 3.3]));
  expect(errors).toEqual([]);
});

test("candlestick draws a rising row in the theme's success colour, with the volume below", async ({ page }) => {
  const errors = await open(page);
  const title = "Price by day";
  // The theme's own success and error colours, resolved to RGB by the browser.
  const theme = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d");
    return Object.fromEntries(
      ["success", "error"].map(name => {
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`);
        context.fillRect(0, 0, 1, 1);
        return [name, [...context.getImageData(0, 0, 1, 1).data]];
      }),
    );
  });
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // README: 2025-01-05 rises from 100 to 110, 2025-01-15 falls from 110 to 102. `x` is a SQL DATE.
  const body = point => at(page, title, point).then(p => p.rgba);
  await expect.poll(async () => (await body(["2025-01-05", 105]))[3]).toBe(255);
  const [rising, falling] = [await body(["2025-01-05", 105]), await body(["2025-01-15", 106])];
  expect(distance(rising, theme.success)).toBeLessThan(distance(rising, theme.error));
  expect(distance(falling, theme.error)).toBeLessThan(distance(falling, theme.success));
  // Volume 1500 on 2025-01-15: a bar (series 1) below the candle's low of 98.
  await expect.poll(async () => (await at(page, title, ["2025-01-15", 750], 1)).rgba[3]).toBe(255);
  expect((await at(page, title, ["2025-01-15", 750], 1)).y).toBeGreaterThan((await at(page, title, ["2025-01-15", 98])).y);
  // A click on the 2025-01-15 candle sets `day`; that day has one order of 150.00. The same click again clears it.
  await clickChart(page, title, ["2025-01-15", 106]);
  await revenue(page, "$150.00");
  await expect(page.getByLabel("Active filters")).toContainText("day: 2025-01-15");
  await clickChart(page, title, ["2025-01-15", 106]);
  await revenue(page, "$2,260.50");
  await expect(page.getByLabel("Active filters")).toBeEmpty();
  expect(errors).toEqual([]);
});

test("timeline draws one bar per row from its start to its end", async ({ page }) => {
  const errors = await open(page);
  const title = "Machine states";
  const hour = h => Date.UTC(2025, 0, 6, 0, h * 60);
  // Series are the states in row order: 0 = run, 1 = down. Both share the axes, so either finds a pixel.
  const bar = (name, h) => colour(page, title, [hour(h), name]);
  await expect.poll(async () => (await at(page, title, [hour(10), "M1"])).rgba[3]).toBe(255);
  const run = await bar("M1", 10); // M1 08:00..12:00 run
  expect(await bar("M1", 8.2)).toBe(run);
  expect(await bar("M1", 11.8)).toBe(run);
  const down = await bar("M1", 12.5); // M1 12:00..13:00 down
  expect(down).not.toBe(run);
  expect(await bar("M1", 12.2)).toBe(down);
  expect(await bar("M1", 12.8)).toBe(down);
  expect(await bar("M1", 13.5), "M1 has no row from 13:00 to 14:00").not.toBe(run);
  expect(await bar("M1", 13.5)).not.toBe(down);
  expect(await bar("M1", 15)).toBe(run); // M1 14:00..16:00 run
  expect(await bar("M2", 9.2)).toBe(run); // M2 09:00..15:00 run
  expect(await bar("M2", 14.8)).toBe(run);
  expect(await bar("M2", 8.5), "M2 starts at 09:00").not.toBe(run);
  expect(await bar("M2", 15.5), "M2 ends at 15:00").not.toBe(run);
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

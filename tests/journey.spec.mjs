// Journey harness: build a fixture with the real CLI, open the output over file://, assert what the page shows.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));

function build(config) {
  execFileSync("node", ["skill/featherbi/scripts/featherbi.mjs", "build", config], { cwd: root, stdio: "pipe" });
}

async function open(page, html) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(pathToFileURL(root + html).href);
  return errors;
}

const tile = (page, title) => page.getByRole("group", { name: title, exact: true });
// True once any canvas of the tile holds a painted pixel.
const painted = chart =>
  chart.evaluate(node =>
    [...node.querySelectorAll("canvas")].some(c => {
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    }),
  );
// A real mouse click on the chart at the pixel the chart library reports for a data point.
async function chartPoint(page, title, point, dx = 0) {
  const chart = tile(page, title);
  await expect(chart).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => painted(chart)).toBe(true);
  await chart.scrollIntoViewIfNeeded();
  const at = await chart.getByRole("img").evaluate(async (node, point) => {
    const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
    const echarts = await import(charts.url);
    const box = node.getBoundingClientRect();
    const [x, y] = echarts.getInstanceByDom(node).convertToPixel({ seriesIndex: 0 }, point);
    return { x: box.x + x, y: box.y + y };
  }, point);
  return { x: at.x + dx, y: at.y };
}
async function clickChart(page, title, point, dx = 0) {
  const at = await chartPoint(page, title, point, dx);
  await page.mouse.click(at.x, at.y);
}

// Expected values are the hand-computed ones in fixtures/hand/README.md.
for (const [engine, config, html] of [
  ["Haybarn-Wasm", "fixtures/hand/dashboard.yaml", "fixtures/hand/dist/hand.html"],
  ["upstream duckdb-wasm", "fixtures/hand/upstream.yaml", "fixtures/hand/dist/hand-upstream.html"],
]) {
  test(`hand dashboard shows the hand total as Revenue (${engine})`, async ({ page }) => {
    build(config);
    const errors = await open(page, html);
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$2,260.50", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("the theme toggle switches between light and dark", async ({ page }) => {
  build("fixtures/hand/dashboard.yaml");
  await open(page, "fixtures/hand/dist/hand.html");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.getByRole("checkbox", { name: "Dark theme" }).check();
  await expect.poll(background).not.toBe(light);
  await page.getByRole("checkbox", { name: "Dark theme" }).uncheck();
  await expect.poll(background).toBe(light);
});

test("selects narrow the KPI, chips appear and clear, Reset restores totals and the default range", async ({ page }) => {
  build("fixtures/hand/dashboard.yaml");
  const errors = await open(page, "fixtures/hand/dist/hand.html");
  const revenue = amount => expect(page.getByRole("group", { name: "Revenue" }).getByText(amount, { exact: true })).toBeVisible();
  const chips = page.getByLabel("Active filters");
  await revenue("$2,260.50");
  // Default range: 12 months ending at the latest date (2025-03-25).
  await expect(page.getByLabel("From")).toHaveValue("2024-04-01");
  await expect(page.getByLabel("To")).toHaveValue("2025-03-25");

  await page.getByLabel("region").selectOption("EU");
  await revenue("$850.00");
  await expect(chips).toContainText("region: EU");
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("Online");
  await revenue("$360.00"); // EU + Online: 100 + 120 + 140
  await page.getByRole("button", { name: "Clear region" }).click();
  await revenue("$1,020.00");
  await expect(chips).not.toContainText("region: EU");

  await page.getByLabel("From").fill("2025-03-01");
  await revenue("$380.00"); // Online since March: 140 + 240
  await page.getByRole("button", { name: "Reset" }).click();
  await revenue("$2,260.50");
  await expect(page.getByLabel("From")).toHaveValue("2024-04-01");
  await expect(chips).toBeEmpty();
  expect(errors).toEqual([]);
});

test("latest state wins: EU then US before the first result paints only US; the hash mirrors the filters; a bad hash is ignored", async ({ page, context }) => {
  build("fixtures/hand/dashboard.yaml");
  const url = pathToFileURL(root + "fixtures/hand/dist/hand.html").href;
  // Raise the engine's latency after load: every message to the query worker is delayed (order is kept).
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (window.__lag) setTimeout(() => post.apply(this, args), window.__lag);
      else post.apply(this, args);
    };
  });
  const errors = await open(page, "fixtures/hand/dist/hand.html");
  const kpi = page.getByRole("group", { name: "Revenue" }).locator(".stat-value");
  await expect(kpi).toHaveText("$2,260.50");
  await kpi.evaluate(node => {
    window.__painted = [];
    new MutationObserver(() => window.__painted.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(() => (window.__lag = 1500));
  await page.getByRole("combobox", { name: /^region/ }).selectOption("EU");
  await page.getByRole("combobox", { name: /^region/ }).selectOption("US");
  await expect(kpi).toHaveText("$1,410.50"); // hand total of US
  expect(await page.evaluate(() => window.__painted)).not.toContain("$850.00"); // EU's hand total is never painted
  await page.evaluate(() => (window.__lag = 0));

  await page.getByRole("combobox", { name: /^region/ }).selectOption("EU");
  await expect(kpi).toHaveText("$850.00");
  expect(page.url()).toMatch(/#region=EU$/);
  const history = await page.evaluate(() => history.length);
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("Online");
  await expect(kpi).toHaveText("$360.00");
  expect(await page.evaluate(() => history.length)).toBe(history); // replaceState: no entry per click

  const fresh = await context.newPage();
  await fresh.goto(url + "#region=EU");
  await expect(fresh.getByRole("group", { name: "Revenue" }).getByText("$850.00", { exact: true })).toBeVisible();

  const bad = await context.newPage();
  const badErrors = [];
  bad.on("console", m => m.type() === "error" && badErrors.push(m.text()));
  bad.on("pageerror", e => badErrors.push(String(e)));
  await bad.goto(url + "#country=FR&region=Mars&channel=Retail&date=2025-03-01..2025-01-01");
  await expect(bad.getByRole("group", { name: "Revenue" }).getByText("$1,240.50", { exact: true })).toBeVisible(); // only channel=Retail applies
  await expect(bad.getByLabel("From")).toHaveValue("2024-04-01");
  expect(badErrors).toEqual([]);

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(kpi).toHaveText("$2,260.50");
  expect(page.url()).not.toContain("#");
  expect(errors).toEqual([]);
});

// Spec 0001 acceptance 1 and 3, in full, on fixtures/hand/acceptance.yaml. Every value is from fixtures/hand/README.md.
test("acceptance 1 and 3: every tile renders; EU click, channel Online and Reset give the README values; Explore shows only EU rows", async ({ page }) => {
  build("fixtures/hand/acceptance.yaml");
  const errors = await open(page, "fixtures/hand/dist/hand-acceptance.html");
  const kpi = amount => expect(tile(page, "Revenue").getByText(amount, { exact: true })).toBeVisible();
  const bars = tile(page, "Revenue vs target by region").getByRole("img");
  const pivot = tile(page, "Region × month");
  const rows = page.getByRole("group", { name: "Sales rows" });
  const labelOf = (revenue, target) => new RegExp(`representing revenue\\..*${revenue}.*representing target\\..*${target}`, "s");

  // Before any filter: every tile renders, the bar shows each region's revenue and target, the KPI is the hand total.
  await kpi("$2,260.50");
  for (const title of ["Revenue vs target by region", "Revenue by channel"]) await expect.poll(() => painted(tile(page, title))).toBe(true);
  await expect(bars).toHaveAttribute("aria-label", labelOf("for EU is 0, 850,.*for US is 1, 1410\\.5\\.", "for EU is 0, 800,.*for US is 1, 1500\\."));
  await expect(pivot.getByRole("row", { name: /^US/ })).toHaveCount(1);
  await expect(rows).toContainText("12 rows (filtered)");
  await expect(tile(page, "Note").locator("strong")).toHaveText("rows");

  // Click EU in the bar tile (the revenue bar is 20 px left of the pair's middle).
  await clickChart(page, "Revenue vs target by region", ["EU", 400], -20);
  await kpi("$850.00");
  await expect(pivot.getByRole("row", { name: /^EU/ }).getByRole("cell").nth(1)).toHaveText("$300.00"); // EU × 2025-02
  await expect(pivot.getByRole("row", { name: /^US/ })).toHaveCount(0);
  await expect(rows).toContainText("6 rows (filtered)");
  await expect(bars).toHaveAttribute("aria-label", labelOf("for EU is 0, 850", "for EU is 0, 800")); // the target bar stays

  // Channel Online: revenue narrows (EU Online 360, US Online 660), the targets do not.
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("Online");
  await kpi("$360.00");
  await expect(bars).toHaveAttribute("aria-label", labelOf("for EU is 0, 360,.*for US is 1, 660\\.", "for EU is 0, 800,.*for US is 1, 1500\\."));

  // Explore with region = EU: six rows (README).
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("");
  await kpi("$850.00");
  await page.getByRole("button", { name: "Explore" }).click();
  const viewer = page.locator("perspective-viewer");
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.evaluate(async el => (await el.getView()).num_rows())).toBe(6);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Reset" }).click();
  await kpi("$2,260.50");
  await expect(bars).toHaveAttribute("aria-label", labelOf("for EU is 0, 850,.*for US is 1, 1410\\.5\\.", "for EU is 0, 800,.*for US is 1, 1500\\."));
  await expect(pivot.getByRole("row", { name: /^US/ })).toHaveCount(1);
  await expect(rows).toContainText("12 rows (filtered)");
  expect(errors).toEqual([]);
});

// Spec 0005 acceptance 2 on fixtures/hand/acceptance.yaml. Values: fixtures/hand/README.md (cell numbers are raw until plan 0005 C2).
test("SQL table: region totals in SQL order, channel Online narrows them, a click on the EU row filters region and a second click clears it", async ({ page }) => {
  build("fixtures/hand/acceptance.yaml");
  const errors = await open(page, "fixtures/hand/dist/hand-acceptance.html");
  const table = page.getByRole("group", { name: "Revenue by region (SQL)" }); // the title also carries the row count
  const kpi = amount => expect(tile(page, "Revenue").getByText(amount, { exact: true })).toBeVisible();
  const cells = n => table.locator(`[role="row"][aria-rowindex="${n + 1}"]`).getByRole("gridcell");
  const shows = async (...rows) => {
    await expect(table.getByRole("heading")).toHaveText(`Revenue by region (SQL) · ${rows.length} rows`);
    for (const [i, row] of rows.entries()) await expect(cells(i + 1)).toHaveText(row);
  };

  await expect(table.getByRole("columnheader")).toHaveText(["region", "revenue"]); // the result's columns, in SQL order
  await shows(["EU", "850"], ["US", "1410.5"]);
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("Online");
  await shows(["EU", "360"], ["US", "660"]);
  await page.getByRole("combobox", { name: /^channel/ }).selectOption("");
  await shows(["EU", "850"], ["US", "1410.5"]);

  await cells(1).first().click();
  await kpi("$850.00");
  await expect(page.getByLabel("Active filters")).toContainText("region: EU");
  await shows(["EU", "850"]);
  await cells(1).first().click(); // the same value again clears it
  await kpi("$2,260.50");
  await shows(["EU", "850"], ["US", "1410.5"]);
  expect(errors).toEqual([]);
});

// A config generated in the test, built next to a copy of the hand fixture's sales rows; `check` gets the opened page.
async function generated(page, config, check) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "journey-sql-table-"));
  try {
    fs.copyFileSync(root + "fixtures/hand/sales.parquet", path.join(tmp, "sales.parquet"));
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify({ name: "generated", sources: { sales: { read: "read_parquet('sales.parquet')" } }, ...config }));
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
const firstRow = table => table.locator('[role="row"][aria-rowindex="2"]').getByRole("gridcell");

// Spec 0005 acceptance 3: `n` descends so the kept rows show the SQL's own order.
for (const [size, title, first] of [
  [1001, "Numbers · first 1 000 rows", "1000"],
  [1000, "Numbers · 1000 rows", "999"],
]) {
  test(`SQL table row cap: a ${size}-row result shows 1 000 rows ${size > 1000 ? "and the note" : "without a note"}`, async ({ page }) => {
    const tiles = [{ type: "table", title: "Numbers", sql: `SELECT range AS n FROM range(${size}) ORDER BY 1 DESC` }];
    await generated(page, { title: "Cap", tiles }, async () => {
      const table = page.getByRole("group", { name: "Numbers" });
      await expect(table.getByRole("heading")).toHaveText(title);
      await expect(table.locator("[aria-rowcount]")).toHaveAttribute("aria-rowcount", "1001"); // the header row and 1 000 rows
      await expect(firstRow(table)).toHaveText([first]);
    });
  });
}

// Spec 0005 §1 on column types no hand fixture config combines with a SQL table: a DATE first column and BIGINT identifiers.
test("SQL table: a click on a DATE row sets the day it shows; BIGINT identifiers above 2^53 stay exact", async ({ page }) => {
  const config = {
    title: "Types",
    dims: { day: { col: "order_date" } },
    tiles: [
      { type: "kpi", title: "Revenue", format: "currency", sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}" },
      { type: "table", title: "Days", click: "day", exclude: ["day"], sql: "SELECT order_date, SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1" },
      // Two neighbours above 2^53: a double holds only the first.
      { type: "table", title: "Orders", sql: "SELECT * FROM (VALUES (9007199254740992::BIGINT), (9007199254740993::BIGINT)) t(order_id) ORDER BY 1" },
    ],
  };
  await generated(page, config, async () => {
    const kpi = amount => expect(tile(page, "Revenue").getByText(amount, { exact: true })).toBeVisible();
    const days = page.getByRole("group", { name: "Days" });
    const second = days.locator('[role="row"][aria-rowindex="3"]').getByRole("gridcell");
    await kpi("$2,260.50");
    await expect(second).toHaveText(["2025-01-15", "150"]); // README: the one order of that day
    await second.first().click();
    await kpi("$150.00");
    expect(page.url()).toMatch(/#day=2025-01-15$/);
    await expect(page.getByRole("combobox", { name: /^day/ })).toHaveValue("2025-01-15");
    const fresh = await page.context().newPage(); // the hash round trip
    await fresh.goto(page.url());
    await expect(tile(fresh, "Revenue").getByText("$150.00", { exact: true })).toBeVisible();
    await second.first().click(); // the same day again clears it
    await kpi("$2,260.50");

    const orders = page.getByRole("group", { name: "Orders" }).getByRole("gridcell");
    await expect(orders).toHaveText(["9007199254740992", "9007199254740993"]);
  });
});

// Spec 0001 acceptance 8a on every tile: EU then US while the engine lags; no tile ever paints an EU-only value, all end on US.
test("latest state wins on every tile: EU then US before the first result paints only US values in all tiles", async ({ page }) => {
  build("fixtures/hand/acceptance.yaml");
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (window.__lag) setTimeout(() => post.apply(this, args), window.__lag);
      else post.apply(this, args);
    };
  });
  const errors = await open(page, "fixtures/hand/dist/hand-acceptance.html");
  const titles = ["Revenue", "Revenue vs target by region", "Revenue by channel", "Region × month", "Sales rows", "Note"];
  await expect(tile(page, "Revenue").locator(".stat-value")).toHaveText("$2,260.50");
  for (const title of titles.slice(1, 5)) await expect(page.getByRole("group", { name: title })).not.toHaveAttribute("aria-busy", "true");
  // Every mutation inside a tile (text, or the chart's aria-label) records what the tile shows then.
  await page.evaluate(titles => {
    window.__seen = {};
    const text = n => n.innerText + " " + [...n.querySelectorAll("[aria-label]")].map(e => e.getAttribute("aria-label")).join(" ");
    for (const title of titles) {
      const node = [...document.querySelectorAll('[role="group"]')].find(g => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")).textContent.trim().startsWith(title));
      window.__seen[title] = [];
      new MutationObserver(() => window.__seen[title].push(text(node))).observe(node, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  }, titles);
  const euBar = await chartPoint(page, "Revenue vs target by region", ["EU", 400], -20);
  const usBar = await chartPoint(page, "Revenue vs target by region", ["US", 400], -20);
  await page.evaluate(() => {
    window.__lag = 1500;
    for (const title in window.__seen) window.__seen[title].length = 0; // only what paints after the clicks counts
  });
  // Click the EU bar, then the US bar (revenue bar is 20 px left of the pair's middle), without waiting for any result.
  await page.mouse.click(euBar.x, euBar.y);
  await page.mouse.click(usBar.x, usBar.y);
  const kpi = tile(page, "Revenue").locator(".stat-value");
  await expect(kpi).toHaveText("$1,410.50"); // README: US total
  const pivot = tile(page, "Region × month");
  await expect(pivot.getByRole("row", { name: /^US/ }).getByRole("cell").nth(1)).toHaveText("$490.00"); // US × 2025-02
  await expect(pivot.getByRole("row", { name: /^EU/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Sales rows" })).toContainText("6 rows (filtered)");
  // By content: the first US row of the README (2025-01-05, US), not just six rows.
  const firstRow = page.getByRole("group", { name: "Sales rows" }).locator('[role="row"][aria-rowindex="2"]').getByRole("gridcell");
  await expect(firstRow.nth(0)).toHaveText("2025-01-05");
  await expect(firstRow.nth(1)).toHaveText("US");
  await expect(tile(page, "Revenue by channel").getByRole("img")).toHaveAttribute("aria-label", /for Online is 0, 660,.*for Retail is 1, 750\.5\./s);
  await expect(tile(page, "Revenue vs target by region").getByRole("img")).toHaveAttribute("aria-label", /for EU is 0, 850,.*for US is 1, 1410\.5\./s); // region is excluded from its own bar
  const seen = await page.evaluate(() => window.__seen);
  const eu = {
    Revenue: /\$850\.00/,
    "Revenue by channel": /\b(360|490)\b/, // README: EU Online, EU Retail
    "Region × month": /\$300\.00/, // README: EU × 2025-02 and 2025-03; no US cell is 300
  };
  for (const [title, pattern] of Object.entries(eu)) for (const shown of seen[title]) expect(shown, title).not.toMatch(pattern);
  // The table keeps showing the unfiltered grid (EU and US) until US arrives; an EU result would show EU cells without US ones.
  for (const shown of seen["Sales rows"]) expect(/\bEU\b/.test(shown) && !/\bUS\b/.test(shown), shown).toBe(false);
  await page.evaluate(() => (window.__lag = 0));

  // Hash: selecting EU sets #region=EU; a fresh tab on that URL shows the README EU values on every value-bearing tile.
  await page.getByRole("combobox", { name: /^region/ }).selectOption("EU");
  await expect(kpi).toHaveText("$850.00");
  expect(page.url()).toMatch(/#region=EU$/);
  const fresh = await page.context().newPage();
  await fresh.goto(page.url());
  await expect(tile(fresh, "Revenue").getByText("$850.00", { exact: true })).toBeVisible();
  await expect(tile(fresh, "Revenue vs target by region").getByRole("img")).toHaveAttribute("aria-label", /representing revenue\..*for EU is 0, 850.*representing target\..*for EU is 0, 800/s);
  await expect(tile(fresh, "Region × month").getByRole("row", { name: /^EU/ }).getByRole("cell").nth(1)).toHaveText("$300.00");
  await expect(fresh.getByRole("group", { name: "Sales rows" })).toContainText("6 rows (filtered)");
  const freshRow = fresh.getByRole("group", { name: "Sales rows" }).locator('[role="row"][aria-rowindex="2"]').getByRole("gridcell");
  await expect(freshRow.nth(0)).toHaveText("2025-01-05");
  await expect(freshRow.nth(1)).toHaveText("EU");
  expect(errors).toEqual([]);
});

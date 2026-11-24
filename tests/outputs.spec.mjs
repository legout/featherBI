// Output-mode journeys (spec 0001 §Outputs): an --offline file over file:// with the network blocked, and a --split
// folder served by python3 -m http.server. Expected values are hand-computed in fixtures/hand/README.md.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");

function build(args, cwd = root) {
  return execFileSync(process.execPath, [cli, "build", ...args], { cwd, encoding: "utf8", stdio: "pipe" });
}

async function open(page, url) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  return errors;
}

const tile = (page, title) => page.getByRole("group", { name: title });
// True once any canvas of the tile holds a painted pixel.
const painted = chart =>
  chart.evaluate(node =>
    [...node.querySelectorAll("canvas")].some(c => {
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    }),
  );
// What the hand dashboard shows: the KPI, the pivot table and the table tile's count.
async function shown(page) {
  await expect(tile(page, "Revenue").getByText("$2,260.50", { exact: true })).toBeVisible();
  const pivot = tile(page, "Region × month");
  await expect(pivot).not.toHaveAttribute("aria-busy", "true");
  await expect(tile(page, "Sales rows")).not.toHaveAttribute("aria-busy", "true");
  return {
    kpi: await tile(page, "Revenue").locator(".stat-value").textContent(),
    pivot: await pivot.locator("table").innerText(),
    rows: await tile(page, "Sales rows").locator("h2").textContent(),
  };
}

// Every tile type on the hand data, so the offline file has to run the engine, ECharts, AG Grid and Perspective.
const ALL_TILES = `
title: Offline hand
name: offline-hand
sources:
  sales:
    read: "read_parquet('sales.parquet')"
dims:
  region: {col: region}
  channel: {col: channel}
date: {col: order_date, default: last_12_months}
tiles:
  - type: kpi
    title: Revenue
    format: currency
    sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}"
  - type: echarts
    preset: bar
    title: Revenue by region
    click: region
    sql: "SELECT region AS x, SUM(revenue) AS y FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1"
  - type: pivot
    title: Region × month
    format: currency
    click: region
    sql: >-
      SELECT COALESCE(region, 'Total') AS r,
      COALESCE(strftime(order_date, '%Y-%m'), 'Total') AS c,
      SUM(revenue) AS v,
      GROUPING(region) = 1 AS r_total,
      GROUPING(strftime(order_date, '%Y-%m')) = 1 AS c_total
      FROM sales WHERE {{filters:sales}}
      GROUP BY GROUPING SETS (
        (region, strftime(order_date, '%Y-%m')),
        (region),
        (strftime(order_date, '%Y-%m')),
        ()
      )
      ORDER BY r_total, r, c_total, c
  - type: table
    title: Sales rows
    source: sales
    columns: [order_date, region, channel, revenue]
  - type: text
    title: Note
    markdown: "Twelve **rows** of sales."
`;

test("--offline: every tile renders and Explore opens over file:// with every non-file: request blocked", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outputs-offline-"));
  try {
    fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(dir, "sales.parquet"));
    fs.writeFileSync(path.join(dir, "dashboard.yaml"), ALL_TILES);
    const html = path.join(dir, "offline.html");
    expect(build(["dashboard.yaml", "--offline", "--out", html], dir).stdout).toMatch(/\(\d+(\.\d+)? MB\)/); // the size is reported

    const network = [];
    // Every request that leaves the file is blocked and recorded.
    await page.route(
      request => !request.url().startsWith("file:"),
      route => {
        network.push(route.request().url());
        return route.abort();
      },
    );
    const errors = await open(page, pathToFileURL(html).href);

    await expect(tile(page, "Revenue").getByText("$2,260.50", { exact: true })).toBeVisible();
    const chart = tile(page, "Revenue by region");
    await expect(chart).not.toHaveAttribute("aria-busy", "true");
    await expect.poll(() => painted(chart)).toBe(true);
    const pivot = tile(page, "Region × month");
    await expect(pivot.getByRole("row", { name: /^EU/ }).getByRole("cell").nth(1)).toHaveText("$300.00");
    const table = tile(page, "Sales rows");
    await expect(table).toContainText("12 rows (filtered)");
    await expect(table.locator('[role="row"][aria-rowindex="2"]').getByRole("gridcell").first()).toHaveText("2025-01-05");
    await expect(tile(page, "Note").locator("strong")).toHaveText("rows");

    // Filters still run in the inlined engine; Explore then opens on the EU rows (six in the README).
    await pivot.getByRole("button", { name: "EU", exact: true }).click();
    await expect(tile(page, "Revenue").getByText("$850.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Explore" }).click();
    const viewer = page.locator("perspective-viewer");
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.evaluate(async el => (await el.getView()).num_rows())).toBe(6);

    expect(network).toEqual([]); // nothing outside the file was even requested
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--split served by http.server shows the same KPI and pivot values as the default build", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outputs-split-"));
  let server;
  try {
    build(["fixtures/hand/pivot-table.yaml"]); // the default build: fixtures/hand/dist/hand-pivot-table.html
    const folder = path.join(dir, "hand-pivot-table");
    build(["fixtures/hand/pivot-table.yaml", "--split", "--out", folder]);
    expect(fs.readdirSync(folder).sort()).toEqual(["index.html", "sales.parquet"]); // one Parquet per snapshot table

    // The default build over file:// is the reference.
    const referenceErrors = await open(page, pathToFileURL(path.join(root, "fixtures/hand/dist/hand-pivot-table.html")).href);
    const reference = await shown(page);
    expect(reference.kpi).toBe("$2,260.50");
    expect(reference.pivot).toContain("$300.00"); // EU × 2025-02
    expect(reference.rows).toBe("Sales rows · 12 rows (filtered)");
    expect(referenceErrors).toEqual([]);

    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", folder], { stdio: "ignore" });
    const origin = `http://127.0.0.1:${port}`;
    await expect
      .poll(() => fetch(`${origin}/index.html`).then(r => r.ok, () => false), { timeout: 30_000 })
      .toBe(true);

    const requests = [];
    page.on("request", request => requests.push(request.url()));
    const errors = await open(page, `${origin}/index.html`);
    expect(await shown(page)).toEqual(reference);
    expect(requests).toContain(`${origin}/sales.parquet`); // the snapshot is fetched relative to the page
    expect(errors).toEqual([]);
  } finally {
    server?.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

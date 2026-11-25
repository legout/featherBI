// Remote snapshot in the browser (spec 0002 §Behavior in the browser): a --remote build against an in-test fake S3,
// opened over file://. Expected values are the hand-computed ones in fixtures/hand/README.md.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const EXPIRED = "This dashboard's data link has expired. Ask the author to rebuild it.";
// The header shows the viewer's local time: 14:04 UTC is 3:04 PM in Berlin (CET, UTC+1).
test.use({ locale: "en-US", timezoneId: "Europe/Berlin" });
const FUTURE = "2099-12-02T14:04:00.000Z";

// Fake S3: HEAD/PUT for the build, GET with CORS for its preflight (a range) and for the page (the whole object).
const objects = new Map();
const s3 = { status: {}, hold: null, gets: 0 }; // per test: a status per object path, a promise every data GET waits for
let server, dir, pivot, two;

// Not execFileSync: the fake S3 answers the build from this process.
async function build(config, name) {
  const out = path.join(dir, `${name}.html`);
  await promisify(execFile)("node", ["skill/featherbi/scripts/featherbi.mjs", "build", config, "--remote", "s3://bucket/prefix", "--out", out], {
    cwd: root,
    env: { ...process.env, AWS_ACCESS_KEY_ID: "test-access-82", AWS_SECRET_ACCESS_KEY: "test-secret-82", AWS_SESSION_TOKEN: "", AWS_ENDPOINT_URL: `http://127.0.0.1:${server.address().port}` },
  });
  return out;
}

// A copy of a built page with another expiry; -> { url, key(table) }.
function page_(built, expiresAt = FUTURE) {
  const html = readFileSync(built, "utf8");
  const { remote } = JSON.parse(html.match(/<script type="application\/json" id="dashboard">(.*?)<\/script>/s)[1]);
  const file = path.join(dir, `${path.basename(built, ".html")}-${Date.parse(expiresAt)}.html`);
  writeFileSync(file, html.replace(`"${remote.expiresAt}"`, `"${expiresAt}"`));
  return { url: pathToFileURL(file).href, key: table => new URL(remote.tables[table].url).pathname };
}

async function open(page, url) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  return errors;
}

const tile = (page, title) => page.getByRole("group", { name: title, exact: true });

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const key = new URL(req.url, "http://localhost").pathname;
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (req.method === "HEAD") res.writeHead(objects.has(key) ? 200 : 404).end();
    else if (req.method === "PUT") {
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200).end();
    } else if (req.headers.range) res.writeHead(206, cors).end(objects.get(key).subarray(0, 1));
    else {
      s3.gets++;
      await s3.hold;
      res.writeHead(s3.status[key] ?? 200, cors).end(s3.status[key] ? "" : objects.get(key));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  dir = mkdtempSync(path.join(os.tmpdir(), "remote-82-"));
  pivot = await build("fixtures/hand/pivot-table.yaml", "pivot");
  // Two tables, so one can fail while the other loads.
  const sales = path.join(root, "fixtures/hand/sales.parquet");
  const config = path.join(dir, "two.yaml");
  writeFileSync(config, `title: Two tables
name: two
sources:
  sales:
    read: "read_parquet('${sales}')"
  online:
    read: "(SELECT * FROM read_parquet('${sales}') WHERE channel = 'Online')"
explore: false
tiles:
  - { type: kpi, title: Revenue, format: currency, sql: "SELECT SUM(revenue) AS value FROM sales" }
  - { type: kpi, title: Online revenue, format: currency, sql: "SELECT SUM(revenue) AS value FROM online" }
`);
  two = await build(config, "two");
});
test.beforeEach(() => Object.assign(s3, { status: {}, hold: null, gets: 0 }));
test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test("a remote dashboard shows when its data expires, one progress bar while loading, then the hand values", async ({ page }) => {
  let release;
  s3.hold = new Promise(resolve => (release = resolve));
  const errors = await open(page, page_(two).url);
  await expect(page.getByRole("banner")).toContainText(/Data available until Dec 2, 2099, 3:04\sPM/);
  await expect(page.getByRole("progressbar")).toHaveCount(1); // one bar over both tables
  await expect(page.getByText(/^Loading data [\d.]+ \/ [\d.]+ MB$/)).toBeVisible();
  release();
  await expect(tile(page, "Revenue").getByText("$2,260.50", { exact: true })).toBeVisible();
  await expect(tile(page, "Online revenue").getByText("$1,020.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  // The hand fixture's pivot dashboard: the same answers as its embedded build.
  await page.goto(page_(pivot).url);
  await expect(tile(page, "Revenue").getByText("$2,260.50", { exact: true })).toBeVisible();
  await expect(tile(page, "Region × month").getByRole("row", { name: /^EU/ }).getByRole("cell").nth(1)).toHaveText("$300.00");
  await expect(page.getByRole("group", { name: /^Sales rows/ })).toContainText("12 rows (filtered)"); // the title carries the count
  expect(errors).toEqual([]);
});

test("past expiresAt: the expiry message, no download and no tile query; filters and layout stay", async ({ page }) => {
  const errors = await open(page, page_(pivot, "2020-01-01T00:00:00.000Z").url);
  await expect(page.getByRole("alert")).toHaveText(EXPIRED);
  const revenue = tile(page, "Revenue");
  await expect(revenue).not.toHaveAttribute("aria-busy", "true");
  await expect(revenue.locator(".stat-value")).toHaveText("–");
  await expect(tile(page, "Region × month")).not.toHaveAttribute("aria-busy", "true");
  await expect(tile(page, "Region × month").getByRole("row")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^region/ })).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText("Data available until");
  expect(s3.gets).toBe(0);
  expect(errors).toEqual([]);
});

test("a 403 on a table: the same expiry message and no tile query", async ({ page }) => {
  const p = page_(two);
  s3.status[p.key("online")] = 403;
  await open(page, p.url);
  await expect(page.getByRole("alert")).toHaveText(EXPIRED);
  for (const title of ["Revenue", "Online revenue"]) {
    await expect(tile(page, title)).not.toHaveAttribute("aria-busy", "true");
    await expect(tile(page, title).locator(".stat-value")).toHaveText("–"); // not even the table that did load is queried
  }
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("a 404 on one table: a message names the table and the status; a tile over the other table renders", async ({ page }) => {
  const p = page_(two);
  s3.status[p.key("online")] = 404;
  await open(page, p.url);
  await expect(tile(page, "Revenue").getByText("$2,260.50", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "online" }).filter({ hasText: "404" })).toHaveCount(1);
  await expect(tile(page, "Online revenue")).not.toHaveAttribute("aria-busy", "true");
  await expect(tile(page, "Online revenue").locator(".stat-value")).toHaveText("–");
  await expect(page.getByText(EXPIRED)).toHaveCount(0);
});

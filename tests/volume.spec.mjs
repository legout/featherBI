// Volume journey (spec 0001 acceptance 2 and the volume half of 7). Expected values are hand-computed in
// fixtures/volume/README.md. The 1 M-row Parquet is generated into a git-ignored path by tools/gen-volume.sql.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, "fixtures/volume");
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");
const tile = (page, title) => page.getByRole("group", { name: title });

let out;
let html;
test.beforeAll(() => {
  execFileSync("duckdb", ["-no-agent"], { cwd: root, input: fs.readFileSync(path.join(root, "tools/gen-volume.sql")), stdio: ["pipe", "pipe", "pipe"] });
  out = fs.mkdtempSync(path.join(os.tmpdir(), "volume-"));
  const hashes = [1, 2].map(n => {
    const file = path.join(out, `volume${n}.html`);
    execFileSync(process.execPath, [cli, "build", "dashboard.yaml", "--out", file], { cwd: dir, stdio: "pipe" });
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  });
  expect(hashes[0]).toBe(hashes[1]); // acceptance 7, volume half
  html = path.join(out, "volume1.html");
});
test.afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

test("the volume page has the acceptance 2 shape and the hand-computed totals, and a cross-filter narrows them", async ({ page }) => {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(pathToFileURL(html).href);

  await expect(tile(page, "Revenue").getByText("$50,005,000.00", { exact: true })).toBeVisible();
  await expect(tile(page, "Maximum").getByText("$100.00", { exact: true })).toBeVisible();
  for (const t of await page.getByRole("group").all()) await expect(t).not.toHaveAttribute("aria-busy", "true");

  // Shape: 4 KPIs, 3 charts, 1 pivot, 1 table; region and channel selects and a date range.
  await expect(page.locator(".stat-value")).toHaveCount(4);
  for (const title of ["Revenue vs target by region", "Revenue by channel", "Revenue by month"])
    await expect(tile(page, title).locator("canvas").first()).toBeVisible();
  await expect(tile(page, "Region × month").locator("table")).toHaveCount(1);
  await expect(tile(page, "Sales rows")).toContainText("1000000 rows");
  await expect(page.locator("#filters select")).toHaveCount(2);
  await expect(page.locator('#filters input[type="date"]')).toHaveCount(2);

  // Cross-filter: the pivot's EU row filters every tile (EU revenue 25 000 000.00, 500 000 rows).
  await tile(page, "Region × month").getByRole("button", { name: "EU", exact: true }).click();
  await expect(tile(page, "Revenue").getByText("$25,000,000.00", { exact: true })).toBeVisible();
  await expect(tile(page, "Sales rows")).toContainText("500000 rows");
  // The channel select narrows further: EU + Online (i mod 4 = 0) is 12 497 500.00.
  await page.locator("#filters select").nth(1).selectOption("Online");
  await expect(tile(page, "Revenue").getByText("$12,497,500.00", { exact: true })).toBeVisible();
  await expect(tile(page, "Sales rows")).toContainText("250000 rows");
  expect(errors).toEqual([]);
});

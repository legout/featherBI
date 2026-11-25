// Spec 0001 acceptance 9: one dashboard build over every local format fixture,
// opened over file://, showing the hand-counted count and sum from
// fixtures/formats/README.md in all 16 KPI tiles.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, "fixtures/formats");
const html = "dist/formats.html";

const FORMATS = [
  ["CSV", "csv"],
  ["JSON", "json"],
  ["Parquet", "parquet"],
  ["Excel", "excel"],
  ["SQLite", "sqlite"],
  ["Delta", "delta"],
  ["Iceberg", "iceberg"],
  ["DuckLake", "ducklake"],
];
// fixtures/formats/README.md, added up by hand: 5 rows, sum 150.75.
const EXPECTED = { rows: "5", total: "$150.75" };

test("one build shows the README count and sum for every local format", async ({ page }) => {
  execFileSync("node", ["../../skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml", "--out", html], { cwd: dir, stdio: "pipe" });
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(dir, html)).href);

  for (const [label] of FORMATS) {
    const group = page.getByRole("group", { name: `${label} rows` });
    await expect(group.locator(".stat-value")).toHaveText(EXPECTED.rows);
    await expect(page.getByRole("group", { name: `${label} total` }).locator(".stat-value")).toHaveText(EXPECTED.total);
  }
  expect(errors).toEqual([]);
});

// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
// Plan 0006 task D1 makes classic-bi the default design (spec 0006 §1): for a config without `design` and `size` the
// embedded #dashboard data is still byte-identical; the CSS and the accessibility tree are its deliberate difference.
import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samePage } from "./same-page.mjs";

const BASE = "500cf8b513b28b6a0474543884207531e48fc2ef"; // D1 base (plan 0006)
const root = fileURLToPath(new URL("..", import.meta.url));

// The volume fixture is generated into a per-run temp dir so this spec never writes or deletes the shared
// fixtures/volume/sales.parquet that tests/volume.spec.mjs may be reading in another worker (issue #151).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-volume-"));
fs.mkdirSync(path.join(tmp, "hand"), { recursive: true });
fs.mkdirSync(path.join(tmp, "volume"), { recursive: true });
fs.copyFileSync(path.join(root, "fixtures/hand/targets.xlsx"), path.join(tmp, "hand/targets.xlsx"));
fs.copyFileSync(path.join(root, "fixtures/volume/dashboard.yaml"), path.join(tmp, "volume/dashboard.yaml"));
const sql = fs.readFileSync(new URL("../tools/gen-volume.sql", import.meta.url), "utf8").replace(
  "'fixtures/volume/sales.parquet'",
  `'${path.join(tmp, "volume/sales.parquet").replaceAll("'", "''")}'`,
);
execFileSync("duckdb", [], { cwd: root, input: sql });
const volumeConfig = path.join(tmp, "volume/dashboard.yaml");
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test.skip(({ browserName }) => browserName !== "chromium", "the comparison is of two builds, not of a browser");

// D1's deliberate difference: the default design's layout (CSS and accessibility tree), for every config.
const configs = [
  "fixtures/hand/dashboard.yaml",
  "fixtures/hand/acceptance.yaml",
  "fixtures/hand/pivot-table.yaml",
  "fixtures/hand/presets.yaml",
  "fixtures/hand/upstream.yaml",
  "fixtures/hand/sections.yaml",
  "fixtures/formats/dashboard.yaml",
  volumeConfig,
];

for (const config of configs) {
  // Stable title: the per-run volume config lives in a fresh temp dir in every worker process.
  const name = config === volumeConfig ? "fixtures/volume/dashboard.yaml (per run)" : config;
  test(`${name} embeds the same dashboard data as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config, { dataOnly: true });
  });
}

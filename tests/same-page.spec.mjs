// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samePage } from "./same-page.mjs";

const BASE = "c037637fba98d9030aef4a4f4843b12318eb4235"; // C5 base
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

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// C5 has no deliberate differences, including for sections.
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
  test(`${name} renders the same page as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config);
  });
}

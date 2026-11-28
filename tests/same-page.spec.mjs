// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { samePage } from "./same-page.mjs";

const BASE = "c037637fba98d9030aef4a4f4843b12318eb4235"; // C5 base
const root = fileURLToPath(new URL("..", import.meta.url));
const volume = fileURLToPath(new URL("../fixtures/volume/sales.parquet", import.meta.url));
let generated = false;

test.beforeAll(() => {
  if (!fs.existsSync(volume)) {
    execFileSync("duckdb", [], { cwd: root, input: fs.readFileSync(new URL("../tools/gen-volume.sql", import.meta.url)) });
    generated = true;
  }
});
test.afterAll(() => { if (generated) fs.rmSync(volume, { force: true }); });

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
  "fixtures/volume/dashboard.yaml",
];

for (const config of configs) {
  test(`${config} renders the same page as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config);
  });
}

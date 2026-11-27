// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { samePage } from "./same-page.mjs";

const BASE = "3559548655cc445df11acca3a4db90eeb2e6c9ad"; // plan 0005 C1; each later task of the plan moves it to its own base

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// Deliberate differences of C1: none. The SQL table tile is new in acceptance.yaml, so it is left out there.
const configs = {
  "fixtures/hand/dashboard.yaml": {},
  "fixtures/hand/acceptance.yaml": { withoutTiles: ["Revenue by region (SQL)"] },
  "fixtures/hand/pivot-table.yaml": {},
  "fixtures/hand/presets.yaml": {},
  "fixtures/hand/upstream.yaml": {},
  "fixtures/formats/dashboard.yaml": {},
};

for (const [config, differences] of Object.entries(configs)) {
  test(`${config} renders the same page as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config, differences);
  });
}

// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { expect, test } from "@playwright/test";
import { samePage } from "./same-page.mjs";

const BASE = "6edfbb59489858588a8c5df251642cb1016f2a88"; // plan 0005 C3; each later task of the plan moves it to its own base

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// Deliberate difference of C3 (spec 0005 §4, owner decision 2026-11-27 on #123): a config with `date` now shows the
// header line. Only in those configs that one element is left out, after its text is checked: the first and last order
// date of the hand fixture (README), no source. The rest of the header is still compared; an undated config is compared whole.
const dated = {
  exclude: page => [page.locator("#headline")],
  check: page => expect(page.locator("header p")).toHaveText(["Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025"]),
};

const configs = {
  "fixtures/hand/dashboard.yaml": dated,
  "fixtures/hand/acceptance.yaml": dated,
  "fixtures/hand/pivot-table.yaml": dated,
  "fixtures/hand/presets.yaml": dated,
  "fixtures/hand/upstream.yaml": {},
  "fixtures/formats/dashboard.yaml": {},
};

for (const [config, differences] of Object.entries(configs)) {
  test(`${config} renders the same page as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config, differences);
  });
}

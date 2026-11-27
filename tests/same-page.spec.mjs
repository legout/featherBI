// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { samePage } from "./same-page.mjs";

const BASE = "6edfbb59489858588a8c5df251642cb1016f2a88"; // plan 0005 C3; each later task of the plan moves it to its own base

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// Deliberate difference of C3 (spec 0005 §4, owner decision 2026-11-27 on #123): a config with `date` now shows the
// header line, so that one element is left out; the rest of the header is still compared.
const exclude = page => [page.locator("#headline")];

const configs = [
  "fixtures/hand/dashboard.yaml",
  "fixtures/hand/acceptance.yaml",
  "fixtures/hand/pivot-table.yaml",
  "fixtures/hand/presets.yaml",
  "fixtures/hand/upstream.yaml",
  "fixtures/formats/dashboard.yaml",
];

for (const config of configs) {
  test(`${config} renders the same page as the base commit`, async ({ page }) => {
    await samePage(page, BASE, config, { exclude });
  });
}

// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { samePage } from "./same-page.mjs";

const BASE = "4ba4e03f7202b62ac362ab4d8ed51f87b714723c"; // plan 0005 C4; each later task of the plan moves it to its own base

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// C4 (sections and tabs) has no deliberate difference for a config without `sections`: every page is compared whole.
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
    await samePage(page, BASE, config);
  });
}

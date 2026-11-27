// Spec 0005 acceptance 1: every existing fixture config renders the same page as the base commit of the current plan task.
import { test } from "@playwright/test";
import { samePage } from "./same-page.mjs";

const BASE = "d8110de212c9643c9726d5232161c2725e453027"; // plan 0005 C2; each later task of the plan moves it to its own base

test.skip(({ browserName }) => browserName !== "chromium", "acceptance 1 compares the accessibility tree in Chromium");

// Deliberate difference of C2 (spec 0005 §2 r2): numeric table cells follow the column's scale (`100` → `100.00`), so the
// table grids are left out; their titles and row counts are still compared.
const exclude = page => [page.locator(".ag-root")];

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

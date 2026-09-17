import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const dashboardPath = path.join(rootDir, ".artifacts/browser/standard-runtime.html");

async function ready(page) {
 await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
}

test.beforeAll(async ({ browser }) => requireInstalledDesktopChrome(browser));

test("standard dashboard stays coherent across layout, theme, interactions, and stale revisions", async ({ browser }) => {
 const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await ready(page);

  await expect(page.locator("#dashboard")).toHaveAttribute("data-theme", "daisyui");
  expect(await page.evaluate(() => window.__featherbiBuild.themeVersion)).toBe("5.2.1");
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("featherbi-theme:daisyui@5.2.1"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("featherbi-theme:siemens-ix"))).toBe(false);
  await expect(page.locator("#dashboard-status")).toBeVisible();
  await expect(page.locator("#dashboard-sources")).toBeVisible();
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");
  await expect(page.locator("#component-summary [data-metric=success_rate]")).toHaveText("0.67");
  await expect(page.locator("#component-by_station [data-chart-summary]")).toContainText("SJ: 3");

  await page.locator("#filter-amount_range-through").fill("30");
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("amount_range: 0 through 30");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("3");
  await page.locator("#filter-amount_range-through").fill("100");
  await page.locator("#apply-filters").click();
  await ready(page);
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  await page.locator("#component-by_success [data-action-value=true]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: true");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("4");
  await page.locator("#component-by_success [data-action-value=true]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("successful_only: all");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("6");

  const first = await page.locator("#component-summary").boundingBox();
  const second = await page.locator("#component-by_station").boundingBox();
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);

  await page.locator("#component-by_station [data-action-value=SJ]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SJ");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("3");

  await page.locator("#component-by_station [data-action-value=SD]").click({ modifiers: ["Shift"] });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SJ, SD");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("5");
  await page.locator("#component-by_station [data-action-value=SJ]").click({ modifiers: ["Shift"] });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SD");
  await page.locator("#component-by_station [data-action-value=SD]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: all");

  await page.locator("#component-by_day [data-brush-from]").fill("2026-09-02");
  await page.locator("#component-by_day [data-brush-through]").fill("2026-09-03");
  await page.locator("#component-by_day [data-brush-apply]").click();
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("window: 2026-09-02 through 2026-09-03");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("2");

  const beforeLocal = await page.locator("#active-filter-state").textContent();
  await page.locator("#component-local_product [data-action-value=P1]").click();
  await expect(page.locator("#active-filter-state")).toHaveText(beforeLocal);
  await expect(page.locator("#component-local_product")).toHaveAttribute("data-local-selection", "P1");

  await page.evaluate(async () => {
   const select = document.querySelector("#filter-stations");
   for (const value of ['SJ', 'SD']) {
    const option = [...select.options].find((entry) => entry.textContent === value);
    option.selected = value === 'SJ';
   }
   const apply = document.querySelector("#apply-filters");
   apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
   await Promise.resolve(); // Let the obsolete revision enter DuckDB before superseding it.
   for (const option of select.options) option.selected = option.textContent === 'SD';
   apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await ready(page);
  await expect(page.locator("#active-filter-state")).toContainText("stations: SD");
  await expect(page.locator("#component-summary [data-metric=records]")).toHaveText("1");

  await page.setViewportSize({ width: 480, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const tops = await page.locator("#dashboard-layout > section").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(tops).toEqual([...tops].sort((left, right) => left - right));
  await expect(page.locator("#dashboard-status")).toBeVisible();
  await expect(page.locator("#replace-files")).toBeVisible();
 } finally {
  await context.close();
 }
});

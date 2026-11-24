// Pivot and table journeys over the real file:// dashboard.
// Expected values are hand-computed in fixtures/hand/README.md.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = "fixtures/hand/dist/hand-pivot-table.html";

test.beforeAll(() => {
  execFileSync(
    "node",
    ["skill/featherbi/scripts/featherbi.mjs", "build", "fixtures/hand/pivot-table.yaml"],
    { cwd: root, stdio: "pipe" },
  );
});

async function open(page) {
  const errors = [];
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(pathToFileURL(root + output).href);
  return errors;
}

const tile = (page, title) => page.getByRole("group", { name: title });

test("pivot renders SQL totals and clicking a data row filters the dashboard", async ({ page }) => {
  const errors = await open(page);
  const pivot = tile(page, "Region × month");
  await expect(pivot).not.toHaveAttribute("aria-busy", "true");

  const eu = pivot.getByRole("row", { name: /^EU/ });
  await expect(eu.getByRole("cell").nth(1)).toHaveText("$300.00");
  await expect(pivot.getByRole("button")).toHaveCount(2);
  await expect(pivot.getByRole("button", { name: "Total", exact: true })).toHaveCount(0);

  await pivot.getByRole("button", { name: "EU", exact: true }).click();
  await expect(tile(page, "Revenue").getByText("$850.00", { exact: true })).toBeVisible();
  await expect(pivot.getByRole("button")).toHaveCount(1);
  await expect(pivot.getByRole("row", { name: /^US/ })).toHaveCount(0);
  await expect(pivot.getByRole("row", { name: /^EU/ }).getByRole("cell").nth(1)).toHaveText("$300.00");
  expect(errors).toEqual([]);
});

test("table counts filters, pages tied dates without gaps and follows the theme", async ({ page }) => {
  const errors = await open(page);
  const table = tile(page, "Sales rows");
  const pivot = tile(page, "Region × month");
  await expect(table).not.toHaveAttribute("aria-busy", "true");
  await expect(table).toContainText("12 rows (filtered)");

  await pivot.getByRole("button", { name: "EU", exact: true }).click();
  await expect(tile(page, "Revenue").getByText("$850.00", { exact: true })).toBeVisible();
  await expect(pivot.getByRole("button")).toHaveCount(1);
  await expect(table).toContainText("6 rows (filtered)");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(table).toContainText("12 rows (filtered)");

  await table.getByRole("columnheader", { name: "order_date", exact: true }).click();
  const dataRow = index => table.locator(`[role="row"][aria-rowindex="${index + 2}"]`);
  await expect(dataRow(0)).toBeVisible();
  await expect(dataRow(0).getByRole("gridcell").first()).toHaveText("2025-01-05");
  const height = await dataRow(0).evaluate(node => node.getBoundingClientRect().height);
  const viewport = table.locator(".ag-body-viewport");
  // README order: ascending dates; tied dates retain snapshot __row order.
  const expected = [100, 200, 150, 250, 120, 220, 180, 270, 140, 240, 160, 230.5];
  for (let start = 0; start < expected.length; start += 5) {
    await viewport.evaluate((node, top) => (node.scrollTop = top), start * height);
    const actual = [];
    for (let index = start; index < Math.min(start + 5, expected.length); index++) {
      await expect(dataRow(index)).toBeVisible();
      actual.push(Number(await dataRow(index).getByRole("gridcell").last().textContent()));
    }
    expect(actual).toEqual(expected.slice(start, start + 5));
  }

  const grid = table.locator(".ag-root");
  const background = () => grid.evaluate(node => getComputedStyle(node).getPropertyValue("--ag-background-color"));
  const dark = page.getByRole("checkbox", { name: "Dark theme" });
  await dark.uncheck();
  const light = await background();
  await dark.check();
  await expect.poll(background).not.toBe(light);
  await dark.uncheck();
  await expect.poll(background).toBe(light);
  expect(errors).toEqual([]);
});

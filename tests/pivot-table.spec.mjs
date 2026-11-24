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

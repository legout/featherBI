// Journey harness: build a fixture with the real CLI, open the output over file://, assert what the page shows.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));

function build(config) {
  execFileSync("node", ["skill/featherbi/scripts/featherbi.mjs", "build", config], { cwd: root, stdio: "pipe" });
}

async function open(page, html) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(pathToFileURL(root + html).href);
  return errors;
}

// Expected values are the hand-computed ones in fixtures/hand/README.md.
for (const [engine, config, html] of [
  ["Haybarn-Wasm", "fixtures/hand/dashboard.yaml", "fixtures/hand/dist/hand.html"],
  ["upstream duckdb-wasm", "fixtures/hand/upstream.yaml", "fixtures/hand/dist/hand-upstream.html"],
]) {
  test(`hand dashboard shows the hand total as Revenue (${engine})`, async ({ page }) => {
    build(config);
    const errors = await open(page, html);
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$2,260.50", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("the theme toggle switches between light and dark", async ({ page }) => {
  build("fixtures/hand/dashboard.yaml");
  await open(page, "fixtures/hand/dist/hand.html");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.getByRole("checkbox", { name: "Dark theme" }).check();
  await expect.poll(background).not.toBe(light);
  await page.getByRole("checkbox", { name: "Dark theme" }).uncheck();
  await expect.poll(background).toBe(light);
});

test("selects narrow the KPI, chips appear and clear, Reset restores totals and the default range", async ({ page }) => {
  build("fixtures/hand/dashboard.yaml");
  const errors = await open(page, "fixtures/hand/dist/hand.html");
  const revenue = amount => expect(page.getByRole("group", { name: "Revenue" }).getByText(amount, { exact: true })).toBeVisible();
  const chips = page.getByLabel("Active filters");
  await revenue("$2,260.50");
  // Default range: 12 months ending at the latest date (2025-03-25).
  await expect(page.getByLabel("From")).toHaveValue("2024-04-01");
  await expect(page.getByLabel("To")).toHaveValue("2025-03-25");

  await page.getByLabel("region").selectOption("EU");
  await revenue("$850.00");
  await expect(chips).toContainText("region: EU");
  await page.getByLabel("channel").selectOption("Online");
  await revenue("$360.00"); // EU + Online: 100 + 120 + 140
  await page.getByRole("button", { name: "Clear region" }).click();
  await revenue("$1,020.00");
  await expect(chips).not.toContainText("region: EU");

  await page.getByLabel("From").fill("2025-03-01");
  await revenue("$380.00"); // Online since March: 140 + 240
  await page.getByRole("button", { name: "Reset" }).click();
  await revenue("$2,260.50");
  await expect(page.getByLabel("From")).toHaveValue("2024-04-01");
  await expect(chips).toBeEmpty();
  expect(errors).toEqual([]);
});

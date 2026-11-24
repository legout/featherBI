import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");

function build(config, output) {
  execFileSync(process.execPath, [cli, "build", config, "--out", output], { cwd: root, stdio: "pipe" });
}

test("Explore loads on demand and opens with the EU rows on file://", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-"));
  try {
    const html = path.join(dir, "dashboard.html");
    build(path.join(root, "fixtures/hand/dashboard.yaml"), html);
    const requests = [];
    page.on("request", request => { if (/perspective/i.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(html).href);
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$2,260.50", { exact: true })).toBeVisible();
    await page.getByLabel("region").selectOption("EU");
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$850.00", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole("button", { name: "Explore" }).click({ timeout: 10000 });
    const viewer = page.locator("perspective-viewer");
    await expect(viewer).toBeVisible();
    // The fixture README independently records six EU sales rows.
    await expect.poll(() => viewer.evaluate(async el => (await el.getView()).num_rows())).toBe(6);
    // Reopen after switching to US: every open shows the new filter's rows, never the previous EU ones.
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("combobox", { name: "region" }).selectOption("US");
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$1,410.50", { exact: true })).toBeVisible();
    // Samples every frame whether the visible viewer shows a region cell "EU" or "US" (its cells live in shadow roots).
    await page.evaluate(() => {
      const text = n => (n.shadowRoot ? text(n.shadowRoot) : "") + [...n.childNodes].map(c => (c.nodeType === 3 ? ` ${c.textContent} ` : c.nodeType === 1 ? text(c) : "")).join("");
      window.seen = new Set();
      const sample = () => {
        const el = document.querySelector("perspective-viewer");
        if (el?.checkVisibility({ visibilityProperty: true })) for (const region of ["EU", "US"]) if (new RegExp(`\\s${region}\\s`).test(text(el))) window.seen.add(region);
        if (!window.seen.has("US")) requestAnimationFrame(sample);
      };
      sample();
    });
    await page.getByRole("button", { name: "Explore" }).click();
    await expect.poll(() => page.evaluate(() => [...window.seen])).toContain("US");
    expect(await page.evaluate(() => [...window.seen])).toEqual(["US"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Explore is on by default and explore: false hides the button", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-disabled-"));
  try {
    const defaultHtml = path.join(dir, "default.html");
    build(path.join(root, "fixtures/hand/dashboard.yaml"), defaultHtml);
    await page.goto(pathToFileURL(defaultHtml).href);
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$2,260.50", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore" })).toBeVisible({ timeout: 10000 });
    fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(dir, "sales.parquet"));
    const config = fs.readFileSync(path.join(root, "fixtures/hand/dashboard.yaml"), "utf8") + "\nexplore: false\n";
    fs.writeFileSync(path.join(dir, "dashboard.yaml"), config);
    const html = path.join(dir, "dashboard.html");
    build(path.join(dir, "dashboard.yaml"), html);
    await page.goto(pathToFileURL(html).href);
    await expect(page.getByRole("group", { name: "Revenue" }).getByText("$2,260.50", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore" })).toHaveCount(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

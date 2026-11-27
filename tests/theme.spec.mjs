// Theme journeys (spec 0003 acceptance 3 and 4): a theme file with both schemes, palette, font and logo in an --offline
// build with the network blocked, and a light-only theme under a dark system setting.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");

const DASHBOARD = `title: Themed
theme: ./theme.yaml
explore: false
sources:
  sales:
    read: "read_parquet('sales.parquet')"
tiles:
  - { type: kpi, title: Revenue, format: currency, sql: "SELECT SUM(revenue) AS value FROM sales" }
  - { type: echarts, preset: bar, title: Revenue by region, sql: "SELECT region AS x, SUM(revenue) AS y FROM sales GROUP BY 1 ORDER BY 1" }
`;
const THEME = `name: Acme
light: { primary: "#0b5fff", primary-content: "#ffffff", secondary: "#7a00cc", base-100: "#ffffff", base-content: "#1a1a1a" }
dark: { primary: "#6ea0ff", primary-content: "#111418", base-100: "#111418", base-content: "#e8eaed" }
palette: ["#0b5fff", "#ff7a00", "#00a37a"]
radius: 0.25rem
font: { family: "Test Sans, sans-serif", file: ./TestSans.woff2 }
logo: ./logo.svg
`;
// A one-glyph font ("A", family "Test Sans") made for this test with fontTools; 296 bytes.
const FONT = "d09GMgABAAAAAAEoAAoAAAAAApQAAADiAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAANAo4QAE2AiQDBgsGAAQgBWYHJhvfAQCOxDgm8UpcUOLh+/3aufc9VKZrJpI8VLEkIo0StpOqRlKD6bv5F87f0+MWQYAt1zDxpEAo8Lx51wOe8LrDGWMdEanj6uhFJXejpUtlCsBKiTVrZQqS/wI4JRMFk93ApGoKVRVYaxrsND8CQIKKRC/6ARWEqHWga4h58tH6oDEIBG/ve2V/ZLHTW8o//M3vxJkTop0fKBIEZapB7jpxEm0BAIjpRQKpCpAAAKgWBAh9CJB69Cmi9gnjRvtIw2ZuVL5xePf8PuoHbDr17MWUDYfuPFt36tyrG4eepKI7Ngc=";
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect width="48" height="24" fill="#0b5fff"/></svg>';

// Builds DASHBOARD with `theme` in a new folder -> the page's file URL.
function build(dir, theme, args = []) {
  fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(dir, "sales.parquet"));
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), DASHBOARD);
  fs.writeFileSync(path.join(dir, "theme.yaml"), theme);
  fs.writeFileSync(path.join(dir, "TestSans.woff2"), Buffer.from(FONT, "base64"));
  fs.writeFileSync(path.join(dir, "logo.svg"), LOGO);
  execFileSync(process.execPath, [cli, "build", "dashboard.yaml", "--out", path.join(dir, "page.html"), ...args], { cwd: dir, stdio: "pipe" });
  return pathToFileURL(path.join(dir, "page.html")).href;
}
const token = (page, name) => page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name);

test("--offline with a theme file: colours in light and dark, palette, logo and font, with every non-file: request blocked", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-file-"));
  try {
    const url = build(dir, THEME, ["--offline"]);
    const network = [];
    const errors = [];
    await page.route(
      target => !target.href.startsWith("file:"),
      route => {
        network.push(route.request().url());
        return route.abort();
      },
    );
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(url);
    await expect(page.getByRole("group", { name: "Revenue", exact: true }).getByText("$2,260.50", { exact: true })).toBeVisible();

    // The logo is drawn, left of the title.
    const logo = page.locator("header img");
    await expect(logo).toBeVisible();
    expect(await logo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    expect((await logo.boundingBox()).x).toBeLessThan((await page.getByRole("heading", { name: "Themed" }).boundingBox()).x);

    // Body text is set in the theme's family, and its embedded file is the font that loaded.
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Test Sans");
    await expect.poll(() => page.evaluate(() => document.fonts.load('16px "Test Sans"', "A").then(faces => faces.length))).toBe(1);

    // The first chart series (the EU bar, 850) is palette[0] = #0b5fff = rgb(11, 95, 255), in both schemes.
    const bar = () =>
      page
        .getByRole("group", { name: "Revenue by region", exact: true })
        .getByRole("img")
        .evaluate(async node => {
          const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
          const echarts = await import(charts.url);
          const [x, y] = echarts.getInstanceByDom(node).convertToPixel({ seriesIndex: 0 }, ["EU", 400]);
          const canvas = node.querySelector("canvas");
          const scale = canvas.width / canvas.clientWidth;
          return [...canvas.getContext("2d", { willReadFrequently: true }).getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data].join();
        });
    await expect.poll(bar).toBe("11,95,255,255");

    expect(await token(page, "--color-primary")).toBe("#0b5fff");
    expect(await token(page, "--color-secondary")).toBe("#7a00cc");
    await page.getByRole("checkbox", { name: "Dark theme" }).check();
    expect(await token(page, "--color-primary")).toBe("#6ea0ff");
    expect(await token(page, "--color-base-100")).toBe("#111418");
    // `secondary` is set for light only: dark falls back to the default theme's dark value (DaisyUI night), not to light's.
    expect(await token(page, "--color-secondary")).toBe("oklch(68.011% .158 276.934)");
    await expect.poll(bar).toBe("11,95,255,255");

    expect(network).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a light-only theme hides the toggle and stays light when the viewer prefers dark", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-light-"));
  try {
    const url = build(dir, 'light: { primary: "#0b5fff", base-100: "#ffffff", base-content: "#1a1a1a" }\n');
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Themed" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Dark theme" })).toBeHidden();
    await expect(page.locator("#theme")).toBeHidden();
    expect(await token(page, "--color-base-100")).toBe("#ffffff");
    expect(await token(page, "--color-primary")).toBe("#0b5fff");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Spec 0005 §5, acceptance 7 (tabs) and 8 (stack): fixtures/hand/sections.yaml, built with the real CLI and opened over file://.
// Expected values are the hand totals of fixtures/hand/README.md (EU: revenue 850.00, 6 rows, Online 360.00, Retail 490.00).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));

// The fixture with the given layout, built next to a copy of the hand fixture's sales rows. -> the page's URL
function built(tmp, layout) {
  const dir = path.join(tmp, layout);
  const url = pathToFileURL(path.join(dir, "dist/hand-sections.html")).href;
  if (fs.existsSync(dir)) return url; // built by an earlier test of this run
  fs.mkdirSync(dir);
  fs.copyFileSync(root + "fixtures/hand/sales.parquet", path.join(dir, "sales.parquet"));
  const yaml = fs.readFileSync(root + "fixtures/hand/sections.yaml", "utf8");
  expect(yaml).toContain("\nlayout: tabs\n");
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), yaml.replace("\nlayout: tabs\n", `\nlayout: ${layout}\n`));
  execFileSync("node", [root + "skill/featherbi/scripts/featherbi.mjs", "build", "dashboard.yaml"], { cwd: dir, stdio: "pipe" });
  return url;
}
let tmp;
test.beforeAll(() => void (tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sections-"))));
test.afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function watch(page) {
  const errors = [];
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", e => errors.push(String(e)));
  return errors;
}
const tile = (page, title) => page.getByRole("group", { name: new RegExp(`^${title}( ·|$)`) }); // a table title also carries its row count
const kpi = (page, title) => tile(page, title).locator(".stat-value");
const region = page => page.getByRole("combobox", { name: /^region/ });
const rows = async (page, ...expected) => {
  const table = tile(page, "Revenue by channel");
  for (const [i, row] of expected.entries()) await expect(table.locator(`[role="row"][aria-rowindex="${i + 2}"]`).getByRole("gridcell")).toHaveText(row);
};
// The SQL text of every statement the page sent to the engine worker so far (no product hook: the page's own messages).
const queried = page => page.evaluate(() => window.__sql.join("\n"));
const TAB_1 = "SUM(revenue) AS value"; // only the Revenue KPI of "Overview" runs this
const TAB_2 = /COUNT\(\*\)|SELECT channel/; // the Orders KPI and the table of "Detail"

test("tabs: only the open tab queries; a filter applies in the tab opened next; the hash carries the tab; arrow, Home and End switch tabs", async ({ page, context }) => {
  const url = built(tmp, "tabs");
  await context.addInitScript(() => {
    window.__sql = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      const [message] = args;
      if (typeof message?.type === "string" && Array.isArray(message.data)) window.__sql.push(...message.data.filter(part => typeof part === "string"));
      return post.apply(this, args);
    };
  });
  const errors = watch(page);
  await page.goto(url);
  const tab = name => page.getByRole("tablist").getByRole("tab", { name, exact: true });

  // On load the first tab is open and only its tiles have queried.
  await expect(page.getByRole("tab")).toHaveText(["Overview", "Detail"]);
  await expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  await expect(tab("Detail")).toHaveAttribute("aria-selected", "false");
  await expect(kpi(page, "Revenue")).toHaveText("$2,260.50");
  await expect(tile(page, "Revenue by region")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(tile(page, "Orders")).toBeHidden();
  expect(await queried(page)).toContain(TAB_1);
  expect(await queried(page)).not.toMatch(TAB_2);

  // EU in the filter bar, then tab 2: it shows EU values, and it has not queried before it opened.
  await region(page).selectOption("EU");
  await expect(kpi(page, "Revenue")).toHaveText("$850.00");
  expect(page.url()).toMatch(/#region=EU$/);
  expect(await queried(page)).not.toMatch(TAB_2);
  await tab("Detail").click();
  await expect(tab("Detail")).toHaveAttribute("aria-selected", "true");
  await expect(tab("Overview")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel", { name: "Detail" })).toBeVisible();
  await expect(kpi(page, "Orders")).toHaveText("6");
  await rows(page, ["Online", "360.00"], ["Retail", "490.00"]);
  await expect(tile(page, "Revenue")).toBeHidden();
  expect(page.url()).toMatch(/#region=EU&tab=2$/);

  // The same URL in a fresh page opens tab 2 with EU, and tab 1 does not query there.
  const fresh = await context.newPage();
  const freshErrors = watch(fresh);
  await fresh.goto(page.url());
  await expect(fresh.getByRole("tab", { name: "Detail" })).toHaveAttribute("aria-selected", "true");
  await expect(region(fresh)).toHaveValue("EU");
  await expect(kpi(fresh, "Orders")).toHaveText("6");
  await rows(fresh, ["Online", "360.00"], ["Retail", "490.00"]);
  expect(await queried(fresh)).not.toContain(TAB_1);
  expect(fresh.url()).toMatch(/#region=EU&tab=2$/);
  expect(freshErrors).toEqual([]);

  // Keyboard: the arrow keys move to the neighbour, Home and End to the first and last; focus and selection move together.
  const open = async (key, name, hash) => {
    await page.keyboard.press(key);
    await expect(tab(name)).toHaveAttribute("aria-selected", "true");
    await expect(tab(name)).toBeFocused();
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(page.getByRole("tabpanel", { name })).toBeVisible();
    expect(page.url()).toMatch(hash);
  };
  await tab("Detail").focus();
  await open("ArrowLeft", "Overview", /#region=EU$/);
  await expect(kpi(page, "Revenue")).toHaveText("$850.00");
  await open("ArrowRight", "Detail", /#region=EU&tab=2$/);
  await open("Home", "Overview", /#region=EU$/);
  await open("End", "Detail", /#region=EU&tab=2$/);
  await expect(kpi(page, "Orders")).toHaveText("6");
  // Roving focus: only the open tab is in the page's Tab order.
  await expect(tab("Detail")).toHaveAttribute("tabindex", "0");
  await expect(tab("Overview")).toHaveAttribute("tabindex", "-1");
  expect(errors).toEqual([]);
});

test("tabs: a tab number outside the tabs is ignored, the rest of the hash still applies", async ({ page }) => {
  const url = built(tmp, "tabs");
  const errors = watch(page);
  await page.goto(`${url}#tab=9&region=EU`);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(kpi(page, "Revenue")).toHaveText("$850.00");
  await expect(tile(page, "Orders")).toBeHidden();
  expect(page.url()).toMatch(/#region=EU$/);
  expect(errors).toEqual([]);
});

test("stack: both section titles and all tiles are shown; the values equal the tabs'", async ({ page }) => {
  const url = built(tmp, "stack");
  const errors = watch(page);
  await page.goto(url);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const section = name => page.getByRole("region", { name, exact: true });
  await expect(section("Overview").getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(section("Detail").getByRole("heading", { name: "Detail", exact: true })).toBeVisible();
  // Each tile sits in its own section.
  await expect(section("Overview").getByRole("group")).toHaveCount(2);
  await expect(section("Detail").getByRole("group")).toHaveCount(2);
  await expect(kpi(section("Overview"), "Revenue")).toHaveText("$2,260.50");
  await expect(tile(section("Overview"), "Revenue by region")).not.toHaveAttribute("aria-busy", "true");
  await expect(kpi(section("Detail"), "Orders")).toHaveText("12");
  await rows(page, ["Online", "1,020.00"], ["Retail", "1,240.50"]);

  await region(page).selectOption("EU");
  await expect(kpi(page, "Revenue")).toHaveText("$850.00");
  await expect(kpi(page, "Orders")).toHaveText("6");
  await rows(page, ["Online", "360.00"], ["Retail", "490.00"]);
  expect(page.url()).toMatch(/#region=EU$/);
  expect(errors).toEqual([]);
});

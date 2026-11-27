// Domain examples (spec 0004 acceptance 3). Each examples/<domain>/ has a deterministic make.sql, a dashboard.yaml and a README whose
// "Figures" table lists hand-derived values: | Tile | Shown | Derivation |. The page must show every one over file://, with 0 console errors.
// The playbook references/domains/<domain>.md must have its five sections, an index row, and SQL recipes that run on the example's data.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { parse } from "../skill/featherbi/scripts/lib/vendor/yaml/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");
const refs = path.join(root, "skill/featherbi/references");
const duckdb = (cwd, input) => execFileSync("duckdb", ["-no-agent"], { cwd, input, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" });
const SECTIONS = ["Detection signals", "Interview questions", "Figures", "Tile ideas", "Traps"];
// Waves add their domains to the examples folder, never to this file; BR3 (industry) is the first wave.
const INDUSTRY = ["sensor-time-series", "end-of-line-test", "spc-quality", "oee-downtime", "energy-smart-meter"];
// examples/acme-theme is the theme example of spec 0003 (built in tests/theme.test.mjs), not a domain.
const domains = fs.readdirSync(path.join(root, "examples"), { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== "acme-theme").map(d => d.name).sort();

test("the industry domains each have an example and a playbook with an index row", () => {
  for (const d of INDUSTRY) expect(domains, d).toContain(d);
  const index = fs.readFileSync(path.join(refs, "domains.md"), "utf8");
  for (const d of domains) {
    const dir = path.join(root, "examples", d);
    for (const f of ["make.sql", "dashboard.yaml", "README.md"]) expect(fs.existsSync(path.join(dir, f)), `${d}/${f}`).toBe(true);
    const playbook = fs.readFileSync(path.join(refs, "domains", `${d}.md`), "utf8");
    expect([...playbook.matchAll(/^## (.+)$/gm)].map(m => m[1]), d).toEqual(SECTIONS);
    expect(index, d).toContain(`](domains/${d}.md)`);
  }
});

for (const d of domains) {
  test(`${d}: the playbook's SQL recipes run, the example builds and its README figures show on the page`, async ({ page }, testInfo) => {
    const dir = path.join(root, "examples", d);
    const started = Date.now();
    duckdb(dir, fs.readFileSync(path.join(dir, "make.sql"), "utf8"));

    // Every ```sql recipe of the playbook runs on the example's tables (the config's source names).
    const config = parse(fs.readFileSync(path.join(dir, "dashboard.yaml"), "utf8"));
    const views = Object.entries(config.sources).map(([name, s]) => `CREATE VIEW ${name} AS SELECT * FROM ${s.read};`).join("\n");
    const recipes = [...fs.readFileSync(path.join(refs, "domains", `${d}.md`), "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1]);
    expect(recipes.length, "recipes").toBeGreaterThan(0);
    for (const sql of recipes) expect(() => duckdb(dir, `${views}\n${sql}`), sql).not.toThrow();

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "example-"));
    try {
      const file = path.join(out, `${d}.html`);
      execFileSync(process.execPath, [cli, "build", "dashboard.yaml", "--out", file], { cwd: dir, stdio: "pipe" });
      const built = Date.now();
      const errors = [];
      page.on("console", m => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(pathToFileURL(file).href);

      const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
      const figures = [...readme.matchAll(/^\| ([^|]+?) \| `([^`]+)` \|/gm)].map(m => [m[1], m[2]]).filter(([t]) => t !== "Tile");
      expect(figures.length, "README figures").toBeGreaterThanOrEqual(3);
      expect(figures.length, "README figures").toBeLessThanOrEqual(5);
      for (const [title, shown] of figures) await expect(page.getByRole("group", { name: title, exact: true }).getByText(shown, { exact: true }), title).toBeVisible();
      for (const t of await page.getByRole("group").all()) await expect(t).not.toHaveAttribute("aria-busy", "true");
      expect(errors).toEqual([]);
      const note = `${d}: make+recipes+build ${((built - started) / 1000).toFixed(1)} s, page check ${((Date.now() - built) / 1000).toFixed(1)} s (${testInfo.project.name})`;
      console.log(note);
      testInfo.annotations.push({ type: "ci-time", description: note });
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
}

// Named scenarios from the PR #134 review, each with a hand-worked expectation.
// One entry per SQL statement of the playbook (statements end in ";" at a line end).
const recipes = d => [...fs.readFileSync(path.join(refs, "domains", `${d}.md`), "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].flatMap(m => m[1].split(/;\n/)).map(r => r.trim()).filter(Boolean);
const csv = (cwd, sql) => execFileSync("duckdb", ["-no-agent", "-csv", "-noheader", "-c", sql], { cwd, encoding: "utf8" }).trim().split("\n");

test("sensor: the same hour on two dates stays two rows in the hourly recipe", () => {
  const recipe = recipes("sensor-time-series").find(r => r.includes("%H:00"));
  // Hand data: S1 reads 10.0 at 10:05 on 03-01 and 20.0 at 10:05 on 03-02, so the hourly averages are 10 and 20, not one 15.
  const sql = `CREATE VIEW readings AS SELECT * FROM (VALUES (TIMESTAMP '2025-03-01 10:05', 'S1', 10.0), (TIMESTAMP '2025-03-02 10:05', 'S1', 20.0)) t(ts, sensor, temp_c); ${recipe}`;
  expect(csv(root, sql)).toEqual(["2025-03-01 10:00,10.0,S1", "2025-03-02 10:00,20.0,S1"]);
});

test("OEE: mixed ideal rates break the product of the three ratios, and grouping by rate restores it", () => {
  const dir = path.join(root, "examples/oee-downtime");
  const [avail, perf, qual, oee, byRate] = recipes("oee-downtime");
  // Hand data (reviewer): M1 480 planned, 240 run at 2/min, 480 produced; M2 480 planned, 480 run at 1/min, 480 produced; no scrap.
  const shifts = `CREATE VIEW shifts AS SELECT * FROM (VALUES ('M1', 480, 240, 2, 480, 0), ('M2', 480, 480, 1, 480, 0)) t(machine, planned_min, run_min, ideal_per_min, produced, scrap);`;
  const [a, p, q, o] = [avail, perf, qual, oee].map(r => Number(csv(dir, `${shifts} ${r}`)[0]));
  expect([a, p, q]).toEqual([75, 100, 100]);
  expect(o).toBeCloseTo(66.667, 2); // 960 good / (480*2 + 480*1) ideal
  expect(o).not.toBeCloseTo((a * p * q) / 10000, 0); // 75 would be wrong
  expect(csv(dir, `${shifts} ${byRate}`)).toEqual(["1,100.0", "2,50.0"]); // 480/480 and 480/960
});

test("sensor and SPC charts: a line click filters nothing, the SPC centre series is 10.001 and distinct from the mean", async ({ page }) => {
  const build = async d => {
    const dir = path.join(root, "examples", d);
    duckdb(dir, fs.readFileSync(path.join(dir, "make.sql"), "utf8"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "example-"));
    const file = path.join(out, `${d}.html`);
    execFileSync(process.execPath, [cli, "build", "dashboard.yaml", "--out", file], { cwd: dir, stdio: "pipe" });
    return { out, url: pathToFileURL(file).href };
  };
  const sensor = await build("sensor-time-series");
  const spc = await build("spc-quality");
  try {
    await page.emulateMedia({ reducedMotion: "reduce" }); // the renderer then skips the draw-in animation, which would move the point while we click
    await page.goto(sensor.url);
    const line = page.getByRole("group", { name: "Hourly average by sensor", exact: true });
    await expect(line.getByRole("img")).toBeVisible();
    await expect(line).not.toHaveAttribute("aria-busy", "true");
    await expect.poll(() => line.evaluate(n => [...n.querySelectorAll("canvas")].some(c => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v)))).toBe(true);
    // Click S1's point at 2025-03-01 12:00, whose hourly mean is 20 + 2.95 = 22.95 (offset 0; minutes 0..59 add 0.0..5.9); no dimension may be set.
    await line.scrollIntoViewIfNeeded(); // the mouse clicks at viewport coordinates, so scroll before measuring
    const at = await line.getByRole("img").evaluate(async node => {
      const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
      const echarts = await import(charts.url);
      const box = node.getBoundingClientRect();
      const [x, y] = echarts.getInstanceByDom(node).convertToPixel({ seriesIndex: 0 }, ["2025-03-01 12:00", 22.95]);
      return { x: box.x + x, y: box.y + y };
    });
    // Register a probe after the page's own click handler, so its flag proves that handler has run before we assert.
    await line.getByRole("img").evaluate(async node => {
      const { charts } = JSON.parse(document.getElementById("dashboard").textContent);
      (await import(charts.url)).getInstanceByDom(node).on("click", () => (window.__clicked = true));
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__clicked === true);
    await expect(page.getByLabel("Active filters")).toBeEmpty();
    await expect(page.getByRole("group", { name: "Readings", exact: true }).getByText("5,760", { exact: true })).toBeVisible();

    // SPC: centre = mean of the subgroup means = 10 + 0.1 / 100 = 10.001 (the shift only moves one of 100 subgroups); subgroup 1's mean is 10 - 0.004 = 9.996.
    await page.goto(spc.url);
    const xbar = page.getByRole("group", { name: "X-bar chart", exact: true }).getByRole("img");
    await expect(xbar).toHaveAttribute("aria-label", /representing centre\..*for 2 is 1, 10\.001/s);
    await expect(xbar).toHaveAttribute("aria-label", /representing mean\..*for 2 is 1, 9\.996/s);
  } finally {
    fs.rmSync(sensor.out, { recursive: true, force: true });
    fs.rmSync(spc.out, { recursive: true, force: true });
  }
});

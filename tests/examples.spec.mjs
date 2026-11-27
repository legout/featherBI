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
const domains = fs.readdirSync(path.join(root, "examples"), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();

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

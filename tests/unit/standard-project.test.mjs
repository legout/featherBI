import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../authoring/compiler.mjs";
import { scopeThemeCss } from "../../authoring/css.mjs";
import { renderDashboard } from "../../scripts/build.mjs";

const example = path.resolve("examples/standard-dashboard");

async function copyProject(change = (value) => value) {
 const root = await mkdtemp(path.join(os.tmpdir(), "featherbi-standard-"));
 await cp(example, root, { recursive: true });
 const dashboard = path.join(root, "dashboard.yaml");
 await writeFile(dashboard, change(await readFile(dashboard, "utf8")));
 return { root, dashboard };
}

test("models, dimensions, measures, ratios, theme CSS, and layout compile", async () => {
 const { dashboard } = await copyProject();
 const { config } = await compileProject(dashboard);
 assert.equal(config.theme, "daisyui");
 assert.match(config.themeCss, /#dashboard \[data-component-type="metric-group"\]/);
 assert.match(config.queries.summary.sql, /WITH "inspection_model" AS/);
 assert.match(config.queries.summary.sql, /NULLIF\(COALESCE\(count\(\*\), 0\), 0\)/);
 assert.deepEqual(config.queries.summary.params, [
  "stations",
  "window_from",
  "window_to",
  "amount_range_from",
  "amount_range_to",
  "successful_only",
 ]);
 assert.equal(config.layout[1].interactionDimension, "station");
});

test("compiler rejects invalid catalog, ratio, model cycle, layout, theme, binding, and CSS", async () => {
 const cases = [
  [(yaml) => yaml.replace("field: station, label: Station", "field: missing, label: Station"), /undeclared model field/],
  [(yaml) => yaml.replace("    zero: \"null\"\n", ""), /required property 'zero'/],
  [(yaml) => yaml.replace("theme: daisyui", "theme: inferred-corporate"), /theme.*one of/i],
  [(yaml) => yaml.replace("    x: 5\n    y: 1", "    x: 1\n    y: 1"), /overlaps component/],
  [(yaml) => yaml.replace("    xField: station", "    options: {}\n    xField: station"), /additional property/i],
  [(yaml) => yaml.replace("dimension: station\n    default: \[\]", "dimension: amount\n    default: []"), /incompatible/],
 ];
 for (const [change, expected] of cases) {
  const { dashboard } = await copyProject(change);
  await assert.rejects(() => compileProject(dashboard), expected);
 }
 const cyclic = await copyProject();
 await writeFile(path.join(cyclic.root, "models", "inspection_model.sql"), "SELECT * FROM inspection_model\n");
 await assert.rejects(() => compileProject(cyclic.dashboard), /model cycle/);
 const unsafeCss = await copyProject();
 await writeFile(path.join(unsafeCss.root, "theme.css"), '@import "https://example.test/theme.css";\n');
 await assert.rejects(() => compileProject(unsafeCss.dashboard), /@import is not allowed/);
});

test("trusted CSS preserves useful at-rules and rejects network and hidden required UI", async () => {
 const result = await scopeThemeCss(":root { --brand: #246; } @media (width > 40rem) { .card { color: var(--brand); } } @keyframes pulse { from { opacity: .5 } to { opacity: 1 } }");
 assert.match(result, /#dashboard \{ --brand: #246/);
 assert.match(result, /#dashboard \.card/);
 assert.match(result, /@keyframes pulse/);
 for (const css of [
  ".card { background: url(./tracking.png) }",
  ".card { background: u\\72l(https\\3a //example.test/x) }",
  "#dashboard-status { color: transparent }",
  ".card { display: none }",
  ".card /deep/ span { color: red }",
 ]) await assert.rejects(() => scopeThemeCss(css), /not allowed|cannot hide|network-loading|non-fragment|required dashboard|shadow-piercing/);
});

test("each build contains only its selected theme adapter", async () => {
 const { config } = await compileProject((await copyProject()).dashboard);
 for (const [theme, marker] of [["neutral", "neutral@built-in"], ["daisyui", "daisyui@5.2.1"], ["siemens-ix", "siemens-ix@5.2.1"]]) {
  const selected = { ...config, theme };
  delete selected.themeCss;
  const { html } = await renderDashboard({ config: selected });
  assert.match(html, new RegExp(`featherbi-theme:${marker}`));
  assert.equal(["neutral@built-in", "daisyui@5.2.1", "siemens-ix@5.2.1"].filter((name) => html.includes(`featherbi-theme:${name}`)).length, 1);
  assert.match(html, /id="dashboard-status"/);
  assert.match(html, /id="dashboard-sources"/);
 }
});

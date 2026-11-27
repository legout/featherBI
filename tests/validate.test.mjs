import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");

const base = () => ({
  title: "V",
  name: "v",
  sources: { sales: { read: "read_parquet('sales.parquet')" }, targets: { read: "read_parquet('targets.parquet')" } },
  dims: { region: { col: "region", cols: { targets: "region_code" } }, channel: { col: "channel" } },
  date: { col: "order_date", default: "all" },
  tiles: [{ id: "rev", type: "kpi", title: "Revenue", sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}" }],
});
const tile = t => c => (c.tiles = [{ id: "t1", title: "T", ...t }]);
// Spec 0005 §5: `sections` in place of `tiles`. `kpiTile` is a tile that is valid on its own.
const kpiTile = (id, more) => ({ id, type: "kpi", title: id, sql: "SELECT 1 AS value", ...more });
const sections = (...list) => c => {
  delete c.tiles;
  c.sections = list;
};

// [name, config change, CLI args, expected message]
const cases = [
  ["unknown tile type", tile({ type: "gantt", sql: "SELECT 1" }), [], /tile "?t1"?.*type.*gantt/is],
  ["unknown preset", tile({ type: "echarts", preset: "spiral", sql: "SELECT 1 AS x, 1 AS y" }), [], /tile "?t1"?.*preset.*spiral/is],
  ["kpi without value column", tile({ type: "kpi", sql: "SELECT 1 AS total" }), [], /tile "?t1"?.*missing.*value/is],
  ["kpi spark without y", tile({ type: "kpi", sql: "SELECT 1 AS value", spark: "SELECT 1 AS x" }), [], /tile "?t1"?.*missing.*y/is],
  ["donut without value", tile({ type: "echarts", preset: "donut", sql: "SELECT region AS name FROM sales" }), [], /tile "?t1"?.*missing.*value/is],
  ["pareto without y", tile({ type: "echarts", preset: "pareto", sql: "SELECT region AS x FROM sales" }), [], /tile "?t1"?.*missing.*"y"/is],
  ["histogram without hi", tile({ type: "echarts", preset: "histogram", sql: "SELECT 100 AS lo, 3 AS count" }), [], /tile "?t1"?.*missing.*"hi"/is],
  ["candlestick without close", tile({ type: "echarts", preset: "candlestick", sql: "SELECT 'd1' AS x, 1 AS open, 3 AS high, 0 AS low" }), [], /tile "?t1"?.*missing.*"close"/is],
  ["timeline without end", tile({ type: "echarts", preset: "timeline", sql: "SELECT 'M1' AS name, TIMESTAMP '2025-01-06 08:00' AS start" }), [], /tile "?t1"?.*missing.*"end"/is],
  ["pivot without v", tile({ type: "pivot", sql: "SELECT region AS r, channel AS c FROM sales" }), [], /tile "?t1"?.*missing.*v/is],
  ["click on undeclared dim", tile({ type: "echarts", preset: "bar", click: "country", sql: "SELECT region AS x, 1 AS y FROM sales" }), [], /tile "?t1"?.*click.*country.*not declared/is],
  ["table column not in source", tile({ type: "table", source: "sales", columns: ["region", "profit"] }), [], /tile "?t1"?.*profit.*not.*sales/is],
  ["table source unknown", tile({ type: "table", source: "nope", columns: ["x"] }), [], /tile "?t1"?.*source.*nope/is],
  // Spec 0005 §1: a table has exactly one of `source` and `sql`; `columns` belongs to `source`.
  ["table with both source and sql", tile({ type: "table", source: "sales", columns: ["region"], sql: "SELECT region FROM sales" }), [], /tile "?t1"?.*`source`.*`sql`.*not both/is],
  ["table with neither source nor sql", tile({ type: "table" }), [], /tile "?t1"?.*needs.*`source` or `sql`/is],
  ["table with columns and sql", tile({ type: "table", sql: "SELECT region FROM sales", columns: ["region"] }), [], /tile "?t1"?.*`columns`.*not allowed.*`sql`/is],
  // `constructor` is on every object: only the config's own `dims` keys are declared.
  ["sql table click on undeclared dim", tile({ type: "table", click: "constructor", sql: "SELECT region FROM sales" }), [], /tile "?t1"?.*click.*constructor.*not declared/is],
  ["sql table outside the snapshot", tile({ type: "table", sql: "SELECT * FROM other_table" }), [], /tile "?t1"?.*other_table/is],
  ["SQL that fails", tile({ type: "kpi", sql: "SELECT SUM(nope) AS value FROM sales" }), [], /tile "?t1"?.*nope/is],
  ["table outside the snapshot", tile({ type: "kpi", sql: "SELECT count(*) AS value FROM other_table" }), [], /tile "?t1"?.*other_table/is],
  ["file access", tile({ type: "kpi", sql: "SELECT count(*) AS value FROM read_csv('sales.parquet')" }), [], /tile "?t1"?.*(disabled|permission|external)/is],
  ["extension use", tile({ type: "kpi", sql: "SELECT count(*) AS value FROM read_xlsx('x.xlsx')" }), [], /tile "?t1"?/is],
  [
    "aliased join with an unqualified placeholder",
    tile({ type: "kpi", sql: "SELECT SUM(s.revenue) AS value FROM sales s JOIN targets t ON s.region = t.region WHERE {{filters:sales}}" }),
    [],
    /tile "?t1"?.*ambiguous/is,
  ],
  ["placeholder for an unknown table", tile({ type: "kpi", sql: "SELECT 1 AS value WHERE {{filters:ghost}}" }), [], /tile "?t1"?.*ghost/is],
  // Spec 0005 §2: `locale` and the `format` object.
  ["a locale Intl does not support", c => (c.locale = "xx-XX"), [], /locale.*xx-XX/is],
  ["a malformed locale tag", c => (c.locale = "de_DE"), [], /locale.*de_DE/is],
  ["an unknown format style", tile({ type: "kpi", sql: "SELECT 1 AS value", format: { style: "money" } }), [], /tile "?t1"?.*format.*style/is],
  ["an unknown format style on a tile without an id", c => (c.tiles = [c.tiles[0], { type: "kpi", sql: "SELECT 1 AS value", format: { style: "money" } }]), [], /tile "?tile 2"?.*format.*style/is],
  ["an unknown format name", tile({ type: "kpi", sql: "SELECT 1 AS value", format: "money" }), [], /tile "?t1"?.*format.*money/is],
  ["format decimals above 6", tile({ type: "kpi", sql: "SELECT 1 AS value", format: { decimals: 7 } }), [], /tile "?t1"?.*decimals/is],
  ["format decimals below 0", tile({ type: "pivot", sql: "SELECT 1 AS r, 1 AS c, 1 AS v", format: { decimals: -1 } }), [], /tile "?t1"?.*decimals/is],
  ["a currency code that is not three letters", tile({ type: "kpi", sql: "SELECT 1 AS value", format: { style: "currency", currency: "EURO" } }), [], /tile "?t1"?.*format.*currency/is],
  ["a dimension named date", c => (c.dims.date = { col: "order_date" }), [], /dims.*date|date.*dimension/is],
  // Spec 0005 §5: every build rejection, and tile errors that name the section and the tile.
  ["both tiles and sections", c => (c.sections = [{ title: "A", tiles: [kpiTile("a")] }]), [], /`tiles`.*`sections`/is],
  ["neither tiles nor sections", c => delete c.tiles, [], /`tiles`.*`sections`/is],
  ["layout without sections", c => (c.layout = "tabs"), [], /`layout`.*`sections`/is],
  ["an unknown layout", c => (sections({ title: "A", tiles: [kpiTile("a")] })(c), (c.layout = "grid")), [], /layout.*stack.*tabs/is],
  ["a section without a title", sections({ title: "A", tiles: [kpiTile("a")] }, { tiles: [kpiTile("b")] }), [], /section 2.*`title`/is],
  ["a section with an empty title", sections({ title: "", tiles: [kpiTile("a")] }), [], /section 1.*title/is],
  ["a section without tiles", sections({ title: "A", tiles: [kpiTile("a")] }, { title: "B" }), [], /section "B".*`tiles`/is],
  ["a section with no tile", sections({ title: "A", tiles: [kpiTile("a")] }, { title: "B", tiles: [] }), [], /section "B".*tiles.*at least 1/is],
  ["a duplicate section title", sections({ title: "A", tiles: [kpiTile("a")] }, { title: "A", tiles: [kpiTile("b")] }), [], /section "A".*title.*more than one/is],
  ["a tile id used in two sections", sections({ title: "A", tiles: [kpiTile("rev")] }, { title: "B", tiles: [kpiTile("rev")] }), [], /section "B", tile "rev".*id.*more than one/is],
  ["a dimension named tab", c => (c.dims.tab = { col: "channel" }), [], /dims.*`tab`.*reserved/is],
  ["a tile error in a section", sections({ title: "A", tiles: [kpiTile("a")] }, { title: "Detail", tiles: [kpiTile("t1", { type: "echarts", preset: "spiral" })] }), [], /section "Detail", tile "t1".*preset.*spiral/is],
  ["a SQL error in a section tile without an id", sections({ title: "A", tiles: [kpiTile("a")] }, { title: "Detail", tiles: [kpiTile("b"), { type: "kpi", sql: "SELECT SUM(nope) AS value FROM sales" }] }), [], /section "Detail", tile "tile 2".*nope/is], // numbered within its section
  ["a schema error in a section tile", sections({ title: "Detail", tiles: [kpiTile("t1", { format: { style: "money" } })] }), [], /section "Detail", tile "t1".*format.*style/is],
  ["--offline with --split", () => {}, ["--offline", "--split"], /--offline.*--split|--split.*--offline/is],
  ["--offline with engine duckdb-wasm", c => (c.engine = "duckdb-wasm"), ["--offline"], /--offline.*duckdb-wasm/is],
  ...["data", "dataset", "datasetIndex", "encode", "links", "nodes", "source"].map(k => [
    `option key binds data: ${k}`,
    tile({ type: "echarts", preset: "bar", sql: "SELECT region AS x, 1 AS y FROM sales", option: { [k]: [] } }),
    [],
    new RegExp(`tile "?t1"?.*option.*"${k}".*data`, "is"),
  ]),
];

for (const [name, change, args, expected] of cases) {
  test(`build rejects: ${name}`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
    try {
      fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(tmp, "sales.parquet"));
      execFileSync("duckdb", ["-no-agent", "-c", "COPY (SELECT 'EU' AS region, 'EU' AS region_code, 100 AS target) TO 'targets.parquet'"], { cwd: tmp });
      const config = base();
      change(config);
      fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify(config));
      const r = spawnSync("node", [cli, "build", "dashboard.yaml", ...args], { cwd: tmp, encoding: "utf8" });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, expected);
      assert.equal(fs.existsSync(path.join(tmp, "dist")), false, "no dist output");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test("a valid config with filters, an alias and a join builds", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  try {
    fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(tmp, "sales.parquet"));
    execFileSync("duckdb", ["-no-agent", "-c", "COPY (SELECT 'EU' AS region, 'EU' AS region_code, 100 AS target) TO 'targets.parquet'"], { cwd: tmp });
    const config = base();
    config.locale = "de-DE";
    config.tiles[0].format = { style: "currency", currency: "EUR", decimals: 6, unit: "net" };
    config.tiles.push(
      { id: "share", type: "kpi", title: "Share", format: "percent", sql: "SELECT 0.25 AS value" },
      {
        id: "bar",
        type: "echarts",
        preset: "bar",
        title: "Bar",
        click: "region",
        sql: "SELECT s.region AS x, SUM(s.revenue) AS y, 'revenue' AS series FROM sales s WHERE {{filters:sales AS s}} GROUP BY 1 UNION ALL SELECT region_code, target, 'target' FROM targets WHERE {{filters:targets}}",
      },
      { id: "tbl", type: "table", title: "Rows", source: "sales", columns: ["order_date", "region", "revenue"] },
      { id: "sqltbl", type: "table", title: "By region", click: "region", sql: "SELECT region, SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1" },
    );
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify(config));
    const r = spawnSync("node", [cli, "build", "dashboard.yaml"], { cwd: tmp, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(tmp, "dist", "v.html")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a styling-only option still builds", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  try {
    fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(tmp, "sales.parquet"));
    execFileSync("duckdb", ["-no-agent", "-c", "COPY (SELECT 'EU' AS region, 'EU' AS region_code, 100 AS target) TO 'targets.parquet'"], { cwd: tmp });
    const config = base();
    config.tiles.push({ id: "styled", type: "echarts", preset: "bar", title: "Styled", sql: "SELECT region AS x, 1 AS y FROM sales", option: { series: [{ name: "Revenue", itemStyle: { color: "#c0392b" } }] } });
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify(config));
    const r = spawnSync("node", [cli, "build", "dashboard.yaml"], { cwd: tmp, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(tmp, "dist", "v.html")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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

// [name, config change, CLI args, expected message]
const cases = [
  ["unknown tile type", tile({ type: "gantt", sql: "SELECT 1" }), [], /tile "?t1"?.*type.*gantt/is],
  ["unknown preset", tile({ type: "echarts", preset: "spiral", sql: "SELECT 1 AS x, 1 AS y" }), [], /tile "?t1"?.*preset.*spiral/is],
  ["kpi without value column", tile({ type: "kpi", sql: "SELECT 1 AS total" }), [], /tile "?t1"?.*missing.*value/is],
  ["kpi spark without y", tile({ type: "kpi", sql: "SELECT 1 AS value", spark: "SELECT 1 AS x" }), [], /tile "?t1"?.*missing.*y/is],
  ["donut without value", tile({ type: "echarts", preset: "donut", sql: "SELECT region AS name FROM sales" }), [], /tile "?t1"?.*missing.*value/is],
  ["pivot without v", tile({ type: "pivot", sql: "SELECT region AS r, channel AS c FROM sales" }), [], /tile "?t1"?.*missing.*v/is],
  ["click on undeclared dim", tile({ type: "echarts", preset: "bar", click: "country", sql: "SELECT region AS x, 1 AS y FROM sales" }), [], /tile "?t1"?.*click.*country.*not declared/is],
  ["table column not in source", tile({ type: "table", source: "sales", columns: ["region", "profit"] }), [], /tile "?t1"?.*profit.*not.*sales/is],
  ["table source unknown", tile({ type: "table", source: "nope", columns: ["x"] }), [], /tile "?t1"?.*source.*nope/is],
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
  ["--offline with --split", () => {}, ["--offline", "--split"], /--offline.*--split|--split.*--offline/is],
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
    config.tiles.push(
      {
        id: "bar",
        type: "echarts",
        preset: "bar",
        title: "Bar",
        click: "region",
        sql: "SELECT s.region AS x, SUM(s.revenue) AS y, 'revenue' AS series FROM sales s WHERE {{filters:sales AS s}} GROUP BY 1 UNION ALL SELECT region_code, target, 'target' FROM targets WHERE {{filters:targets}}",
      },
      { id: "tbl", type: "table", title: "Rows", source: "sales", columns: ["order_date", "region", "revenue"] },
    );
    fs.writeFileSync(path.join(tmp, "dashboard.yaml"), JSON.stringify(config));
    const r = spawnSync("node", [cli, "build", "dashboard.yaml"], { cwd: tmp, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(tmp, "dist", "v.html")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

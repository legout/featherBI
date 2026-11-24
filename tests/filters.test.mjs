import assert from "node:assert/strict";
import test from "node:test";
import { defaultRange, expand } from "../skill/featherbi/scripts/lib/filters.mjs";

// Expected SQL and params are hand-written from spec 0001 §Filters.
const dims = { region: { col: "region", cols: { targets: "region_code" } }, channel: { col: "channel" } };
const date = { col: "order_date", cols: { targets: "month" } };
const tableColumns = { sales: ["order_date", "region", "channel", "revenue"], targets: ["region_code", "month", "target"], notes: ["id", "text"] };
const none = { dims: {}, from: null, to: null };
const run = (sql, state, exclude) => expand(sql, state, dims, date, tableColumns, exclude);

test("no active filter expands to TRUE", () => {
  assert.deepEqual(run("SELECT 1 FROM sales WHERE {{filters:sales}}", none), { sql: "SELECT 1 FROM sales WHERE TRUE", params: [] });
});

test("one dimension is bound as a parameter", () => {
  assert.deepEqual(run("WHERE {{filters:sales}}", { ...none, dims: { region: "EU" } }), { sql: 'WHERE "region" = $1', params: ["EU"] });
});

test("an alias qualifies the columns", () => {
  assert.deepEqual(run("FROM sales s WHERE {{filters:sales AS s}}", { ...none, dims: { channel: "Online" } }), { sql: 'FROM sales s WHERE "s"."channel" = $1', params: ["Online"] });
});

test("a table without the dimension is not filtered by it", () => {
  assert.deepEqual(run("WHERE {{filters:notes}}", { dims: { region: "EU" }, from: "2025-01-01", to: "2025-03-31" }), { sql: "WHERE TRUE", params: [] });
});

test("two tables: per-table cols, one placeholder per table, parameters in text order", () => {
  const state = { dims: { region: "EU", channel: "Online" }, from: "2025-01-01", to: "2025-03-31" };
  assert.deepEqual(run("FROM sales s JOIN targets t ON 1=1 WHERE {{filters:sales AS s}} AND {{filters:targets AS t}}", state), {
    sql:
      'FROM sales s JOIN targets t ON 1=1 WHERE "s"."region" = $1 AND "s"."channel" = $2 AND CAST("s"."order_date" AS DATE) BETWEEN CAST($3 AS DATE) AND CAST($4 AS DATE)' +
      ' AND "t"."region_code" = $5 AND CAST("t"."month" AS DATE) BETWEEN CAST($6 AS DATE) AND CAST($7 AS DATE)',
    params: ["EU", "Online", "2025-01-01", "2025-03-31", "EU", "2025-01-01", "2025-03-31"],
  });
});

test("exclude drops that dimension, and only that one", () => {
  const state = { dims: { region: "EU", channel: "Online" }, from: null, to: null };
  assert.deepEqual(run("WHERE {{filters:sales}}", state, ["region"]), { sql: 'WHERE "channel" = $1', params: ["Online"] });
});

test("an unknown table or placeholder is an error", () => {
  assert.throws(() => run("{{filters:ghost}}", none), /ghost/);
  assert.throws(() => run("{{nope}}", none), /nope/);
});

test("the date anchor is the latest date across all dated tables", () => {
  const bounds = [{ min: "2025-01-05", max: "2025-03-25" }, { min: "2024-11-01", max: "2025-06-10" }];
  // 12 calendar months ending in the month of the latest date (June 2025): July 2024 .. 2025-06-10.
  assert.deepEqual(defaultRange({ default: "last_12_months" }, bounds), { from: "2024-07-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({}, bounds), { from: "2024-07-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({ default: "all" }, bounds), { from: "2024-11-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({ default: { from: "2025-02-01", to: "2025-02-28" } }, bounds), { from: "2025-02-01", to: "2025-02-28" });
  assert.deepEqual(defaultRange({ default: "all" }, []), { from: null, to: null });
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../skill/featherbi/scripts/lib/config.mjs";
import { snapshot } from "../skill/featherbi/scripts/lib/sources.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "formats");
const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
const rows = Number(readme.match(/- rows: (\d+)/)[1]);
const sum = Number(readme.match(/- sum: ([\d.]+)/)[1]);

const sources = {
  csv: { read: "read_csv('items.csv')" },
  json: { read: "read_json('items.json')" },
  parquet: { read: "read_parquet('items.parquet')" },
  xlsx: { read: "read_xlsx('items.xlsx')" },
  sqlite: { attach: "sqlite:items.sqlite", table: "items" },
  delta: { read: "delta_scan('delta')" },
  iceberg: { read: "iceberg_scan('iceberg/ns/items', allow_moved_paths = true)" },
  ducklake: { attach: "ducklake:items.ducklake", table: "items" },
  sql: { attach: "sqlite:items.sqlite", sql: "SELECT * FROM items WHERE id > 0" },
};

test("every format fixture reaches its snapshot with the README count and sum", () => {
  const tables = snapshot(sources, dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sources-test-"));
  try {
    for (const name of Object.keys(sources)) {
      const file = path.join(tmp, `${name}.parquet`);
      fs.writeFileSync(file, tables[name]);
      const q = `SELECT count(*)::INT AS n, sum(amount::DOUBLE) AS s, list(__row ORDER BY id) AS r, list(id) = list(id ORDER BY id) AS sorted FROM '${file}'`;
      const [got] = JSON.parse(execFileSync("duckdb", ["-json", "-c", q], { encoding: "utf8" }));
      assert.deepEqual([got.n, got.s], [rows, sum], name);
      assert.deepEqual(got.r, [1, 2, 3, 4, 5], `${name}: __row follows ORDER BY ALL`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a config key that looks like a credential is refused", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sources-test-"));
  try {
    for (const key of ["password", "secret", "key_id", "token", "S3_Secret_Key"]) {
      const file = path.join(tmp, "d.yaml");
      fs.writeFileSync(
        file,
        `title: T\nsources:\n  a:\n    read: "read_csv('x.csv')"\n    ${key}: hunter2\ntiles:\n  - {type: kpi, title: K, sql: "SELECT 1 AS value"}\n`,
      );
      assert.throws(() => loadConfig(file), new RegExp(`credential.*${key}|${key}.*credential`, "i"), key);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("profile prints schema, count and 5 samples per column as JSON", () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skill", "featherbi", "scripts", "featherbi.mjs");
  const out = execFileSync("node", [cli, "profile", "items.parquet", "read_csv('items.csv')"], { cwd: dir, encoding: "utf8" });
  const [a, b] = JSON.parse(out);
  assert.equal(a.source, "items.parquet");
  assert.equal(b.count, rows);
  assert.deepEqual(a.schema.map(c => c.name), ["id", "name", "amount"]);
  assert.equal(a.samples.name.length, 5);
  assert.deepEqual([...a.samples.id].sort(), [1, 2, 3, 4, 5]);
});

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skill", "featherbi", "scripts", "featherbi.mjs");
const handDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "hand");

test("profile reports nulls, distinct, min/max, top values and date step (spec 0004 acceptance 1)", () => {
  const [p] = JSON.parse(execFileSync("node", [cliPath, "profile", "sales.parquet"], { cwd: handDir, encoding: "utf8" }));
  const col = n => p.schema.find(c => c.name === n);
  assert.equal(p.count, 12);
  assert.equal(p.sampled, undefined);
  assert.deepEqual([col("revenue").min, col("revenue").max, col("revenue").nulls, col("revenue").distinct], ["100.00", "270.00", 0, 12]);
  assert.deepEqual(col("region").top, [{ value: "EU", count: 6 }, { value: "US", count: 6 }]);
  const d = col("order_date");
  assert.deepEqual([d.min, d.max, d.distinct, d.step], ["2025-01-05", "2025-03-25", 9, "10 days"]);
});

test("profile samples sources above 5 M rows but keeps the exact count", () => {
  const [p] = JSON.parse(execFileSync("node", [cliPath, "profile", "(SELECT range AS id FROM range(6000000))"], { encoding: "utf8" }));
  assert.equal(p.sampled, true);
  assert.equal(p.count, 6000000);
  assert.equal(p.schema[0].distinct_approx, true);
});

const profileOf = (expr, env = {}) => JSON.parse(execFileSync("node", [cliPath, "profile", expr], { encoding: "utf8", env: { ...process.env, ...env } }))[0];
const colOf = (p, n) => p.schema.find(c => c.name === n);

test("profile classifies by scalar type: DATE[], INTERVAL and BIGNUM", () => {
  const p = profileOf("(SELECT [DATE '2025-01-01'] AS dl, INTERVAL 1 DAY AS iv, 5::BIGNUM AS bn)");
  for (const n of ["dl", "iv"]) for (const k of ["min", "max", "step"]) assert.equal(colOf(p, n)[k], undefined, `${n}.${k}`);
  assert.deepEqual([colOf(p, "bn").min, colOf(p, "bn").max].map(String), ["5", "5"]);
});

test("profile offers top for exactly-50-value text even when distinct is approximate", () => {
  // 200 000 rows, every one of 50 values 4 000 times: top must list 10 entries of 4000.
  const p = profileOf("(SELECT 'v' || lpad((range % 50)::VARCHAR, 2, '0') AS t FROM range(200000))");
  const t = colOf(p, "t");
  assert.equal(t.distinct_approx, true);
  assert.equal(t.top.length, 10);
  assert.deepEqual(t.top[0], { value: "v00", count: 4000 });
});

test("profile step for TIMESTAMPTZ is the gap between instants across DST", () => {
  // Three hourly UTC instants span the 2025-03-30 spring-forward in Europe/Berlin (local gaps 2h, 1h): the instant gap is 1 hour.
  const p = profileOf("(SELECT TIMESTAMPTZ '2025-03-30 00:00:00+00' + INTERVAL (range) HOUR AS t FROM range(3))", { TZ: "Europe/Berlin" });
  assert.equal(colOf(p, "t").step, "01:00:00");
});

test("profile reports BIGINT min and max without precision loss", () => {
  const p = profileOf("(SELECT 9007199254740993::BIGINT AS b UNION ALL SELECT 9007199254740995::BIGINT)");
  assert.deepEqual([colOf(p, "b").min, colOf(p, "b").max].map(String), ["9007199254740993", "9007199254740995"]);
});

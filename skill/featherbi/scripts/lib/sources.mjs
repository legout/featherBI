// Source phase: the native DuckDB CLI reads each source and writes one snapshot table as Parquet.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Secrets come only from the environment or DuckDB secrets, never from the config.
export const CREDENTIAL_KEY = /password|passwd|secret|key_id|token/i;

const quote = s => `'${s.replaceAll("'", "''")}'`;
const ident = s => `"${s.replaceAll('"', '""')}"`;

// Extensions a source needs, found from its table expression or attach prefix.
const EXTENSIONS = [
  [/delta_scan/i, "delta"],
  [/iceberg_scan/i, "iceberg"],
  [/read_xlsx/i, "excel"],
  [/^sqlite:/i, "sqlite_scanner"],
  [/^postgres:/i, "postgres_scanner"],
  [/^ducklake:/i, "ducklake"],
];

function run(args, cwd) {
  try {
    return execFileSync("duckdb", ["-no-agent", ...args], { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("the DuckDB CLI (>= 2.0) was not found on PATH");
    throw new Error("DuckDB could not read the source (its error is above)");
  }
}

// Returns { prelude, query }: statements that open the source, and the SELECT that reads it.
function plan(spec) {
  const key = spec.read ?? spec.attach;
  const prelude = EXTENSIONS.filter(([re]) => re.test(key)).map(([, ext]) => `INSTALL ${ext}; LOAD ${ext};`);
  if (spec.read) return { prelude: prelude.join(" "), query: `SELECT * FROM ${spec.read}` };
  prelude.push(`ATTACH ${quote(spec.attach)} AS src (READ_ONLY); USE src;`);
  const query = spec.table ? `SELECT * FROM src.${ident(spec.table)}` : spec.sql.trim().replace(/;+$/, "");
  return { prelude: prelude.join(" "), query };
}

export function snapshot(sources, cwd) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-"));
  try {
    const tables = {};
    for (const [name, spec] of Object.entries(sources)) {
      const file = path.join(tmp, `${name}.parquet`);
      const { prelude, query } = plan(spec);
      // A fixed row order and fixed Parquet options keep the snapshot identical between builds.
      // __row is the row number after ORDER BY ALL.
      const sql =
        `${prelude} COPY (SELECT *, row_number() OVER () AS __row FROM (${query} ORDER BY ALL) ORDER BY __row) TO ${quote(file)} ` +
        "(FORMAT parquet, PARQUET_VERSION v1, COMPRESSION zstd, ROW_GROUP_SIZE 122880)";
      try {
        run(["-c", sql], cwd);
      } catch (e) {
        throw new Error(`source "${name}": ${e.message}`);
      }
      tables[name] = fs.readFileSync(file);
    }
    return tables;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// `profile` arguments are table expressions; a bare path is read as a file.
export function profile(exprs, cwd) {
  return exprs.map(expr => {
    const spec = { read: /[(]/.test(expr) ? expr : quote(expr) };
    const { prelude, query } = plan(spec);
    const q = sql => JSON.parse(run(["-json", "-c", `${prelude} ${sql}`], cwd) || "[]");
    const schema = q(`SELECT column_name AS name, column_type AS type FROM (DESCRIBE ${query})`);
    const [{ n }] = q(`SELECT count(*)::BIGINT AS n FROM (${query})`);
    // Above 5 M rows the per-column statistics use a fixed-seed 1 M-row sample; count stays exact.
    const sampled = Number(n) > 5_000_000;
    const base = sampled ? `(SELECT * FROM (${query}) USING SAMPLE 1000000 ROWS (reservoir, 42))` : `(${query})`;
    const total = sampled ? 1_000_000 : Number(n);
    const samples = {};
    for (const { name, type } of schema) {
      const c = ident(name);
      samples[name] = q(`SELECT DISTINCT ${c} AS v FROM (${query}) WHERE ${c} IS NOT NULL ORDER BY v LIMIT 5`).map(r => r.v);
      const approx = total > 100_000;
      const [s] = q(
        `SELECT (count(*) - count(${c}))::DOUBLE / nullif(count(*), 0) AS nulls, ` +
          `${approx ? `approx_count_distinct(${c})` : `count(DISTINCT ${c})`}::BIGINT AS distinct, ${/^U?(BIG|HUGE)INT$|^BIGNUM$/.test(type) ? `min(${c})::VARCHAR AS min, max(${c})::VARCHAR AS max` : `min(${c}) AS min, max(${c}) AS max`} FROM ${base}`,
      );
      const isTz = type === "TIMESTAMP WITH TIME ZONE";
      const isTime = isTz || /^(DATE|TIMESTAMP(_S|_MS|_NS)?)$/.test(type);
      const col = { nulls: s.nulls ?? 0, distinct: Number(s.distinct) };
      if (approx) col.distinct_approx = true;
      if (isTime || /^(DECIMAL\(\d+,\d+\)|U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|DOUBLE|FLOAT|REAL|BIGNUM)$/.test(type)) Object.assign(col, { min: s.min, max: s.max });
      if (type === "VARCHAR") {
        // 51 rows tell exactly whether the column has <= 50 distinct values, even when `distinct` is approximate.
        const top = q(`SELECT ${c} AS value, count(*)::BIGINT AS count FROM ${base} WHERE ${c} IS NOT NULL GROUP BY ALL ORDER BY count DESC, value LIMIT 51`);
        if (top.length <= 50) col.top = top.slice(0, 10);
      }
      if (isTime) {
        const [g] = q(
          `SELECT median(g)::VARCHAR AS step FROM (SELECT d - lag(d) OVER (ORDER BY d) AS g FROM (SELECT DISTINCT ${isTz ? c : `${c}::TIMESTAMP`} AS d FROM ${base} WHERE ${c} IS NOT NULL))`,
        );
        if (g?.step) col.step = g.step;
      }
      Object.assign(schema.find(x => x.name === name), col);
    }
    return { source: expr, schema, count: Number(n), ...(sampled && { sampled }), samples };
  });
}

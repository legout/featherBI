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
    const samples = {};
    for (const { name } of schema) {
      const c = ident(name);
      samples[name] = q(`SELECT DISTINCT ${c} AS v FROM (${query}) WHERE ${c} IS NOT NULL ORDER BY v LIMIT 5`).map(r => r.v);
    }
    return { source: expr, schema, count: Number(n), samples };
  });
}

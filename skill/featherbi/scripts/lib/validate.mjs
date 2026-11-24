// Build-time validation: schema, then every tile SQL run natively and sandboxed against the snapshot only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildModel, expand } from "./filters.mjs";

const asset = file => new URL(`../../${file}`, import.meta.url);
const quote = s => `'${String(s).replaceAll("'", "''")}'`;
const ident = s => `"${String(s).replaceAll('"', '""')}"`;

// Small JSON-Schema subset: only the keywords dashboard.schema.json uses.
function check(value, schema, at, errors) {
  const kind = v => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  const types = [].concat(schema.type ?? []);
  if (types.length && !types.includes(kind(value))) return errors.push(`${at}: must be ${types.join(" or ")}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    value.forEach((v, i) => schema.items && check(v, schema.items, `${at}[${i}]`, errors));
  }
  if (kind(value) === "object") {
    const keys = Object.keys(value).filter(k => value[k] !== undefined);
    if (schema.minProperties && keys.length < schema.minProperties) errors.push(`${at}: needs at least ${schema.minProperties} entry`);
    for (const r of schema.required ?? []) if (!(r in value)) errors.push(`${at}: \`${r}\` is required`);
    for (const k of keys) {
      const sub = schema.properties?.[k] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined);
      if (sub) check(value[k], sub, `${at}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown key \`${k}\``);
    }
  }
}

// Native DuckDB over one read-only database of the snapshot tables, with the sandbox settings locked.
function session(db) {
  return (sql, { sandbox = true, csv = false } = {}) => {
    const lock = "SET autoload_known_extensions=false; SET autoinstall_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true;";
    const r = spawnSync("duckdb", ["-no-agent", "-readonly", csv ? "-csv" : "-json", db, "-c", `${sandbox ? lock : ""} ${sql}`], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.error) throw new Error(r.error.code === "ENOENT" ? "the DuckDB CLI (>= 2.0) was not found on PATH" : r.error.message);
    if (r.status !== 0) return { error: (r.stderr.trim().split("\n")[0] || "DuckDB failed").replace(/^[A-Za-z ]*Error: /, "") };
    return csv ? { header: r.stdout.split("\n")[0].split(",").map(c => c.replace(/^"|"$/g, "")) } : { rows: JSON.parse(r.stdout || "[]") };
  };
}

const lit = v => (typeof v === "number" ? String(v) : quote(v));

// The shared expansion, then the query is prepared with the sample values bound; returns the result's column names.
function columnsOf(q, sql, params) {
  const r = q(`PREPARE r AS SELECT * FROM (${sql}); EXECUTE r(${params.map(lit).join(", ")});`, { csv: true });
  return r.error ? r : { have: r.header };
}

export function validate(config, snapshots) {
  const errors = [];
  check(config, JSON.parse(fs.readFileSync(asset("schema/dashboard.schema.json"), "utf8")), "config", errors);
  if (errors.length) throw new Error(`invalid config: ${errors.join("; ")}`);

  const presets = Object.fromEntries(
    fs.readdirSync(asset("assets/presets")).map(f => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(asset(`assets/presets/${f}`), "utf8"))]),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-validate-"));
  try {
    // A fresh database holds only the snapshot tables; it is opened read-only afterwards.
    const db = path.join(tmp, "snapshot.duckdb");
    const create = Object.entries(snapshots).map(([name, bytes]) => {
      const f = path.join(tmp, `${name}.parquet`);
      fs.writeFileSync(f, bytes);
      return `CREATE TABLE ${ident(name)} AS SELECT * FROM read_parquet(${quote(f)});`;
    });
    const made = spawnSync("duckdb", ["-no-agent", db, "-c", create.join(" ")], { encoding: "utf8" });
    if (made.status !== 0) throw new Error(`could not load the snapshot: ${made.stderr.trim()}`);
    const q = session(db);
    const must = r => (r.error ? (() => { throw new Error(r.error); })() : r.rows);

    const columns = {};
    for (const { table_name: t, column_name: c } of must(q("SELECT table_name, column_name FROM information_schema.columns ORDER BY ordinal_position", { sandbox: false }))) (columns[t] ??= []).push(c);

    // Select options and the default date range, computed once; the first option of each dimension is the sample value.
    const model = buildModel(config, columns, sql => must(q(sql)));
    const noop = { dims: {}, from: null, to: null };
    const sample = { dims: Object.fromEntries(Object.entries(model.options).filter(([, v]) => v.length).map(([k, v]) => [k, v[0]])), ...model.range };

    config.tiles.forEach((tile, i) => {
      const id = tile.id ?? `tile ${i + 1}`;
      const fail = msg => { throw new Error(`tile "${id}": ${msg}`); };
      const preset = tile.type === "echarts" ? presets[tile.preset] : null;
      if (!["kpi", "echarts", "pivot", "table", "text"].includes(tile.type)) fail(`unknown type "${tile.type}"`);
      if (tile.type === "echarts" && !preset) fail(`unknown preset "${tile.preset}"`);
      for (const dim of [].concat(tile.click ?? [])) if (!(dim in (config.dims ?? {}))) fail(`click on "${dim}", which is not declared in \`dims\``);

      if (tile.type === "table") {
        if (!(tile.source in columns)) fail(`source "${tile.source}" is not a source`);
        if (!Array.isArray(tile.columns) || !tile.columns.length) fail("a table needs `columns`");
        for (const c of tile.columns) if (!columns[tile.source].includes(c)) fail(`column "${c}" is not in source "${tile.source}"`);
        return;
      }
      if (tile.type === "text") return;
      if (typeof tile.sql !== "string") fail("`sql` is required");

      const queries = [[tile.sql, preset ? preset.columns : tile.type === "kpi" ? ["value"] : ["r", "c", "v"]]];
      if (tile.compare) queries.push([tile.compare, ["value"]]);
      if (tile.spark) queries.push([tile.spark, ["x", "y"]]);
      for (const [sql, required] of queries) {
        for (const mode of ["noop", "sample"]) {
          let x;
          try {
            x = expand(sql, mode === "noop" ? noop : sample, model.dims, model.date, columns, tile.exclude);
          } catch (e) {
            fail(e.message);
          }
          const r = columnsOf(q, x.sql, x.params);
          if (r.error) fail(`SQL failed${mode === "sample" ? " with sample filter values" : ""}: ${r.error}`);
          const have = r.have;
          const missing = required.filter(c => !have.includes(c));
          if (missing.length) fail(`missing result column${missing.length > 1 ? "s" : ""} ${missing.map(c => `"${c}"`).join(", ")} (got ${have.join(", ") || "none"})`);
        }
      }
    });
    return model;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

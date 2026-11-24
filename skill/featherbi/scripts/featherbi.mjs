#!/usr/bin/env node
// featherBI: `build <dashboard.yaml>` turns a dashboard config into one HTML file.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { render } from "./lib/render.mjs";

// Source phase: the native DuckDB CLI reads each source and writes one snapshot table as Parquet.
function snapshot(sources, cwd) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-"));
  try {
    const tables = {};
    for (const [name, source] of Object.entries(sources)) {
      const file = path.join(tmp, `${name}.parquet`);
      // A fixed row order and fixed Parquet options keep the snapshot identical between builds.
      const sql =
        `COPY (SELECT * FROM ${source.read} ORDER BY ALL) TO '${file.replaceAll("'", "''")}' ` +
        "(FORMAT parquet, PARQUET_VERSION v1, COMPRESSION zstd, ROW_GROUP_SIZE 122880)";
      try {
        execFileSync("duckdb", ["-c", sql], { cwd, stdio: ["ignore", "ignore", "inherit"] });
      } catch (e) {
        if (e.code === "ENOENT") throw new Error("the DuckDB CLI (>= 2.0) was not found on PATH");
        throw new Error(`source "${name}": DuckDB could not read it (its error is above)`);
      }
      tables[name] = fs.readFileSync(file);
    }
    return tables;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  const [command, file] = positionals;
  if (command !== "build" || !file || positionals.length > 2) {
    throw new Error("usage: featherbi.mjs build <dashboard.yaml> [--out <path>]");
  }
  const config = loadConfig(file);
  // Source paths and the default output are relative to the config file, not to the caller's cwd.
  const dir = path.dirname(path.resolve(file));
  const out = values.out ? path.resolve(values.out) : path.join(dir, "dist", `${config.name}.html`);
  const html = render(config, snapshot(config.sources, dir));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(out);
} catch (e) {
  console.error(`featherbi: ${e.message}`);
  process.exit(1);
}

#!/usr/bin/env node
// featherBI: `build <dashboard.yaml>` turns a dashboard config into one HTML file (or a --split folder); `profile` describes sources.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { render } from "./lib/render.mjs";
import { profile, snapshot } from "./lib/sources.mjs";
import { validate } from "./lib/validate.mjs";

// A split folder may be new or empty, or hold only what an earlier featherBI split build wrote there (its index.html lists
// those files). Anything else is left as it is and the build stops before the first write. -> the files to replace.
function earlierBuild(out) {
  if (!fs.existsSync(out)) return [];
  if (!fs.statSync(out).isDirectory()) throw new Error(`--split: ${out} is a file; --out must name the folder to write`);
  const present = fs.readdirSync(out);
  const list = present.includes("index.html") && fs.readFileSync(path.join(out, "index.html"), "utf8").match(/<meta name="featherbi-split" content='([^']*)'>/);
  const meta = list ? JSON.parse(list[1]) : null; // { "<file>": sha-256 } of what the earlier build wrote there
  const ours = meta ? ["index.html", ...Object.keys(meta)] : [];
  const foreign = present.filter(file => !ours.includes(file));
  if (foreign.length) throw new Error(`--split: ${out} holds files a featherBI build did not write (${foreign.join(", ")}); nothing was written. Build into another folder, or remove them yourself`);
  // A listed file is only ours if its bytes still match the digest the earlier build recorded: a replaced export of the
  // same generated name is not.
  for (const [file, hash] of Object.entries(meta ?? {})) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(out, file))).digest("hex");
    if (actual !== hash) throw new Error(`--split: ${out} holds ${file}, which a featherBI build did not write (its bytes do not match the digest in index.html); nothing was written. Build into another folder, or remove it yourself`);
  }
  return present.map(file => path.join(out, file));
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, offline: { type: "boolean" }, split: { type: "boolean" } } });
  const [command, file] = positionals;
  if (command === "profile" && file) {
    console.log(JSON.stringify(profile(positionals.slice(1), process.cwd()), null, 2));
    process.exit(0);
  }
  if (command !== "build" || !file || positionals.length > 2) {
    throw new Error("usage: featherbi.mjs build <dashboard.yaml> [--out <path>] [--offline | --split] | profile <table expression or file>…");
  }
  if (values.offline && values.split) throw new Error("--offline and --split cannot be combined");
  const config = loadConfig(file);
  const mode = ["offline", "split"].find(flag => values[flag]) ?? "default";
  // Upstream duckdb-wasm loads its Parquet extension over HTTP inside its worker, with no way to hand it over: an offline
  // file of that engine could not read its own snapshot.
  if (mode === "offline" && config.engine !== "haybarn") throw new Error(`--offline is not available for engine "${config.engine}": only Haybarn can load its Parquet extension from the page`);
  // Source paths and the default output are relative to the config file, not to the caller's cwd.
  const dir = path.dirname(path.resolve(file));
  // --split writes a folder (index.html plus one Parquet file per snapshot); the other modes write one file.
  const target = mode === "split" ? config.name : `${config.name}.html`;
  const out = values.out ? path.resolve(values.out) : path.join(dir, "dist", target);
  const replace = mode === "split" ? earlierBuild(out) : [];
  const snapshots = snapshot(config.sources, dir);
  const filters = validate(config, snapshots);
  if (mode !== "split") {
    const mb = Object.values(snapshots).reduce((sum, bytes) => sum + bytes.length, 0) / 2 ** 20;
    if (mb > 25) console.error(`featherbi: warning: the embedded Parquet is ${mb.toFixed(1)} MB, above 25 MB, which makes the page slow to open and share. Build with --split, or aggregate in the source SQL.`);
  }
  const html = await render(config, snapshots, filters, mode);
  for (const file of replace) fs.rmSync(file); // only now, after every step that can fail has passed
  fs.mkdirSync(mode === "split" ? out : path.dirname(out), { recursive: true });
  if (mode === "split") {
    fs.writeFileSync(path.join(out, "index.html"), html);
    for (const [name, bytes] of Object.entries(snapshots)) fs.writeFileSync(path.join(out, `${name}.parquet`), bytes);
    console.log(`${path.join(out, "index.html")} (serve this folder, e.g. with python3 -m http.server; it does not open from file://)`);
  } else {
    fs.writeFileSync(out, html);
    console.log(`${out} (${(Buffer.byteLength(html) / 2 ** 20).toFixed(1)} MB)`);
  }
} catch (e) {
  console.error(`featherbi: ${e.message}`);
  process.exit(1);
}

#!/usr/bin/env node
// featherBI: `build <dashboard.yaml>` turns a dashboard config into one HTML file (or a --split folder); `profile` describes sources.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { render } from "./lib/render.mjs";
import { profile, snapshot } from "./lib/sources.mjs";
import { validate } from "./lib/validate.mjs";

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
  // Source paths and the default output are relative to the config file, not to the caller's cwd.
  const dir = path.dirname(path.resolve(file));
  // --split writes a folder (index.html plus one Parquet file per snapshot); the other modes write one file.
  const out = values.out ? path.resolve(values.out) : path.join(dir, "dist", values.split ? config.name : `${config.name}.html`);
  const snapshots = snapshot(config.sources, dir);
  const filters = validate(config, snapshots);
  if (!values.split) {
    const mb = Object.values(snapshots).reduce((sum, bytes) => sum + bytes.length, 0) / 2 ** 20;
    if (mb > 25) console.error(`featherbi: warning: the embedded Parquet is ${mb.toFixed(1)} MB, above 25 MB, which makes the page slow to open and share. Build with --split, or aggregate in the source SQL.`);
  }
  const html = await render(config, snapshots, filters, values.offline ? "offline" : values.split ? "split" : "default");
  fs.mkdirSync(values.split ? out : path.dirname(out), { recursive: true });
  if (values.split) {
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

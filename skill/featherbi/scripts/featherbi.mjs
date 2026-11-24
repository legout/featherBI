#!/usr/bin/env node
// featherBI: `build <dashboard.yaml>` turns a dashboard config into one HTML file; `profile` describes sources.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { render } from "./lib/render.mjs";
import { profile, snapshot } from "./lib/sources.mjs";

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  const [command, file] = positionals;
  if (command === "profile" && file) {
    console.log(JSON.stringify(profile(positionals.slice(1), process.cwd()), null, 2));
    process.exit(0);
  }
  if (command !== "build" || !file || positionals.length > 2) {
    throw new Error("usage: featherbi.mjs build <dashboard.yaml> [--out <path>] | profile <table expression or file>…");
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

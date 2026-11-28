#!/usr/bin/env node
// featherBI: `build <dashboard.yaml>` turns a dashboard config into one HTML file (or a --split folder); `profile` describes sources.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { render } from "./lib/render.mjs";
import { remote } from "./lib/s3.mjs";
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

// The selected shell (spec 0005 §6.2), `--shell <file>` or the installed default: its bytes, once its first line declares
// contract v1. The file is read, never imported or run; anything else stops the build before any output is written or uploaded.
const DECLARATION = "export const manifest = { shell: 1 };";
function readShell(file) {
  const at = path.resolve(file);
  let bytes;
  try {
    bytes = fs.readFileSync(at);
  } catch (e) {
    throw new Error(`shell ${at}: the file cannot be read (${e.code ?? e.message}); a shell is an ES module whose first line is \`${DECLARATION}\``);
  }
  const first = bytes.toString("utf8").replace(/^\uFEFF/, "").split("\n")[0].replace(/\r$/, "");
  if (first !== DECLARATION) throw new Error(`shell ${at}: the first line must be exactly \`${DECLARATION}\` (shell contract v1, references/shell.md)`);
  return bytes;
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, offline: { type: "boolean" }, split: { type: "boolean" }, remote: { type: "string" }, expires: { type: "string" }, shell: { type: "string" } } });
  const [command, file] = positionals;
  if (command === "profile" && file) {
    console.log(JSON.stringify(profile(positionals.slice(1), process.cwd()), null, 2));
    process.exit(0);
  }
  if (command !== "build" || !file || positionals.length > 2) {
    throw new Error("usage: featherbi.mjs build <dashboard.yaml> [--out <path>] [--offline | --split | --remote s3://<bucket>/<prefix> [--expires <n>h|<n>d]] [--shell <file>] | profile <table expression or file>…");
  }
  if (values.offline && values.split) throw new Error("--offline and --split cannot be combined");
  if (values.remote !== undefined && (values.offline || values.split)) throw new Error("--remote cannot be combined with --offline or --split");
  if (values.expires !== undefined && values.remote === undefined) throw new Error("--expires needs --remote");
  if (values.remote !== undefined && !/^s3:\/\/[^/]+/.test(values.remote)) throw new Error("--remote must be an s3://<bucket>/<prefix> URL");
  const duration = /^(\d+)([hd])$/.exec(values.expires ?? "7d");
  const expiresSec = duration && duration[1] * (duration[2] === "h" ? 3600 : 86400);
  // 7 days is the SigV4 maximum.
  if (!expiresSec || expiresSec < 3600 || expiresSec > 7 * 86400) throw new Error(`--expires must be <n>h or <n>d, from 1h to 7d, not ${values.expires}`);
  const shell = readShell(values.shell ?? fileURLToPath(new URL("../assets/shell.js", import.meta.url)));
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
  let remoteData;
  if (mode === "default" && values.remote !== undefined) {
    // Nothing is written before every table is uploaded and its presigned URL passed the CORS preflight.
    const mb = Object.values(snapshots).reduce((sum, bytes) => sum + bytes.length, 0) / 2 ** 20;
    console.error(`featherbi: remote data: ${mb.toFixed(1)} MB, downloaded by every viewer on open`);
    if (mb > 200) console.error("featherbi: warning: the remote data is above 200 MB; every viewer downloads this on open; aggregate in source SQL.");
    if (process.env.AWS_SESSION_TOKEN) console.error("featherbi: warning: links stop working when the session token expires, possibly before --expires");
    remoteData = await remote(snapshots, values.remote, { expiresSec, env: process.env });
  } else if (mode !== "split") {
    const mb = Object.values(snapshots).reduce((sum, bytes) => sum + bytes.length, 0) / 2 ** 20;
    if (mb > 25) console.error(`featherbi: warning: the embedded Parquet is ${mb.toFixed(1)} MB, above 25 MB, which makes the page slow to open and share. Build with --split, or aggregate in the source SQL.`);
  }
  const html = await render(config, snapshots, filters, mode, { remote: remoteData, shell });
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

// --offline: fetches the pinned CDN files at build time (cached per user, every one checked against the hash the lock pins) so the build can inline them.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tilesOf } from "./config.mjs";

const CDN = "https://cdn.jsdelivr.net/npm";
// Private to the user (XDG_CACHE_HOME, by default ~/.cache): an inlined file runs in the recipient's browser, so it must
// not come from a folder other users of the machine can write.
const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "featherbi");
const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`; // bytes: a Buffer or module text
const sri = bytes => `sha384-${crypto.createHash("sha384").update(bytes).digest("base64")}`;

// Every file the lock pins, by URL: each fetch is checked against its hash and an unpinned file is refused.
function pinned(node, out = {}) {
  if (!node || typeof node !== "object") return out;
  if (node.url && node.integrity) out[node.url] = node.integrity;
  for (const value of Object.values(node)) pinned(value, out);
  return out;
}

async function get(url, integrity) {
  if (!integrity) throw new Error(`${url}: vendor.lock.json pins no hash for this file; --offline inlines verified files only`);
  const file = path.join(cache, crypto.createHash("sha256").update(url).digest("hex"));
  let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (bytes && sri(bytes) !== integrity) bytes = null; // a damaged cache entry is fetched again
  if (!bytes) {
    const response = await fetch(url).catch(() => {
      throw new Error(`could not fetch ${url}; --offline needs network access at build time`);
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sri(bytes) !== integrity) throw new Error(`${url}: does not match its hash in vendor.lock.json`);
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, bytes);
  }
  return bytes;
}

// The Perspective bundles locate their wasm through import.meta.url, which a data: URL cannot resolve: an offline build
// makes them fetch the inlined copies by name (the page's __fbAsset, in assets/renderer.js) instead.
const WASM_FETCHES = {
  "perspective.js": [
    ['fetch(new URL("../wasm/perspective-js.wasm",import.meta.url))', 'fetch(__fbAsset("perspective-js.wasm"))'],
    ['fetch(Me(import.meta.url))', 'fetch(__fbAsset("perspective-server.wasm"))'],
    ['fetch(Me(import.meta.url,"perspective-server.memory64.wasm"))', 'fetch(__fbAsset("perspective-server.memory64.wasm"))'],
    ['fetch(new URL("../wasm/perspective-migrate.wasm",import.meta.url))', 'fetch(__fbAsset("perspective-migrate.wasm"))'],
  ],
  "perspective-viewer.js": [
    ['fetch(new URL("../wasm/perspective-viewer.wasm",import.meta.url))', 'fetch(__fbAsset("perspective-viewer.wasm"))'],
    ['fetch(Ze(import.meta.url,"viewer","client","perspective-migrate.wasm"))', 'fetch(__fbAsset("perspective-migrate.wasm"))'],
  ],
};

// Each fetch must be found exactly once and nothing may still use import.meta; a Perspective upgrade that moves one fails the build.
function patch(name, source) {
  let out = source;
  for (const [find, replace] of WASM_FETCHES[name]) {
    if (out.split(find).length !== 2) throw new Error(`${name}: \`${find}\` was not found exactly once; the Perspective bundle changed`);
    out = out.replace(find, () => replace);
  }
  if (out.includes("import.meta")) throw new Error(`${name}: still uses import.meta, which a data: URL cannot resolve; the Perspective bundle changed`);
  return out;
}

// -> { imports: import-map entries (CDN URL -> data: URL) for every module the page imports;
//      worker, wasm, extensions: data: URLs of the engine files; grid, css: data: URLs; psp: { <Perspective wasm file>: data: URL } }.
export async function offlineAssets(config, lock) {
  const hash = pinned(lock);
  const imports = {};
  const pending = [];
  const module = async (url, transform = s => s) => {
    if (imports[url]) return;
    const bytes = await get(url, hash[url]);
    const text = transform(bytes.toString("utf8"));
    // jsDelivr's +esm bundles import their dependencies by site-absolute path, which a data: URL cannot resolve.
    for (const [, spec] of text.matchAll(/["']\/npm\/([^"']+)["']/g)) pending.push(`${CDN}/${spec}`);
    imports[url] = dataUrl("text/javascript", text.replace(/(["'])\/npm\//g, `$1${CDN}/`));
  };
  const engine = lock.engines[config.engine];
  const psp = lock.perspective;
  // Explore is on unless `explore: false`; it adds Perspective and its wasm.
  const explore = config.explore !== false;
  const types = tilesOf(config).map(t => t.type);
  await module(engine.module.url);
  // The engine module imports apache-arrow by name whether or not Explore is on, so Arrow (and the +esm dependencies
  // it pulls in below) is inlined in every offline build.
  await module(lock["apache-arrow"].url);
  if (types.includes("echarts")) await module(lock.echarts.url);
  if (explore) {
    await module(psp.client.url, s => patch("perspective.js", s));
    await module(psp.viewer.url, s => patch("perspective-viewer.js", s));
    await module(psp.datagrid.url);
  }
  while (pending.length) await module(pending.shift()); // the dependencies of the +esm bundles
  const inline = async (entry, type) => dataUrl(type, await get(entry.url, hash[entry.url]));
  const extensions = {};
  for (const [name, entry] of Object.entries(engine.extensions ?? {})) extensions[name] = await inline(entry, "application/wasm");
  const pspWasm = {};
  for (const entry of explore ? psp.wasm : []) pspWasm[entry.url.split("/").pop()] = await inline(entry, "application/wasm");
  return {
    imports,
    worker: await inline(engine.worker, "text/javascript"),
    wasm: await inline(engine.wasm, "application/wasm"),
    extensions,
    grid: types.includes("table") ? await inline(lock["ag-grid"], "text/javascript") : undefined,
    css: explore ? await inline(psp.css, "text/css") : undefined,
    psp: explore ? pspWasm : undefined,
  };
}

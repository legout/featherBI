// Render phase: template + prebuilt CSS + renderer + config + snapshot -> one HTML string.
// Modes (spec 0001 §Outputs): default embeds the snapshot and loads the libraries from the CDN with SRI;
// --offline inlines every library too; --split ships the snapshot as Parquet files next to the page.
import crypto from "node:crypto";
import fs from "node:fs";
import { offlineAssets } from "./assets.mjs";

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const escapeHtml = s => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
// JSON inside <script>: no "<", so no value (tile SQL, titles) can close the element.
const json = value => JSON.stringify(value).replaceAll("<", "\\u003c");

export async function render(config, snapshots, filters, mode = "default", { remote } = {}) {
  const lock = JSON.parse(read("assets/vendor.lock.json"));
  const engine = lock.engines[config.engine];
  const psp = lock.perspective;
  const off = mode === "offline" ? await offlineAssets(config, lock) : null;
  // An inlined copy was verified at build time; an empty hash tells the page there is nothing left to check.
  const inlined = url => ({ url, integrity: "" });
  // Explore: on unless `explore: false`; the table defaults to the first source.
  const explore = config.explore === false ? null : { table: config.explore?.table ?? Object.keys(config.sources)[0], perspective: psp, charts: read("assets/perspective-charts.patched.js") };
  const parts = {
    title: escapeHtml(config.title),
    css: read("assets/app.css"),
    // Offline: the page still names the CDN URLs and the import map points them at the inlined copies, which the build
    // verified, so there is no integrity left to check.
    importmap: json({
      // The engine imports apache-arrow by name. Offline, that name maps straight to the inlined bundle: an import map does not chain.
      imports: { "apache-arrow": off?.imports[lock["apache-arrow"].url] ?? lock["apache-arrow"].url, ...off?.imports },
      integrity: off ? undefined : { [engine.module.url]: engine.module.integrity, [lock.echarts.url]: lock.echarts.integrity, ...(explore && Object.fromEntries([psp.client, psp.viewer, psp.datagrid].map(m => [m.url, m.integrity]))) },
    }),
    // Only tile SQL and snapshot data reach the page; source SQL stays on the author's machine.
    data: json({
      // The extension keeps the URL the engine itself asks for (the worker shim is keyed by it); an offline build adds its inlined copy.
      engine: off ? { ...engine, worker: inlined(off.worker), wasm: inlined(off.wasm), extensions: Object.fromEntries(Object.entries(off.extensions).map(([name, data]) => [name, { ...engine.extensions[name], data, integrity: "" }])) } : engine,
      charts: lock.echarts,
      grid: off?.grid ? inlined(off.grid) : lock["ag-grid"],
      // Only the presets this dashboard uses.
      presets: Object.fromEntries(config.tiles.filter(t => t.type === "echarts").map(t => [t.preset, JSON.parse(read(`assets/presets/${t.preset}.json`))])),
      tiles: config.tiles,
      filters,
      explore: explore && { ...explore, perspective: off?.css ? { ...psp, css: inlined(off.css) } : psp, assets: off?.psp },
      // A remote page gets { tables: { <table>: { url, bytes } }, expiresAt } instead of the Parquet bytes (spec 0002).
      ...(remote ? { remote } : {
      // A split page fetches its Parquet files next to it; the other modes embed them as data: URLs.
      snapshots: Object.fromEntries(Object.entries(snapshots).map(([name, bytes]) => [name, mode === "split" ? `${name}.parquet` : `data:application/octet-stream;base64,${bytes.toString("base64")}`])),
      }),
    }),
    // The renderer shares filters.mjs with the build: the same file, inlined with its exports dropped.
    renderer: read("scripts/lib/filters.mjs").replace(/^export /gm, "") + read("assets/renderer.js"),
  };
  // One pass over the template, so "{{…}}" inside inserted content is never substituted.
  const html = read("templates/dashboard.html").replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key]);
  // A split page lists the files of its folder with their digests, so the next build into it can tell its own files
  // (still byte-identical) from anyone else's (featherbi.mjs).
  return mode === "split" ? html.replace("</head>", `<meta name="featherbi-split" content='${json(Object.fromEntries(Object.entries(snapshots).map(([name, bytes]) => [`${name}.parquet`, crypto.createHash("sha256").update(bytes).digest("hex")])))}'>\n</head>`) : html;
}

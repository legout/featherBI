import perspective from "@finos/perspective";
import perspectiveViewer from "@finos/perspective-viewer";
import "@finos/perspective-viewer-datagrid";
// The published per-chart export registers synchronously and has no top-level await.
import "@finos/perspective-viewer-d3fc/column";
import clientWasm from "@finos/perspective/dist/wasm/perspective-js.wasm";
import serverWasm from "@finos/perspective/dist/wasm/perspective-server.wasm";
import viewerWasm from "@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm";
import { loadPerspectiveTable } from "../perspective-table.mjs";

export const PERSPECTIVE_MAX_ROWS = 10_000;
export const PERSPECTIVE_MAX_BYTES = 8 * 1024 * 1024;
export const PERSPECTIVE_TIMEOUT_MS = 30_000;

/**
 * Publish one clicked mark's typed grouped/split values on the viewer-owned
 * selection path. Perspective's `perspective-click` carries the mark's own
 * `config.filter` equalities for its group/split fields plus unrelated
 * filter entries; only `[field, "==", value]` entries for the rendered
 * group/split fields are translated, and the values are already typed by
 * the plugin. The shared viewer path resolves the source-controlled
 * dimension mapping, not this adapter.
 * @param {Element} node the perspective host element inside its component
 * @param {Element} viewer the `perspective-viewer` element
 * @param {string[]} fields selectable groupBy/splitBy result fields
 */
function publishMarkSelection(node, viewer, fields) {
 if (!fields.length) return;
 let modifier = false;
 // The published click event carries no native modifier state, so capture
 // it while the native click is still travelling down to the mark.
 viewer.addEventListener(
  "click",
  (event) => {
   modifier = Boolean(event.shiftKey || event.metaKey || event.ctrlKey);
  },
  { capture: true },
 );
 viewer.addEventListener("perspective-click", (event) => {
  const entries = event.detail?.config?.filter;
  if (!Array.isArray(entries)) return;
  const pairs = [];
  for (const entry of entries) {
   if (
    Array.isArray(entry) &&
    entry.length === 3 &&
    entry[1] === "==" &&
    fields.includes(entry[0])
   ) {
    pairs.push({ field: entry[0], value: entry[2] });
   }
  }
  modifier = false;
  if (!pairs.length) return;
  node.dispatchEvent(
   new CustomEvent("featherbi-chart-select", {
    bubbles: true,
    detail: { pairs, modifier },
   }),
  );
 });
}

let initialized;
const loaded = new Map();
const renderQueues = new WeakMap();

async function client() {
 if (!initialized) {
  perspective.init_client(clientWasm);
  perspective.init_server(serverWasm);
  initialized = (async () => {
   await perspectiveViewer.init_client(viewerWasm);
   return perspective.worker();
  })();
 }
 return initialized;
}

export const perspectiveCapability = {
 render(node, ipc, config) {
  const render = (renderQueues.get(node) ?? Promise.resolve()).then(async () => {
   if (ipc.byteLength > PERSPECTIVE_MAX_BYTES) throw new Error("Perspective result exceeds the 8 MiB Arrow limit");
   const worker = await client();
   const table = await worker.table(ipc);
   const rowCount = await table.size();
   if (rowCount > PERSPECTIVE_MAX_ROWS) {
    await table.delete();
    throw new Error("Perspective result exceeds the 10,000-row limit");
   }
   let viewer = node.querySelector("perspective-viewer");
   if (!viewer) {
    viewer = document.createElement("perspective-viewer");
    node.replaceChildren(viewer);
    // The selection listeners live on the viewer element and are disposed
    // with it; they are attached once when the viewer is created.
    publishMarkSelection(node, viewer, [
     ...(config.groupBy ?? []),
     ...(config.splitBy ?? []),
    ]);
   }
   const prior = loaded.get(node);
   await loadPerspectiveTable(viewer, table, config);
   loaded.set(node, { viewer, table });
   await prior?.table.delete();
  });
  renderQueues.set(node, render.catch(() => {}));
  return render;
 },
 async dispose(node) {
  await renderQueues.get(node);
  const current = loaded.get(node);
  if (!current) return;
  await current.viewer.delete();
  await current.table.delete();
  loaded.delete(node);
 },
 async disposeAll() {
  await Promise.all([...loaded.keys()].map((node) => this.dispose(node)));
  if (initialized) await (await initialized).terminate();
  initialized = undefined;
 },
};

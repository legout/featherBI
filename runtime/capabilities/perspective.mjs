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

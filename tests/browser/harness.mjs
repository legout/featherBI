/**
 * Test hooks exposed by the generated `.artifacts/browser/harness.html`.
 *
 * This module is test-only scaffolding bundled into the harness page. It wraps
 * the production `runtime/bootstrap.mjs` seam (`createEngine`) without hiding
 * engine ownership behind a global singleton: every engine created through the
 * harness is registered under an explicit id, owned by the creating test, and
 * must be disposed through the same handle.
 *
 * BigInt query values are stringified because Playwright evaluation results
 * cannot always transport BigInt across the protocol.
 */

import {
 DUCKDB_WASM_BUNDLES,
 DUCKDB_WASM_VERSION,
 createEngine,
} from "../../runtime/bootstrap.mjs";
import { registerSources as loadSources } from "../../runtime/sources.mjs";

/** @typedef {{phase: string, detail?: object}} EngineStatusEvent */

const engines = new Map();
let nextEngineId = 1;

function markState(state, message) {
 const status = document.getElementById("harness-status");
 if (status) {
  status.dataset.state = state;
  status.textContent = message;
 }
}

function serializeRows(table) {
 return table
  .toArray()
  .map((row) =>
   Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
     key,
     typeof value === "bigint" ? value.toString() : value,
    ]),
   ),
  );
}

function requireEngine(id) {
 const entry = engines.get(id);
 if (!entry) {
  throw new Error(`unknown engine id: ${id}`);
 }
 return entry;
}

window.__featherbiHarness = {
 /** Merged build metadata + pinned runtime asset versions. */
 meta: {
  ...(window.__featherbiHarnessBuild ?? {}),
  duckdbWasm: {
   version: DUCKDB_WASM_VERSION,
   bundles: DUCKDB_WASM_BUNDLES,
  },
 },

 /**
  * Create an engine in a dedicated worker. Mirrors `createEngine(opts)` from
  * runtime/bootstrap.mjs; `opts.urls` is a test-only asset override used to
  * prove failure handling for unavailable/stalled worker/WASM assets, and
  * `opts.bootTimeoutMs` bounds the whole boot (probe included).
  * @returns {Promise<{id: string, info: object}>}
  */
 async createEngine(opts = {}) {
  const events = [];
  const engine = await createEngine({
   onStatus: (event) => events.push(event),
   urls: opts.urls,
   bootTimeoutMs: opts.bootTimeoutMs,
  });
  const id = `engine-${nextEngineId++}`;
  engines.set(id, { engine, events, disposed: false });
  return { id, info: engine.info };
 },

 /**
  * Register explicit source declarations with selected or embedded inputs.
  * Errors are copied to the visible harness status before being rethrown.
  */
 async registerSources(id, files) {
  const { engine } = requireEngine(id);
  try {
   const result = await loadSources(engine, files);
   markState("ready", "sources ready");
   return result;
  } catch (error) {
   const message = error instanceof Error ? error.message : String(error);
   markState("error", message);
   throw error;
  }
 },

 /**
  * Run SQL text on an engine and return plain rows.
  * @returns {Promise<Array<Record<string, unknown>>>}
  */
 async query(id, sql) {
  const { engine } = requireEngine(id);
  const result = await engine.connection.query(sql);
  return serializeRows(result);
 },

 /**
  * Prepare a statement, execute it with positional parameters, close it, and
  * return plain rows. Used by the parser capability gate.
  * @returns {Promise<Array<Record<string, unknown>>>}
  */
 async runPrepared(id, sql, params) {
  const { engine } = requireEngine(id);
  const statement = await engine.connection.prepare(sql);
  try {
   const result = await statement.query(...params);
   return serializeRows(result);
  } finally {
   await statement.close();
  }
 },

 /** Recorded lifecycle/status events for one engine. */
 async statusLog(id) {
  return requireEngine(id).events.map((event) => ({ ...event }));
 },

 /** Observed engine state (disposal is tracked by the harness wrapper). */
 async engineState(id) {
  const { engine, disposed } = requireEngine(id);
  return {
   disposed,
   info: engine.info,
   detached:
    typeof engine.db.isDetached === "function" ? engine.db.isDetached() : null,
  };
 },

 /**
  * Dispose an engine exactly as `dispose()` from runtime/bootstrap.mjs
  * prescribes; idempotent, terminates the owned worker.
  */
 async dispose(id) {
  const entry = requireEngine(id);
  await entry.engine.dispose();
  entry.disposed = true;
 },

 /**
  * Simulate an ungraceful worker loss mid-life (no connection close, no
  * dispose): the worker is terminated while the connection stays open.
  */
 async terminateWorker(id) {
  const { engine } = requireEngine(id);
  await engine.db.terminate();
 },

 /**
  * Page-level errors and unhandled promise rejections recorded so far.
  * Failure-path tests use this to prove that disposed/cancelled work (for
  * example an aborted module-availability probe) leaves nothing unhandled.
  * @returns {Promise<Array<{kind: string, message: string}>>}
  */
 async pageIssues() {
  return pageIssues.map((issue) => ({ ...issue }));
 },
};

/** @type {Array<{kind: string, message: string}>} */
const pageIssues = [];

function recordPageIssue(kind, message) {
 pageIssues.push({ kind, message: String(message) });
 markState("error", `${kind}: ${message}`);
}

window.addEventListener("error", (event) => {
 recordPageIssue("error", event.message);
});

window.addEventListener("unhandledrejection", (event) => {
 const reason = event.reason;
 recordPageIssue(
  "unhandledrejection",
  reason instanceof Error ? `${reason.name}: ${reason.message}` : reason,
 );
});

markState("ready", "harness ready");

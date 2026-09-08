/**
 * DuckDB-WASM engine bootstrap for the browser runtime (Plan 02, P2.1).
 *
 * Boots the pinned DuckDB-WASM release in a dedicated web worker using the
 * proven Blob/`importScripts` bootstrap (the only way to load the remote
 * worker script from a `file://` page), connects one owned connection, and
 * returns an explicit engine handle. There is deliberately no global
 * singleton: every caller creates and owns its engine and must dispose it.
 *
 * Remote asset URLs are pinned (no `latest`) and stay visible in build
 * metadata through `DUCKDB_WASM_BUNDLES`.
 *
 * Engine failure behavior proved in P2.1 (DuckDB-WASM 1.32.0 / DuckDB 1.4.3):
 * - An unavailable worker script fires a worker `error` event; duckdb-wasm
 *   drops the pending boot request without rejecting, so boot races the
 *   worker-level failure here.
 * - An unavailable WASM module fails inside the worker's
 *   `WebAssembly.instantiateStreaming` without a `.catch`, so the pending
 *   INSTANTIATE task never settles; module availability is therefore probed
 *   before instantiation and the whole boot — including that probe — is
 *   bounded by a timeout.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

/** Pinned DuckDB-WASM package version for all remote browser assets. */
export const DUCKDB_WASM_VERSION = "1.32.0";

const jsDelivrBase = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_WASM_VERSION}/dist/`;

/** Pinned remote asset bundles; `selectBundle` picks eh or mvp at runtime. */
export const DUCKDB_WASM_BUNDLES = {
 mvp: {
  mainModule: `${jsDelivrBase}duckdb-mvp.wasm`,
  mainWorker: `${jsDelivrBase}duckdb-browser-mvp.worker.js`,
 },
 eh: {
  mainModule: `${jsDelivrBase}duckdb-eh.wasm`,
  mainWorker: `${jsDelivrBase}duckdb-browser-eh.worker.js`,
 },
};

/** Bounded boot timeout (cold CDN fetch of the ~50 MB EH module included). */
const DEFAULT_BOOT_TIMEOUT_MS = 120_000;

/**
 * Create a worker that runs the pinned remote DuckDB-WASM worker script.
 *
 * The remote script cannot be passed to `new Worker()` directly from a
 * `file://` page (cross-origin worker scripts are disallowed), so a blob
 * worker bootstraps it with `importScripts`, as proven by the Chrome
 * feasibility probe and the official DuckDB-WASM instantiation example.
 *
 * @param {string} mainWorkerUrl
 * @returns {{worker: Worker, blobUrl: string}}
 */
function createDuckDBWorker(mainWorkerUrl) {
 const blob = new Blob([`importScripts(${JSON.stringify(mainWorkerUrl)});`], {
  type: "text/javascript",
 });
 const blobUrl = URL.createObjectURL(blob);
 return { worker: new Worker(blobUrl), blobUrl };
}

/**
 * Parse the full DuckDB version string (for example `v1.4.3 d1dc88f950`).
 *
 * @param {string} fullVersion
 */
function parseFullVersion(fullVersion) {
 const match = /v?(\d+\.\d+\.\d+)\s+([0-9a-f]{6,})/i.exec(String(fullVersion));
 if (!match) {
  return { version: null, sourceId: null };
 }
 return { version: `v${match[1]}`, sourceId: match[2] };
}

/**
 * Probe remote module availability before instantiation, because a failed
 * module fetch inside the worker never settles the INSTANTIATE task.
 *
 * A stalled HEAD/range fetch can itself hang indefinitely, so callers race
 * this probe against the bounded boot timeout and cancel it through `signal`
 * once boot settles either way (its eventual AbortError is then observed
 * through that race and never becomes an unhandled rejection).
 *
 * @param {string} moduleUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>} rejects with a bounded, URL-specific error
 */
async function probeModuleAvailable(moduleUrl, signal) {
 try {
  const head = await fetch(moduleUrl, { method: "HEAD", signal });
  if (!head.ok) {
   throw new Error(
    `DuckDB-WASM module unavailable at ${moduleUrl} (HTTP ${head.status})`,
   );
  }
  return;
 } catch (error) {
  if (error instanceof TypeError) {
   // Network/CORS failure on HEAD; retry with a one-byte range request
   // before declaring the module unreachable.
   try {
    const probe = await fetch(moduleUrl, {
     headers: { Range: "bytes=0-0" },
     signal,
    });
    if (!probe.ok && probe.status !== 206) {
     throw new Error(
      `DuckDB-WASM module unavailable at ${moduleUrl} (HTTP ${probe.status})`,
     );
    }
    return;
   } catch (fallbackError) {
    throw new Error(
     `DuckDB-WASM module unreachable at ${moduleUrl}: ${
      fallbackError instanceof Error
       ? fallbackError.message
       : String(fallbackError)
     }`,
    );
   }
  }
  throw error;
 }
}

/**
 * Create a DuckDB-WASM engine in a dedicated worker.
 *
 * @param {object} [options]
 * @param {(event: {phase: string, detail?: object}) => void} [options.onStatus]
 *   Optional lifecycle observer. Events carry lifecycle phases and pinned
 *   asset URLs only — never SQL text, source rows, or local paths.
 * @param {{mainWorker?: string, mainModule?: string}} [options.urls]
 *   Test-only asset override (failure injection for unavailable assets).
 * @param {number} [options.bootTimeoutMs]
 *   Bounded boot timeout; defaults to 120000 ms.
 * @returns {Promise<{db: object, connection: object, dispose: () => Promise<void>, info: object}>}
 *   The caller owns disposal: `dispose()` closes the connection and
 *   terminates the owned worker; calling it more than once is harmless.
 * @throws {Error} if the worker script or WASM module cannot be loaded.
 */
export async function createEngine(options = {}) {
 const onStatus =
  typeof options.onStatus === "function" ? options.onStatus : () => {};
 const override = options.urls ?? null;
 const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;

 const bundle = override
  ? {
     mainWorker: override.mainWorker ?? DUCKDB_WASM_BUNDLES.eh.mainWorker,
     mainModule: override.mainModule ?? DUCKDB_WASM_BUNDLES.eh.mainModule,
    }
  : await duckdb.selectBundle(DUCKDB_WASM_BUNDLES);

 const { worker, blobUrl } = createDuckDBWorker(bundle.mainWorker);
 onStatus({
  phase: "worker-created",
  detail: { mainWorker: bundle.mainWorker },
 });

 // duckdb-wasm clears pending requests on worker errors without rejecting
 // them, so worker-level failures during boot are raced explicitly here.
 /** @type {(error: Error) => void} */
 let failBoot = () => {};
 /** @type {Promise<never>} */
 const failure = new Promise((_, reject) => {
  failBoot = reject;
 });
 // This promise is only ever observed through races; mark rejections handled.
 failure.catch(() => {});
 const onWorkerError = (event) => {
  const where = event.filename || bundle.mainWorker;
  failBoot(
   new Error(
    `DuckDB-WASM worker failed to load ${where}${
     event.message ? `: ${event.message}` : ""
    }`,
   ),
  );
 };
 const onWorkerClose = () => {
  failBoot(
   new Error(
    `DuckDB-WASM worker closed unexpectedly during boot (${bundle.mainWorker})`,
   ),
  );
 };
 worker.addEventListener("error", onWorkerError);
 worker.addEventListener("close", onWorkerClose);
 const detachFailureWatch = () => {
  worker.removeEventListener("error", onWorkerError);
  worker.removeEventListener("close", onWorkerClose);
 };

 const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);

 const failWith = (phase, url, error) => {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
   `DuckDB-WASM ${phase} failed${url ? ` (${url})` : ""}: ${message}`,
   { cause: error },
  );
 };

 let bootTimer = 0;
 const bootTimeout = new Promise((_, reject) => {
  bootTimer = setTimeout(() => {
   reject(
    new Error(
     `DuckDB-WASM engine boot timed out after ${bootTimeoutMs} ms (worker: ${bundle.mainWorker}, module: ${bundle.mainModule})`,
    ),
   );
  }, bootTimeoutMs);
 });
 // This promise is only ever observed through races; mark rejections handled.
 bootTimeout.catch(() => {});

 // Cancels the module-availability probe once boot settles either way, so
 // a stalled HEAD/range fetch is disposed of instead of lingering in the
 // page (the probe is raced against worker failure and the bounded boot
 // timeout below; before that race it could hang boot indefinitely).
 const probeAbort = new AbortController();

 let connection;
 try {
  try {
   await Promise.race([
    probeModuleAvailable(bundle.mainModule, probeAbort.signal),
    failure,
    bootTimeout,
   ]);
  } catch (error) {
   onStatus({ phase: "failed", detail: { stage: "module-probe" } });
   throw failWith("module availability probe", bundle.mainModule, error);
  }
  onStatus({
   phase: "instantiating",
   detail: { mainModule: bundle.mainModule },
  });
  try {
   await Promise.race([
    db.instantiate(bundle.mainModule, null),
    failure,
    bootTimeout,
   ]);
  } catch (error) {
   onStatus({ phase: "failed", detail: { stage: "instantiate" } });
   throw failWith("module instantiation", bundle.mainModule, error);
  }
  try {
   connection = await Promise.race([db.connect(), failure, bootTimeout]);
  } catch (error) {
   onStatus({ phase: "failed", detail: { stage: "connect" } });
   throw failWith("connect", null, error);
  }

  // Record the engine version reported by the running WASM engine itself.
  let apiVersion = null;
  let fullVersion = null;
  try {
   apiVersion = await Promise.race([db.getVersion(), failure, bootTimeout]);
   const versionRows = await Promise.race([
    connection.query("SELECT version() AS version"),
    failure,
    bootTimeout,
   ]);
   fullVersion = String(versionRows.toArray()[0].version);
  } catch {
   // Version recording is best effort; the engine is usable without it.
  }
  const parsed = parseFullVersion(fullVersion ?? "");

  detachFailureWatch();
  clearTimeout(bootTimer);
  URL.revokeObjectURL(blobUrl);
  // The probe already settled; aborting again is a no-op that simply marks
  // the controller closed.
  probeAbort.abort();
  const info = {
   version: parsed.version ?? apiVersion ?? null,
   apiVersion,
   fullVersion,
   sourceId: parsed.sourceId,
   bundle: { mainWorker: bundle.mainWorker, mainModule: bundle.mainModule },
  };
  onStatus({ phase: "ready", detail: info });
  const handle = {
   db,
   connection,
   info,
   /** Close the connection and terminate the owned worker; idempotent. */
   async dispose() {
    if (handle.disposed) {
     return;
    }
    handle.disposed = true;
    onStatus({ phase: "disposing" });
    try {
     await connection.close();
    } catch {
     // The worker may already be gone; termination below is what matters.
    }
    await db.terminate();
    onStatus({ phase: "disposed" });
   },
   disposed: false,
  };
  return handle;
 } catch (error) {
  // Boot failed: never leak the timer, listeners, worker, blob URL, or an
  // in-flight module probe (its aborted fetch rejects through the race
  // above, never unhandled).
  clearTimeout(bootTimer);
  detachFailureWatch();
  worker.terminate();
  URL.revokeObjectURL(blobUrl);
  probeAbort.abort();
  throw error;
 }
}

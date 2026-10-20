# Static hosting, CORS, and CSP probe (ticket #37 / S1)

**Status:** evidence collected 2026-10-19 in desktop Chrome. Disposable spike per [plan 0005](../plans/2026-10-19-0005-static-sharing-and-live-refresh.md) S1 and [spec 0005 §7](../specs/2026-10-19-0005-static-sharing-and-live-refresh.md). No product code changed; the harness lived outside the repository and was disposed after evidence extraction.

## Question

For a statically hosted `dashboard.html` (origin A) reading live CSV, JSON, and Parquet from a second origin (B): which CSP directives does the pinned DuckDB-WASM runtime need for asset loads, extension loads, and live reads, and how do cross-origin reads behave with and without CORS?

## Environment

- Desktop Chrome 155.0.8059.80 (macOS), driven over the DevTools protocol with a fresh temporary profile.
- Pinned assets exactly as `runtime/bootstrap.mjs` configures them: `@duckdb/duckdb-wasm@1.33.1-dev64.0` from jsDelivr, EH bundle (engine reports DuckDB v1.5.5, platform `wasm_eh`), blob worker bootstrapping the CDN worker script via `importScripts`.
- Origin A `http://127.0.0.1:8811` served the spike page (duckdb API bundled from `'self'` with the repo's installed esbuild, mirroring the artifact's inline script) under selectable CSP response headers. Origin B `http://127.0.0.1:8812` served the same 5-row CSV/JSON/Parquet fixtures, once with `Access-Control-Allow-Origin: http://127.0.0.1:8811` and once without.
- Read SQL mirrors `runtime/sources.mjs`: `LOAD httpfs`, then `read_csv_auto` / `read_json_auto(FORMAT = 'array')` / `read_parquet` counts.

## Evidence (7 scenarios, single clean pass)

1. **No CSP, CORS on** — engine boots; `LOAD httpfs` and `LOAD iceberg` succeed; CSV, JSON, and Parquet each read 5 rows.
2. **No CSP, CORS off** — every read fails. Worker console: `Access to XMLHttpRequest at 'http://127.0.0.1:8812/nocors/data.csv' from origin 'http://127.0.0.1:8811' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present…`. DuckDB surfaces this to SQL as `HTTP Error: HTTP GET error on '…' (HTTP 404 Not Found)`.
3. **Full CSP (below), CORS on** — identical success to (1): zero security-log entries; all reads and both extension loads pass.
4. **Full CSP minus `'wasm-unsafe-eval'`** — `WebAssembly.instantiateStreaming()` fails with `CompileError: … 'unsafe-eval' is not an allowed source…`; the duckdb-wasm INSTANTIATE task never settles, so boot hangs until the bounded timeout. No JS exception reaches the page (matches the failure mode `runtime/bootstrap.mjs` already races against).
5. **Full CSP minus `blob:` in `worker-src`** — `Creating a worker from 'blob:http://127.0.0.1:8811/…' violates the following Content Security Policy directive: "worker-src 'self'". The action has been blocked.` Again no synchronous exception; boot hangs. Malformed tokens (for example `blob:'`) are ignored by Chrome and tighten the policy the same way.
6. **Full CSP minus `https://extensions.duckdb.org` in `connect-src`** — engine boots, then `LOAD httpfs` itself fails: `Connecting to 'https://extensions.duckdb.org/v1.5.5/wasm_eh/httpfs.duckdb_extension.wasm' violates the following Content Security Policy directive: "connect-src …"` (`Failed to execute 'send' on 'XMLHttpRequest'`). **httpfs is dynamically loaded in this build** — `duckdb_extensions()` reports `NOT_INSTALLED` before loading — so every live read, not just Iceberg, needs the extension repository origin reachable.
7. **Full CSP minus the data origin in `connect-src`** — engine and httpfs fine; each read is blocked (`Connecting to 'http://127.0.0.1:8812/fixtures/data.csv' violates "connect-src …"`), surfaced to SQL again as `HTTP 404 Not Found`.

Successful reads issued one HEAD plus one full GET per file: simple requests, no preflight, `Origin` header present. Range is supported by the fixture host but was not exercised at this file size.

## Working CSP shape for T4 (#43)

```text
default-src 'none';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net;
worker-src 'self' blob:;
connect-src 'self' https://cdn.jsdelivr.net https://extensions.duckdb.org <declared live source origins>;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
```

- `script-src … https://cdn.jsdelivr.net` — the blob worker `importScripts()`es the CDN worker script under the page-inherited policy. `'unsafe-inline'` covers the artifact's single inline `<script>`; a per-artifact sha256 hash is the stricter T4 option (untested here).
- `'wasm-unsafe-eval'` — engine and extension WebAssembly compilation (scenario 4).
- `worker-src 'self' blob:` — blob-worker bootstrap (scenario 5).
- `connect-src` CDN origin — the worker fetches the `duckdb-eh.wasm` module.
- `connect-src` extension-repository origin — dynamic `LOAD httpfs` / `LOAD iceberg` fetches (scenario 6). This extends spec §7's "declared live origins and the pinned DuckDB-WASM asset origins": the extension repository origin is required for any live read in this build.
- `connect-src` declared live source origins — the reads themselves (scenario 7).
- `style-src` / `img-src` / `font-src` carry over from the artifact's rendering needs (inline styles per `scripts/build.mjs`) and were not exercised by this engine-focused probe.
- Tested as an HTTP response header. `<meta http-equiv>` delivery is equivalent for these directives but was not browser-verified.

## CORS behavior for SL-07

- Cross-origin live reads work when the data host answers the page origin with `Access-Control-Allow-Origin`; plain reads need no preflight.
- Without CORS, the worker-level XHR is blocked and DuckDB reports `HTTP 404 Not Found`. The same misleading 404 text appears for CSP `connect-src` blocks, so the runtime cannot distinguish a CORS failure from a CSP block (or a genuine 404) from the SQL error text alone. The SL-07 remedy text should cover the configuration causes — allow CORS on the data host or serve same-origin, and check the artifact CSP's `connect-src` — rather than promise root-cause precision.

## Limitations

- Loopback ports stand in for public origins; no S3, authentication, or redirect paths and no credentials were exercised (out of scope).
- One browser (desktop Chrome 155); tiny fixtures; no Range-read behavior at this size (streaming behavior is covered by the large-file probe).
- DuckLake viability and the Iceberg/DuckLake extension trust decision belong to S2 (#38); this probe records only that extension fetches are governed by `connect-src` plus `'wasm-unsafe-eval'`.
- The harness was disposed after evidence extraction; conclusions rest on the single clean pass described above.

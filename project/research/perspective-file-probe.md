# Perspective over DuckDB under `file://` probe

## Question and threshold

Can a Perspective-first viewer stay above DuckDB-WASM's source/query lifecycle under the real delivery boundary: an extracted HTML artifact opened as `file://` in installed desktop Chrome?

Acceptance required a bounded DuckDB-WASM result transferred through Perspective's supported Arrow input, a visible datagrid and chart plugin, one save/restore interaction, and evidence about WASM, workers, plugins, CSP, and result limits.

## Environment and exact versions

- macOS 26.6.2 (25G83), arm64
- desktop Google Chrome 153.0.8010.47, launched by Playwright with `channel: 'chrome'`
- Node.js 26.8.2; npm 11.19.1; Playwright 1.63.0; esbuild 0.28.2
- `@duckdb/duckdb-wasm 1.32.0` (engine `v1.4.3`)
- `apache-arrow 17.0.0`
- `@finos/perspective`, `@finos/perspective-viewer`, `@finos/perspective-viewer-datagrid`, and `@finos/perspective-viewer-d3fc` 3.8.0

Primary API sources are Perspective's [JavaScript client documentation](https://perspective.finos.org/guide/how_to/javascript.html), [viewer documentation](https://perspective.finos.org/guide/how_to/viewer.html), and the pinned [`perspective.browser.ts`](https://github.com/finos/perspective/blob/v3.8.0/rust/perspective-js/src/ts/perspective.browser.ts). Perspective is Apache-2.0 licensed; its pinned package source is the authority for the initialization behavior observed here.

## Reproducible command and prototype shape

The disposable package used exact npm pins. Its entry performed this sequence:

1. select DuckDB-WASM's pinned EH/MVP bundle;
2. create a blob worker that calls `importScripts()` for the selected pinned worker URL;
3. instantiate DuckDB-WASM, run a four-row synthetic aggregate-shaped query, and convert the returned Arrow table with `tableToIPC(result, 'stream')`;
4. initialize Perspective client/server/viewer from the three package WASM binaries embedded by esbuild's `binary` loader;
5. load the same Perspective table into two viewers;
6. restore `Datagrid` with `group_by: ['region']` and `Y Bar` with `group_by: ['category']` and `split_by: ['region']`; and
7. save the grid config, restore it, save again, and compare the results.

The browser boundary was exercised without an HTTP server:

```sh
npx esbuild browser/app.js --bundle --format=iife --platform=browser \
  --target=chrome120 --outfile=browser/dist/bundle.js \
  --loader:.wasm=binary --loader:.html=text --metafile=browser/dist/meta.json
node browser/run.mjs   # chromium.launch({channel:'chrome'}), page.goto(fileURL)
```

The page CSP was:

```text
default-src 'self' file: https://cdn.jsdelivr.net;
script-src 'self' 'unsafe-eval' blob: https://cdn.jsdelivr.net;
worker-src blob: file:;
connect-src https://cdn.jsdelivr.net file: blob:;
style-src 'self' 'unsafe-inline' file:;
img-src 'self' data: blob:; font-src 'self' data:;
```

The prototype inlined generated CSS into the HTML because relying on a sibling stylesheet under an opaque `file://` origin did not expose the required Perspective theme variables consistently. The three compressed Perspective WASM files were embedded in JavaScript; fetching sibling WASM through `file://` was not assumed.

## Observed browser evidence

Playwright asserted `location.protocol === 'file:'`; Chrome reported 153.0.8010.47. The page reached visible `ready` state with no page/unhandled-rejection entry in the probe error array.

- DuckDB returned 4 rows.
- Arrow IPC payload size was 816 bytes.
- Perspective table size was 4.
- The visible left viewer rendered the grouped datagrid (`TOTAL`, `north`, `south`; amount and quantity columns).
- The visible right viewer rendered a stacked Y Bar chart for `alpha` and `beta`, split into `north` and `south`.
- Saved configs reported Perspective version 3.8.0 and plugins `Datagrid` and `Y Bar` with the requested group/split/column state.
- Saving after restoring the grid config was byte-for-byte JSON-equivalent (`restoreRoundTrip: true`).
- Both viewers had non-empty shadow roots and 618 by 422 pixel browser rectangles.
- The screenshot was 21,278 bytes and was inspected locally, then deleted rather than committed.

The successful disposable artifact was 175,394-byte HTML, 6,099,672-byte JavaScript, and 174,191-byte generated CSS before CSS was inlined. The large JS is principally the three Perspective WASM binaries plus DuckDB/Arrow/client code; it is evidence for a size ceiling, not a proposed final layout.

DuckDB remained the only raw-source/query owner. Perspective received only the bounded Arrow result and had no file handle, raw-source registration, replacement, or SQL lifecycle.

## File, worker, plugin, and CSP constraints

- DuckDB-WASM worked in its own worker only through the existing blob/`importScripts()` bootstrap. A direct cross-origin worker from a `file://` page is not portable.
- Perspective 3.8.0 logged `file:// protocol does not support Web Workers` and `Running perspective in single-threaded mode`. Its `worker()` API therefore ran this bounded result in its file-protocol fallback, not in a separate Perspective worker.
- Perspective's client, server, and viewer WASM must be initialized explicitly. Package defaults otherwise failed with `Missing perspective-client.wasm`.
- The datagrid package registered directly. The D3FC package's distributed ESM contains top-level `await`; external module scripts were blocked by `file://` CORS in Chrome, while a classic IIFE cannot contain that top-level await.
- To isolate the integration boundary, the successful disposable build changed the single generated `await register()` in the installed D3FC distribution to its synchronous `register()` call before bundling. The installed package was restored immediately. This is diagnostic evidence, not an acceptable production patch.
- WASM execution required the probe's `unsafe-eval` allowance. Production should narrow this to the browser-supported `wasm-unsafe-eval` directive if the chosen Chrome/CSP combination permits it and should hash any inline script/style content.
- The approved online-asset model allowed pinned DuckDB CDN URLs. Offline startup was not tested and is not required by the current specification.

## Limitations and rejected approaches

- A straightforward external ESM bundle failed under `file://` because Chrome treated the local module fetch as cross-origin. An attempted inline ESM bundle reached a browser `SyntaxError: Unexpected reserved word` before application initialization. Neither route was relabelled as success.
- The successful D3FC diagnostic transform means the exact supported production build recipe is not yet proven. Issue #7 must either establish a supported inline-ESM/CSP build, contribute/use an upstream classic-compatible entry, or generate the plugin registration from supported source exports without mutating installed files.
- Perspective work is on the main thread under `file://` in 3.8.0. Global row/byte/time ceilings therefore need to be conservative and enforced before `table()`/`load()`.
- Only a four-row Arrow stream was tested. Large-result transfer, type coverage (especially decimals, temporal units, dictionaries, and null-heavy columns), cancellation, repeated updates, memory release, and selected shell themes remain production checks.
- `unsafe-inline` was used for probe CSS. That is not the final content-security policy.
- Letting Perspective open the selected raw source was rejected because it would create the second lifecycle forbidden by [ADR 0006](../adr/0006-compile-dashboard-projects-into-typed-viewers.md).

## Verdict: REVISE

The architectural seam passes: a bounded DuckDB Arrow result visibly drives Perspective datagrid/chart state under real `file://`, and save/restore works without a second source lifecycle. The packaging recipe does not yet pass unchanged package consumption because Perspective 3.8.0 falls back to the main thread and the D3FC top-level-await distribution conflicts with a classic external `file://` bundle.

## Consequence for issue #7 and specification

Keep Perspective as a bounded result viewer above DuckDB. Before shipping it, issue #7 must prove a supported no-package-patch plugin build and set a small row/byte ceiling appropriate to single-threaded Perspective under `file://`. These are implementation constraints; they do not require changing the [runtime-v2 architecture](../specs/dashboard-project-and-runtime-v2.md).

## Cleanup

The npm package, generated HTML/JS/CSS, WASM payloads, browser screenshot, package transform, Playwright output, and logs were removed from the OS temporary directory. No browser artifact or package change is tracked.

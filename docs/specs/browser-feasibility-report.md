# Browser feasibility probe — Chrome

Verdict: **feasible for the tested workload**. This is experiment evidence, not a production implementation or a general performance guarantee.

Source: [approved AP dashboard scenario](ap-inspection-dashboard.md), particularly AP-02, AP-03, AP-06, and AP-07. The owner approved the disposable probe, then explicitly removed Edge browser work from scope and requested removal of the prototype.

## Question

Can an HTML file opened directly from disk initialize DuckDB-WASM, read explicitly selected CSV/JSON/Parquet data, reproduce the AP KPIs, and render a chart without a local server? Does the same path work with the full 390,798,150-byte AP Parquet file?

## Environment and method

- macOS, Apple M4 Pro, arm64, 24 GiB physical RAM; browser exposed 12 hardware threads.
- Installed Google Chrome 152.0.7977.83, exercised headlessly through native `agent_browser` 0.36.0 in an isolated profile.
- Opened `file:///tmp/featherbi-browser-probe.iXYfRW/unzipped/PROTOTYPE.html`, extracted from a generated ZIP; no HTTP server.
- No `--disable-web-security` or `--allow-file-access-from-files` switches observed in the isolated Chrome process tree. `crossOriginIsolated` was false.
- Pinned `@duckdb/duckdb-wasm@1.32.0` and `echarts@6.1.0`, loaded from jsDelivr. The runtime reported DuckDB v1.4.3, source ID d1dc88f950, using the EH bundle and one worker.
- ESM loader plus a Blob worker that imports the remote worker script, as in the [official instantiation example](https://duckdb.org/docs/current/clients/wasm/instantiation.html).
- Selected files registered with `registerFileHandle(name, file, DuckDBDataProtocol.BROWSER_FILEREADER, true)`, following the [official ingestion API](https://duckdb.org/docs/current/clients/wasm/data_ingestion.html). Selected files were not copied wholesale through `arrayBuffer()`.
- Embedded synthetic Parquet registered with `registerFileBuffer()` after Base64 decoding.
- File selection was exercised through browser automation's file-input API, not a human OS file chooser. Loading a `file://` URL tests the resulting document context, not the OS double-click association itself.

## Checks and observed results

A five-row synthetic dataset was written as CSV, JSON array, and Parquet. Four rows lie in the default 30-calendar-date window; one lies immediately outside. In-window expected values: four records, three orders, two non-null products, two stations, two non-null codes (50%), and one false last-measurement flag (25%). A null flag is not counted as false. CSV input was explicitly read as strings before typed projection; identifier `001` was not intended to become numeric `1`.

Five sequential runs passed after the file-replacement fix:

1. Selected CSV: registration 2 ms; first KPI query 21 ms; repeat 6 ms; query-and-render flow 93 ms.
2. Selected JSON: registration 2 ms; first KPI query 7 ms; repeat 6 ms; flow 88 ms.
3. Selected synthetic Parquet: registration 1 ms; first KPI query 12 ms; repeat 6 ms; flow 99 ms.
4. Embedded synthetic Parquet: registration 17 ms; first KPI query 3 ms; repeat 2 ms; flow 50 ms.
5. Full AP Parquet: registration 1 ms; first KPI query 223 ms; repeat 192 ms; flow 644 ms.

The final navigation's runtime boot took 299 ms. These are individual observations with warm browser/OS/CDN caches possible, not medians or cold-start service levels. The flow measurement includes registration, view setup, row count, two KPI queries, station query, rendering, and a memory diagnostic, but excludes browser launch, initial runtime boot, and user file-selection time.

Full-file default-window metrics matched the native baseline exactly:

- 34,596 records; 11,151 orders; 4,618 products; 27 stations.
- 3,105 non-null G0003 values (8.98%); 2,120 false last-measurement flags (6.13%).
- Station chart starts with SJ = 2,585 and SD = 2,476.

A separate full-history aggregation also matched: 5,384,125 records, 1,064,008 orders, 48,448 products, and 63 stations, in 464 ms. This exercises the full history for those columns; it does not decode all 70 columns or return millions of rows to JavaScript.

ECharts generated SVG paths, and the captured image shows the expected station bars and labels. The main-thread 100 ms heartbeat had a maximum observed gap of 101 ms during the final AP flow. This coarse check is not a complete responsiveness benchmark.

## Memory evidence and limitations

- `performance.memory` reported about 10.6 MB of main-thread JS heap; it does not account for worker/WASM memory and is not a total-memory measurement.
- `duckdb_memory()` returned about 766 KB of tracked allocations after the final AP flow; this likewise excludes much of the browser/worker allocation and is not a peak measure.
- A post-full-history process-tree snapshot showed approximately 1,425 MiB summed RSS across seven isolated Chrome processes, including renderers at approximately 170, 592, and 97 MiB. Summing RSS may double-count shared pages; this is neither incremental dataset memory nor measured peak memory.
- Therefore no 373 MiB file-size ceiling, maximum supported row count, or memory budget is established. Lower-memory devices and heavier queries remain untested.

## Failure discovered: reusing a virtual filename

The initial implementation always registered data as `input.parquet`. After switching between selected and embedded Parquet, even with `DROP VIEW` and `dropFiles()`, subsequent reads failed with `Invalid Error: don't know what type` or `TProtocolException: Invalid data`. A fresh runtime read the full AP file successfully. The file's browser-visible size and Parquet header/footer were valid.

Changing only registration identity to a monotonically unique filename per load made the synthetic-selected → embedded → full-file sequence pass. Evidence points to retained state associated with a reused virtual path; the exact internal cache mechanism was not established.

Production recommendation: use a new physical registration name for each source generation while keeping stable logical SQL view names. Add a file-replacement regression test. Do not treat a transient file-reader error as evidence that the dataset needs conversion or that the browser cannot handle the file size.

The initial missing-runtime assertion was observed failing before the seam was implemented. The final synthetic and full-file assertions passed after implementation and the registration fix. A separate probe SQL alias syntax error was corrected before those final runs.

## Scope and residual checks

- Embedded-versus-selected parity was verified only for the small synthetic Parquet dataset. The full AP file was not Base64-embedded or copied into a ZIP.
- CSV and JSON tests cover the small fixtures, not large-file throughput, malformed rows, every JSON shape, or the final normalization contract.
- No remote data source, enterprise authentication, offline dependency packaging, production export command, filter UI, paging, full dashboard shell, or iX components were built.
- OS-level drag/drop and manually opening the artifact were not tested. The UI contains a drop handler, but that is not execution evidence.
- CDN cold starts, network denial, artifact tampering, worker cancellation, and repeated-load memory reclamation need production-specific validation.
- Edge initially refused headless launch; the headed attempt could not establish automation. Read-only policy inspection showed HeadlessModeEnabled=0 and RemoteDebuggingAllowed=0. The owner then explicitly removed Edge work from scope. This does not invalidate the Chrome verdict, and no Edge support is claimed.
- Native cleanup of the failed headed Edge session timed out. No policies were changed and no user browser processes were force-killed. An isolated Edge window may require ordinary manual closure; no further Edge work was attempted after the owner's stop instruction.

## Evidence and disposition

- [Saved Chrome results](evidence/browser-probe-chrome.json): runtime details and five passing run records.
- [Full-history result](evidence/browser-probe-chrome-history.json).
- [Rendered chart capture](evidence/browser-probe-chrome.png).

The disposable HTML, ZIP, and synthetic fixture files are removed after preserving this report and evidence, as requested. The original AP dataset is unchanged. No prototype code is promoted into the application.

Return to design shaping: adopt browser-selected File handles as the candidate local-data path, retain the two packaging modes, and define contract validation, source lifecycle, timestamp/types, safe SQL/filter binding, result limits, dependency delivery, and failure behavior before writing implementation plans.

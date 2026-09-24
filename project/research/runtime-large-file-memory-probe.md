# Representative large-file memory probe (RI-07 / T7)

## Question and threshold

Does the ordinary supported file-load/build workflow complete on representative large local CSV and JSON inputs and an external-data ZIP, and what peak memory does it use? Per the approved specification there is **no invented performance SLA**: the pass condition is completion of the ordinary workflow with measured evidence. A failure caused by buffering or memory pressure would be a design stop returning to `shape-design`; no streaming change is implemented under this issue.

## Environment and exact versions

- Linux 6.17.0-1020-oracle, arm64 (Neoverse-N1), 4 cores, 23.4 GiB RAM
- Node.js 26.9.0; npm 11.19.1; GNU time (`/usr/bin/time -v`)
- desktop Google Chrome 154.0.8037.57, launched headless with Playwright `channel: 'chrome'` (the supported browser-gate configuration in `playwright.config.mjs`)
- featherBI at base `9ea97a942011646e0be4dc4d8e161008bb4a754b` (after issue #20)
- `@duckdb/duckdb-wasm 1.33.1-dev64.0` (CDN-pinned by the runtime), `apache-arrow 17.0.0`, `client-zip 2.5.1`, `esbuild 0.28.2`, `@playwright/test 1.63.0`

All generated data is synthetic and deterministic (seeded LCG; no real or private data). Temporary generator, projects, artifacts, and result JSON live under a scratch `$TMP` directory outside the repository and are untracked.

## Cases and inputs

Three cases used the ordinary supported commands (`featherbi compile`, `featherbi build`, recipient extraction, `file://` open in desktop Chrome, explicit file selection in the viewer UI). Each project declares one KPI `count(*)` per source with a five-column schema (`order_number` string, `station` string, `amount` number nullable, `quantity` integer, `inspected_at` timestamp), mirroring `examples/basic-dashboard`.

| Case | Input | Rows | Size |
| --- | --- | --- | --- |
| csv | `$TMP/data/inspections.csv` | 1,500,000 | 70,129,312 B (66.9 MiB) |
| json | `$TMP/data/inspections.json` (array of objects) | 400,000 | 46,265,592 B (44.1 MiB) |
| zip | both files as external-data ZIP members (`orders.csv`, `events.json`) | 1,500,000 + 400,000 | 117,188,378 B ZIP (111.0 MiB members) |

Input digests (sha256): CSV `2f729a9282d240c9972bc9b4c30edcefbe1d5f1b17b735402d36d403b2dfd443`, JSON `69bd66dd0c1b2ef60d8e585045b7a2989853d7459fd0ce2919b3715dd81d1163`. The ZIP stores members uncompressed (client-zip STORED); `dashboard.html` is ~793 kB.

## Reproducible commands

Generator (exact spec, byte-reproducible): for row `i`, draw `r = next()` from the LCG `seed = (imul(seed, 1664525) + 1013904223) >>> 0` starting at `0x2a6f2b1`; `station = ST-A..ST-F` by `r % 6`; `amount = ((r >>> 8) % 100000) / 100` with `null` when `r % 128 === 0`; `quantity = r % 99 + 1`; `inspected_at` = `2026-06-01` plus `r % 90` days with time-of-day `r % 86400` seconds, formatted `YYYY-MM-DD HH:MM:SS`; `order_number = ORD-` + zero-padded 7-digit `i`. CSV writes a header row then one row per line; JSON writes `[\n` + comma-joined objects + `\n]`.

```sh
node $TMP/gen.mjs csv 1500000 $TMP/data/inspections.csv
node $TMP/gen.mjs json  400000 $TMP/data/inspections.json
# per case (csv shown; json identical shape; zip assigns both files as two sources):
node bin/featherbi.mjs compile --project $TMP/probe/csv/dashboard.yaml
/usr/bin/time -v node bin/featherbi.mjs build \
  --config $TMP/probe/csv/.featherbi/dashboard.config.json \
  --source inspections=$TMP/data/inspections.csv \
  --output $TMP/out/csv/dashboard.zip --overwrite
unzip -q $TMP/out/csv/dashboard.zip -d $TMP/out/csv/extracted
node $TMP/browser-probe.mjs csv $TMP/out/csv/extracted $TMP/results/browser-csv.json '<case def>'
```

The browser probe is a temporary Playwright script (untracked): launches desktop Chrome (`channel: 'chrome'`, headless), opens the extracted `dashboard.html` through `pathToFileURL` (`file://`), sets the packaged data file(s) on `#source-<id>` inputs, clicks `#replace-files`, waits for `#dashboard-status[data-state=ready]` and each `#component-<id> [data-value]` to equal the expected formatted count, and samples `/proc` for the whole Chrome process tree every 250 ms while reading `VmHWM` (kernel peak-RSS high-water mark) per process at the end. JS heap comes from CDP `Performance.getMetrics`.

## Observed Node evidence

`/usr/bin/time -v` peak RSS (exact `Maximum resident set size`):

| Case | compile peak RSS | build peak RSS | build elapsed | build result |
| --- | --- | --- | --- | --- |
| csv (66.9 MiB input) | 78,936 kB | 293,508 kB (≈ 4.3× input) | 980 ms | exit 0, 70,922,080 B ZIP |
| json (44.1 MiB input) | 79,120 kB | 223,752 kB (≈ 5.0× input) | 550 ms | exit 0, 47,058,365 B ZIP |
| zip (111.0 MiB members) | 79,200 kB | 428,556 kB (≈ 3.7× members) | 1,240 ms | exit 0, 117,188,378 B ZIP |

Compile elapsed 270–400 ms per case. The build buffers each source with `readFile`, renders the HTML, and assembles the whole ZIP in memory (`packager/build.mjs:26-48`, whose inline note already names streaming to a temp file as the measured-bottleneck upgrade).

## Observed browser evidence

Desktop Chrome, `file://`, DuckDB-WASM booted from the pinned CDN bundle; every case completed with the expected KPI value rendered (`1,500,000` / `400,000`), no page errors, no renderer crash.

| Case | renderer peak RSS (VmHWM) | Chrome tree peak (sum of per-process peaks) | ready after click | KPI rendered | page-main JS heap at end |
| --- | --- | --- | --- | --- | --- |
| csv | 723,800 kB (≈ 10.6× input) | 1,568,856 kB | 5,560 ms | 5,591 ms | 3,477,136 B |
| json | 839,464 kB (≈ 18.6× input) | 1,688,308 kB | 6,605 ms | 6,648 ms | 45,162,292 B |
| zip | 842,944 kB (≈ 7.4× members) | 1,694,292 kB | 9,425 ms | 9,482 ms | 45,282,164 B |

Page load of the local `dashboard.html` took 113–173 ms; selecting the input files 234–304 ms. The page renderer (largest of three renderer processes) hosts the DuckDB-WASM worker; its peak includes the WASM heap, which the CDP JS-heap metric does **not** cover — the JS-heap column above is explicitly partial (page main heap only). The combined ZIP case peaks near the JSON-only case, indicating per-source buffering is transient and sequential rather than fully additive.

## Where the memory goes (measured flows, code pointers)

- `packager/build.mjs:29,48` — every source read fully into a Buffer plus the complete ZIP assembled in memory before atomic publication.
- `runtime/sources.mjs:236-242` — CSV/JSON header detection decodes the **entire selected file** to a UTF-16 string (`handle.text()`), roughly 2× file size in the renderer, before registration.
- `runtime/sources.mjs:450` — JSON array input additionally runs `JSON.parse(text)` over the whole file, materializing all row objects at once (this is why the JSON case shows the highest multiplier).
- `runtime/sources.mjs:254-265` — the file handle is then registered with DuckDB-WASM (FileReader protocol), which copies the data into the WASM heap; DuckDB rescans the full source for the registration nullability/hash check before queries run.

## Repeatability

The complete probe ran twice; build peak RSS repeated within 0.2%, renderer peak within 5%, ready-time within 6% (e.g. csv renderer peak 727,316 → 723,800 kB; zip build RSS 429,096 → 428,556 kB).

## Limitations

- One machine class (4-core arm64, 23.4 GiB RAM, Linux); representative sizes were chosen (tens of MiB, millions of rows), not derived from a ceiling, and no SLA is claimed from them.
- `/proc` sampling is 250 ms; short sub-interval spikes can be missed between samples, but per-process `VmHWM` is the kernel's exact high-water mark. Renderer attribution uses the largest renderer process (Chrome rewrites child argv, so renderers are identified by `--renderer-client-id=`).
- Headless Chrome matches the supported browser-gate launch mode; headed compositing may add a little GPU-process memory.
- Parquet is out of scope: its file-handle path is unchanged by the specification.
- Peak numbers include cold CDN fetch of the ~50 MB DuckDB-WASM module in the browser process tree; this is part of the ordinary supported flow.

## Verdict: completed, no design stop

The representative CSV, JSON, and external-data ZIP workflows all completed through the ordinary supported commands in seconds with expected results. No buffering or memory failure occurred, so per RI-07 no streaming change is triggered by this evidence. The measured multipliers (Node build ≈ 4–5× input, page renderer ≈ 7–19× input, highest for JSON arrays because of the whole-file string decode plus `JSON.parse`) quantify today's buffering cost and are the baseline any future streaming design would have to beat; extrapolating them linearly to substantially larger files is a first-order estimate, not a guarantee.

## Cleanup

The generator, probe projects, extracted artifacts, and result JSON remain under `$TMP` (untracked, outside the repository) for parent inspection. No repository file other than this document changed.

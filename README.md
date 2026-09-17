# featherBI

featherBI turns a declarative dashboard project (YAML, SQL, and optional CSS) and local CSV, Parquet, or JSON files into a portable dashboard. Authors build artifacts; recipients open and filter them in desktop Google Chrome without a local server.

## Author prerequisites

- Node.js 24 or newer and npm
- desktop Google Chrome
- network access when opening dashboards, for pinned DuckDB-WASM runtime assets

```sh
npm ci
node bin/featherbi.mjs profile --input path/to/inspections.parquet \
  --source-id inspections --format parquet
node bin/featherbi.mjs compile \
  --project examples/basic-dashboard/dashboard.yaml
node bin/featherbi.mjs validate \
  --config examples/basic-dashboard/.featherbi/dashboard.config.json
```

The profile defaults to aggregate schema/count evidence without raw rows, values, or input paths. `--include-values` is an explicit permission boundary for bounded ranges and top values. Project source is `dashboard.yaml` plus external `queries/*.sql` (and optional `models/*.sql` and `theme.css`); generated config and local mappings stay under the project's ignored `.featherbi/` directory. The AP example project lives at `examples/ap-dashboard`.

Build one artifact with an explicit local file for every source ID:

```sh
node bin/featherbi.mjs build \
  --config examples/basic-dashboard/.featherbi/dashboard.config.json \
  --source inspections=path/to/inspections.parquet \
  --output examples/basic-dashboard/.featherbi/dashboard.zip
```

The result is one ZIP bundle containing `dashboard.html` plus each data file; dataset bytes never become part of the HTML.

An existing output is preserved unless `--overwrite` is supplied. Packaging writes local artifacts only; it does not publish, deploy, or upload data. Agents should follow [`skill/featherbi/SKILL.md`](skill/featherbi/SKILL.md): edit the project source, compile, and invoke the packager rather than generating HTML.

## Recipient use

Extract the ZIP bundle, open `dashboard.html` through `file://` in desktop Chrome, then explicitly select each accompanying data file under **Data files**. DuckDB-WASM reads the selected local files directly. “Upload” in the UI means local browser selection; featherBI has no application data-upload or telemetry endpoint.

Chrome is the supported browser for this release. Edge and offline operation are not claimed. If pinned online runtime assets cannot load, the dashboard reports a visible boot error rather than working offline.

## Exploration capabilities

Contract-v2 projects may select `rendererPreset: standard | perspective-first`, add typed `perspective` components, and enable the session-only SQL playground with `playground.renderer: ag-grid | perspective`. Tables use AG Grid Community only. Playground SQL is one engine-admitted SELECT/CTE over declared sources/models and is limited to 10,000 rows, 8 MiB Arrow IPC, and 30 seconds; cancellation uses DuckDB-WASM's `AsyncDuckDBConnection.send()` and `cancelSent()` on a dedicated connection.

Perspective 3.8.0 receives only completed bounded Arrow results. The `file://` build embeds the three published WASM assets and registers the chart through the package's published `@finos/perspective-viewer-d3fc/column` export; it does not rewrite installed package files. Capability metadata in the artifact lists stable selected versions and Perspective asset hashes. See `examples/exploration-dashboard` for the complete source shape.

## Trust limits

A shared artifact exposes every included or accompanying row to its recipient; source-system permissions do not follow the data. Runtime dependencies execute in the dashboard's browser context, and authored SQL is trusted code rather than a hostile-code sandbox. Inspect artifacts and share them only with authorized recipients. Replacing data in the browser changes only that session and does not rewrite the saved artifact.

## Development checks

```sh
npm run build
npm run check
npm run test:browser
```

The lockfile narrowly overrides Perspective D3FC's `d3-svg-legend` transitive `d3-color` to compatible exact `3.1.0` for GHSA-36jr-mh4h-2g58; Perspective remains pinned at 3.8.0.

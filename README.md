# featherBI

featherBI turns a declarative dashboard config and local CSV, Parquet, or JSON files into a portable dashboard. Authors build artifacts; recipients open and filter them in desktop Google Chrome without a local server.

## Author prerequisites

- Node.js 24 or newer and npm
- desktop Google Chrome
- network access when opening dashboards, for pinned DuckDB-WASM runtime assets

```sh
npm ci
node bin/featherbi.mjs validate --config skill/featherbi/examples/ap.config.json
```

Build one artifact with an explicit local file for every source ID:

```sh
node bin/featherbi.mjs build \
  --config skill/featherbi/examples/ap.config.json \
  --source ap=path/to/ap.json \
  --output dashboard.zip
```

The result is one ZIP bundle containing `dashboard.html` plus each data file; dataset bytes never become part of the HTML.

An existing output is preserved unless `--overwrite` is supplied. Packaging writes local artifacts only; it does not publish, deploy, or upload data. Agents should follow [`skill/featherbi/SKILL.md`](skill/featherbi/SKILL.md): author config, validate it, then invoke the packager rather than generating HTML.

## Recipient use

Extract the ZIP bundle, open `dashboard.html` through `file://` in desktop Chrome, then explicitly select each accompanying data file under **Data files**. DuckDB-WASM reads the selected local files directly. “Upload” in the UI means local browser selection; featherBI has no application data-upload or telemetry endpoint.

Chrome is the supported browser for this release. Edge and offline operation are not claimed. If pinned online runtime assets cannot load, the dashboard reports a visible boot error rather than working offline.

## Trust limits

A shared artifact exposes every included or accompanying row to its recipient; source-system permissions do not follow the data. Runtime dependencies execute in the dashboard's browser context, and authored SQL is trusted code rather than a hostile-code sandbox. Inspect artifacts and share them only with authorized recipients. Replacing data in the browser changes only that session and does not rewrite the saved artifact.

## Development checks

```sh
npm run build
npm run check
npm run test:browser
```

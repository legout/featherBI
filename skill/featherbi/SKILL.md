---
name: featherbi
description: Understand local sample data, design and build a featherBI dashboard project, choose evidence-backed metrics/charts/filters, or iterate and package an existing dashboard. Never hand-write executable HTML.
---

# featherBI authoring

## Start safely

Work from the featherBI repository root and preserve existing project files:

```sh
test -f bin/featherbi.mjs
npm ci
```

Generated/private state belongs only in the project's ignored `.featherbi/` directory. Do not copy source data, absolute paths, profiles, generated JSON/HTML, screenshots, or ZIPs into portable source or commits.

## Progressive tracer

1. Profile every representative source without values:

   ```sh
   node bin/featherbi.mjs profile --input /absolute/local/file.parquet \
     --source-id inspections --format parquet \
     --output path/to/project/.featherbi/profile.json
   ```

   Explain material row/schema/null/approximate-cardinality evidence. Use `--include-values` only after explicit permission for bounded ranges and top values. Stop on profile errors; never guess schema.
2. Ask only the initial decision frontier: audience/decisions; authoritative metric meaning, units, population/time window; filters/lookups; required views/interactions; and update cadence. For this tracer recommend the `standard` preset and neutral theme; SQL playground, alternate presets/themes, models, and expanded layout/catalog remain deferred.
3. Copy [`templates/basic-dashboard/`](templates/basic-dashboard/) and edit the same source-only `dashboard.yaml` and `queries/*.sql`. Record absolute source assignments only in ignored `.featherbi/local-sources.yaml`.
4. Compile, fix every filename/line/column error, then validate:

   ```sh
   node bin/featherbi.mjs compile --project path/to/project/dashboard.yaml
   node bin/featherbi.mjs validate --config path/to/project/.featherbi/dashboard.config.json
   ```

5. Build through the existing external-data packager with one explicit mapping per source, extract the ZIP, and open `dashboard.html` through `file://` in desktop Chrome:

   ```sh
   node bin/featherbi.mjs build \
     --config path/to/project/.featherbi/dashboard.config.json \
     --source inspections=/absolute/local/file.parquet \
     --output path/to/project/.featherbi/dashboard.zip
   ```

6. Explicitly select each extracted data file in Chrome. Verify visible values against independent profile/query evidence; config validation alone is not success.
7. Ask targeted feedback about correctness, missing decisions, filters, chart choice, labels, and density. Edit the same YAML/SQL source, rebuild, reselect, and reverify.
8. Stop when approved or paused. Commit, push, publication, issue closure, and release are separate actions and never implied by a successful preview.

See [`references/project-tracer.md`](references/project-tracer.md) for the supported schema, relationship boundary, and failure checklist.

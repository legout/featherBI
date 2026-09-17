# Changelog

## Unreleased

## 0.1.0 - 2026-09-17

First release: local-data BI dashboards authored as editable source projects, compiled to a self-contained browser viewer, and shared as external-data ZIP bundles.

### Authoring workflow

- Added the `featherbi` authoring skill: bounded profiling, evidence-led progressive interviews, project scaffolding, compilation, `file://` Chrome preview, feedback-driven source edits, and verified packaging.  #3, #8
- Added dashboard projects (`project: 1`): strict YAML with external `queries/*.sql` and scoped CSS as the editable source of truth, compiled deterministically into runtime contract 2 with source-located errors.  #5
- Added a PEP 723 profiler (pinned DuckDB 1.4.3) and `profile`/`compile` CLI commands with a starter template.  #5

### Analytical and exploration runtime

- Added the responsive themed analytical runtime: acyclic SQL models, dimensions, measures, ratios, validated 12-column layout, neutral/daisyUI/Siemens-iX themes, scoped trusted CSS, and a typed chart/filter/component catalog with coherent cross-filtering and stale-result protection.  #6
- Added the exploration runtime: AG Grid Community tables, bounded Perspective components with a Perspective-first preset, and a CodeMirror SQL playground with engine-backed admission, real cancellation, and 30s/10k-row/8MiB limits.  #7
- Added lossless Perspective-first mappings for heatmap, sankey, and boxplot so accepted chart types never drop fields.  #9
- Removed runtime contract v1; contract 2 is the only supported runtime and old v1 configs are rejected.  #8

### Delivery and data

- Delivered ZIP-only external-data artifacts: dataset bytes stay outside the HTML; recipients open `dashboard.html` under `file://` and explicitly select the accompanying data files.  #3
- Kept DuckDB-WASM as the sole source/query/filter owner; Perspective receives only bounded completed results.  #7
- Migrated the AP inspection dashboard to a source-only v2 project and reproduced private acceptance (34,596 records, 11,151 orders, 4,618 products, 27 stations).  #8
- Relocated project documentation from `docs/` to `project/`.

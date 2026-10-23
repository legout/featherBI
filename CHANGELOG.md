# Changelog

## Unreleased

## 0.3.0 - 2026-10-23

> **Release exception:** the owner approved publication before the SL-08 hosted real-data acceptance. That acceptance remains pending in #45; passing automated checks does not replace it.
>
> **Known dependency findings:** `npm audit` reports six high-severity findings in the release lockfile (`@parcel/watcher`, `@tailwindcss/cli`, `braces`, `micromatch`, `follow-redirects`, and `source-map-js`). They remain unresolved; no dependency updates are included in this release.

- Added live Parquet file sets selected by glob or manifest and live Iceberg tables selected by metadata URI or REST catalog identity; generations remain pinned until explicit Refresh, and recipient credentials stay in memory.  #31–#35
- Improved paged tables with query-level sorting over the full result and disabled misleading page-local column filters; the snapshot note now appears only with a latest-days date-range filter.  #47, #48
- The profiler now emits featherBI column types directly and fails actionably on unsupported DuckDB types; shared remote profiling helpers and authoring rules are consolidated.  #46, #49
- Perspective, the SQL playground, and the `perspective-first` preset are explicitly opt-in in the authoring guidance.  #51
- **Breaking:** setup now uses one shared agent-skill path: `.agents/skills` in the project, or `~/.agents/skills` with `--global`. Removed the `--agent` variants and DuckDB-skills prompt; `--design` remains opt-in, and existing real destination directories are never overwritten.  #50
- Added static sharing as the primary artifact: `featherbi build --target static` writes one self-contained `dashboard.html` that accepts only live sources and carries an exact-origin Content-Security-Policy; the external-data ZIP stays the fallback for local and packaged sources.  #42, #43
- Added an explicit Refresh control for every live source kind; refreshes stage a new generation and keep previous results visible with a source-specific error on failure.  #40
- Added `featherbi export delta`: an author-side native-DuckDB export of a Delta snapshot into immutable Parquet part files plus root `manifest.json` and an `export.json` sidecar, published by the author and declared as a live Parquet set.  #41
- Added the live DuckLake table source — a public `https://` catalog URI plus one explicitly named table with `auth: none` — read in the browser through the pinned trusted extension capability.  #44
- Added the theme-token system: a validated `theme.tokens.yaml` compiles into a baked theme (scoped CSS variables including AG Grid `--ag-*` overrides, plus a registered ECharts theme) with advisory contrast warnings that never fail the build; `siemens-ix` is now the dark Siemens Industrial Experience preset and `siemens-ix-light` the light one (both still explicit-only selections), and the authoring skill turns style prompts into token files instead of free-form chart CSS.  #29
- **Breaking:** the standard theme is now the `vercel` token preset (white surface, near-black/gray text and charts, black `#0a0a0a` accent, blue `#0070f3` success, red negative) derived from the approved mockup; dashboards without an explicit `theme` change appearance. Keep the previous look with `theme: neutral`. `themeTokens` stays valid with the default and `theme: neutral`; `daisyui` and the Siemens presets still reject it.  #52
- **Breaking:** metric-group markup changed: each metric now renders as one label-over-value row (wrapper `[data-metric-row]`, label `[data-metric-label]`; values keep `[data-metric]`), replacing bare concatenated `<output>` elements. Update scoped `theme.css` selectors targeting the old markup.  #27
- **Breaking:** filter markup changed: filters render as one contained bar; each control is a `[data-filter]` column with a small `[data-filter-caption]` above a `[data-filter-controls]` row, replacing `fieldset`/`legend`. Boolean filters render as a `[data-segmented]` All/Yes/No radio group (IDs, names, and values unchanged). Update scoped `theme.css` selectors targeting the old markup.  #28

## 0.2.0 - 2026-09-28

- Added read-only `s3://` and `https://` sources with packaged or live delivery, including session-only credential prompts for private live sources.
- Added `featherbi setup` for prerequisite checks and optional DuckDB agent skills; project setup now installs the bundled featherBI skill beside them, while `--global` installs globally.
- Added typed chart-mark and Perspective grouped/split selection, accessible All/Yes/No filter choices, and safe-subset Markdown in content components.
- Improved live-source authentication errors and retry behavior, preserved drafts after option-load failures, and corrected bounded Arrow result assembly.
- Excluded Python `__pycache__` files from the npm package.

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

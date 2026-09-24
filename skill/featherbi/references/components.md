# Component, filter, and interaction catalog

Every component has an `id`, `label`, grid placement (`x`, `y`, `width`, `height` on 12 columns), a `query` where applicable, and explicit empty/error behavior. Text is escaped; nothing accepts JavaScript, raw HTML, or raw chart option objects.

## Components

- **Content:** `heading`, `markdown`, `text` (escaped), `divider`, `tabs`/`section` (containers own their alternatives; members may overlap only within the same tab).
- **Metrics:** `kpi` (`field`, optional `decimals`) and `metric-group` (`fields`, optional `decimals`).
- **Charts (ECharts, typed fields):** `bar` (`orientation: horizontal` for station-style activity), `line`, `area`, `scatter`, `pie`/`donut` (`name`/`value`), `heatmap` (`xField`/`yField`/`value`), `treemap`, `sankey` (`source`/`target`/`value`), `gauge`, `boxplot` (`xField`, `min`/`q1`/`median`/`q3`/`max`). Charts accept `annotations: [{at: YYYY-MM-DD, label}]` on bar/line and `series` for split-by.
- **Table:** `table` with `columns: [{field, label}]`; AG Grid Community features only, server-side paging, no Enterprise options such as `rowGroup`.
- **Exploration:** `perspective` components or `rendererPreset: perspective-first`; they receive one named bounded query result.
- **SQL playground:** `playground: {renderer: ag-grid | perspective}` enables a session-only recipient query console (one admitted SELECT/CTE, 10,000 rows, 8 MiB, 30 s).

## Filters (shared, typed)

`select`, `single-select`, `multi-select`, `option-search`, `text`, `date-range`, `numeric-range` (inclusive `from`/`through` display), `boolean`. Each filter binds one source column with a compatible type and declares a `default` (`null`, list, `{kind: latest-days, days}`, or `{kind: fixed, from, through}`).

## Interactions

Components declare `interactionDimension` (click replaces, modifier-click adds/removes multi-select values, re-click clears) and optionally `selectionDimensions`, an explicit `{resultField: dimensionId}` mapping for multi-field marks (chart category/series, sankey source/target, heatmap x/y). The compiler rejects undeclared dimension IDs, fields the component cannot emit, and conflicts with `interactionDimension`; a dimension without a shared filter is a valid local-only binding. `brushDimension` (date brush sets a date-range filter) and table columns with `dimension` bindings work as before. Clicking a plotted mark supplies the underlying typed result values — never reconstructed from labels — and commits all pending filter control edits plus the selection in one revision; option search, pagination, and unrelated renders preserve pending edits, selected off-page options, typed search text, and keyboard focus. With no compatible shared filter the selection stays local with a visible indication. Every interaction creates a coherent filter revision; stale results never render.

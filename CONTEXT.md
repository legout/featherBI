# featherBI vocabulary

| Term | Meaning |
|---|---|
| **Dashboard config** | The one file the agent writes (`dashboard.yaml`): sources, dimensions, date, tiles. Everything after it is deterministic. |
| **Source** | A named DuckDB table expression that is read at build time (a file, table format, database or object store). |
| **Snapshot** | The Parquet data `build` writes from the sources and embeds in or ships with the HTML. The browser only ever reads the snapshot. |
| **Snapshot table** | One table of the snapshot, named after its source. Tile SQL may reference only snapshot tables. |
| **Source SQL** | The DuckDB expression or query that reads a source. It runs only in the native CLI at build time and is never shipped. |
| **Tile SQL** | The SQL of a tile. It runs in the browser over snapshot tables, with `{{filters:<table>}}` placeholders, and must meet its tile type's result contract. |
| **Tile** | One element of the dashboard: `kpi`, `echarts`, `pivot`, `table`, `text`. It is configured, never coded. |
| **Preset** | A reviewed ECharts option template from the skill (for example `donut`, `heatmap`), selected by name in a tile. |
| **Dimension (dim)** | A column that filters can select or cross-filter on. Every filterable column must be declared. |
| **Cross-filter** | A filter set by clicking an element of a tile. It applies to all tiles, except where a tile `exclude`s that dimension. |
| **Engine adapter** | The small layer that hides which browser DuckDB build runs (Haybarn-Wasm by default, upstream duckdb-wasm as an alternative). |
| **Remote snapshot** | Snapshot tables uploaded to an S3-compatible bucket by `build --remote` and reached from the HTML through presigned GET URLs that expire (spec 0002). |
| **Theme** | The look of a dashboard: a built-in name or a theme file, selected with `theme:` in the dashboard config and embedded in the HTML (spec 0003). |
| **Theme file** | The author's YAML with colours for light and dark, chart palette, corner radius, font and logo. Built-in themes are theme files in the skill. |
| **Header line** | The line under the page title: `Data as of <last date> · Period <first date> – <last date>`, plus `· Source <label>` when the config sets `source_label`. The dates are the snapshot's, fixed at build time (spec 0005 §4). |
| **Section** | A titled group of tiles in the dashboard config (`sections`, in place of `tiles`). Filters apply across all sections (spec 0005 §5). |
| **Layout** | How sections are shown: `stack` (all, one under the other, the default) or `tabs` (one tab per section; a closed tab does not query). |
| **Design** | The layout of a dashboard's page, one of four built into the skill and selected with `design:` in the dashboard config; `classic-bi` is the default. A theme still owns colours, font and logo (spec 0006, ADR 0004). |
| **Tile size** | A tile's priority, `size: small`, `medium`, `large` or `wide`; each design maps it to its grid. A KPI is `small` and every other tile `medium` by default. |
| **Shell** | The browser module that renders the page chrome (header, filter bar, sections or tabs, cards, Explore dialog) through the versioned shell contract (`shell: 1`, `references/shell.md`). The default ships with the skill; `build --shell <file>` swaps it (spec 0005 §6, ADR 0003). |
| **Explore** | The on-demand Perspective panel for free pivoting. It is not a tile and is not re-rendered by filters. |
| **Brainstorming mode** | The skill flow for "make me a dashboard from this data": profile, domain guess, one interview round, three proposals, build the picked one (spec 0004). Skipped when the request is specific. |
| **Domain playbook** | A per-domain reference in the skill (`references/domains/<domain>.md`) with detection signals, interview questions, figures, tile ideas and traps, read in brainstorming mode. |

# Config reference: `dashboard.yaml`

One YAML mapping. The build checks it against `schema/dashboard.schema.json` and runs every tile SQL before it writes anything.

```yaml
title: Sales overview          # required
name: sales-overview           # optional; kebab-case file name, default: the title
engine: haybarn                # optional: haybarn (default) or duckdb-wasm
sources:
  sales:   { read: "read_parquet('data/sales.parquet')" }
  targets: { read: "read_xlsx('data/targets.xlsx')" }
dims:
  region:  { col: region }
  channel: { col: channel }
date: { col: order_date, default: last_12_months }
explore: true                  # optional; false turns Explore off
tiles:
  - { type: kpi, title: Revenue, format: currency,
      sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}" }
```

## Keys

| Key | Meaning |
|---|---|
| `title` | Required. Page title. |
| `name` | Output file name; letters and digits, kebab-cased. Defaults to `title`. |
| `engine` | `haybarn` (default) or `duckdb-wasm` (upstream). `--offline` needs `haybarn`. |
| `sources` | Required. Name → one of `read` (a DuckDB table expression) or `attach` + `table`/`sql`. The name must be a plain identifier (`[A-Za-z_][A-Za-z0-9_]*`) and becomes the table name in tile SQL. Remote sources: `sources.md`. |
| `dims` | Filterable dimensions: `name: { col, cols? }`. `cols` overrides the column per table (`cols: { targets: region_code }`). A table without the column is not filtered by that dimension. `date` is reserved; do not name a dimension `date`. |
| `date` | `{ col, cols?, default }`. `default`: `last_12_months` (the 12 months ending at the latest date in the data), `all`, or `{ from: 2025-01-01, to: 2025-03-31 }`. A table without a date column is not date-filtered. |
| `explore` | `true` (default), `false`, or `{ table: <source> }`. Opens a Perspective viewer on that table (default: the first source) with the filters active at that moment. |
| `tiles` | Required, at least one. Optional `id` (letters, digits, `_`, `-`) names the tile in error messages. |

## Filters in tile SQL

`{{filters:<table>}}` expands to the active filters that apply to that table (`TRUE` when none). With an alias: `{{filters:sales AS s}}`. A join uses one placeholder per table. `exclude: [dim]` on a tile drops that dimension from its placeholders, so a tile does not filter itself. Each dimension holds one value; a click or select replaces it, clicking again clears it.

## Tiles

| `type` | Keys | SQL result |
|---|---|---|
| `kpi` | `sql`, `compare`, `spark`, `format` | see `presets.md` |
| `echarts` | `preset`, `sql`, `click`, `exclude`, `format`, `option` | the preset's columns, see `presets.md` |
| `pivot` | `sql`, `click`, `format` | rows `r, c, v`; optional booleans `r_total, c_total` mark total rows/columns |
| `table` | `source`, `columns` | none: the renderer pages the source table; every column must exist in it |
| `text` | `markdown` | none |

Pivot totals come from SQL, for example:

```yaml
- type: pivot
  title: Region × month
  click: region
  sql: >-
    SELECT COALESCE(region, 'Total') AS r,
           COALESCE(strftime(order_date, '%Y-%m'), 'Total') AS c,
           SUM(revenue) AS v,
           GROUPING(region) = 1 AS r_total,
           GROUPING(strftime(order_date, '%Y-%m')) = 1 AS c_total
    FROM sales WHERE {{filters:sales}}
    GROUP BY GROUPING SETS ((region, strftime(order_date, '%Y-%m')), (region), (strftime(order_date, '%Y-%m')), ())
    ORDER BY r_total, r, c_total, c
```

Without the marker columns no totals are shown. A `click` on a pivot sets that dimension to the row's `r`; total rows and columns are not clickable. A complete working example: `fixtures/hand/dashboard.yaml` and `pivot-table.yaml` in the repository.

## Build command

```sh
node scripts/featherbi.mjs build dashboard.yaml [--out <path>] [--offline | --split]
node scripts/featherbi.mjs profile <file or table expression>…
```

| Mode | Writes | Opens |
|---|---|---|
| default | `dist/<name>.html` next to the config: snapshot and CSS inlined, JS from a pinned CDN | double-click, or any web server; needs network for the CDN |
| `--offline` | one HTML file with everything inlined (engine, libraries, Perspective); the size is printed | double-click, no network |
| `--split` | a folder `dist/<name>/` with `index.html` and one `<source>.parquet` per source | **only through a web server**, e.g. `python3 -m http.server` inside the folder; not `file://` |

- `--out <path>` sets the file (default and `--offline`) or the folder (`--split`). Relative `--out` resolves from your cwd; the default output and source paths resolve from the config file's folder.
- **`--offline` is not supported with `engine: duckdb-wasm`.** Upstream duckdb-wasm fetches its Parquet extension over HTTP at first query, so an offline file could not read its own snapshot. The build rejects the combination; use the default `engine: haybarn` for `--offline`.
- `--offline` and `--split` cannot be combined.
- A `--split` folder must be new, empty, or hold only an earlier featherBI split build. Otherwise the build stops before writing anything and names the foreign files.
- When the embedded Parquet exceeds 25 MB the build warns. Build with `--split`, or aggregate in the source SQL.

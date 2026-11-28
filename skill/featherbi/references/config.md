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
| `dims` | Filterable dimensions: `name: { col, cols? }`. `cols` overrides the column per table (`cols: { targets: region_code }`). A table without the column is not filtered by that dimension. `date` and `tab` are reserved (the URL hash uses them); do not name a dimension `date` or `tab`. |
| `date` | `{ col, cols?, default }`. `default`: `last_12_months` (the 12 months ending at the latest date in the data), `all`, or `{ from: 2025-01-01, to: 2025-03-31 }`. A table without a date column is not date-filtered. With `date` the header shows a line under the title: `Data as of <last date> · Period <first date> – <last date>`, the first and last date of all dated tables in the snapshot (an open-ended `infinity` date is left out), fixed at build time and written in `locale`. |
| `theme` | Optional. The look: a built-in theme (`default`, `corporate`, `minimal`, `high-contrast`) or a theme file relative to the config file, e.g. `./brand/theme.yaml`. See `themes.md`. |
| `locale` | Optional. A BCP 47 tag such as `de-DE`: every number and date the page formats uses it (KPI values and Δ %, chart tooltips and value-axis labels, pivot cells, table cells, the table date column, the header line). Default `en-US`. The build rejects a tag its `Intl` does not support. It changes formats only, not the page's own labels. |
| `subtitle` | Optional. One line of plain text under the title, at most 200 characters. |
| `source_label` | Optional. Plain text, at most 200 characters, shown in the header line as `Source <label>`. Without it the page names no source; source SQL, paths, hosts and bucket names never reach the page. |
| `explore` | `true` (default), `false`, or `{ table: <source> }`. Opens a Perspective viewer on that table (default: the first source) with the filters active at that moment. |
| `tiles` | The tiles, at least one; a config has either `tiles` or `sections`. Optional `id` (letters, digits, `_`, `-`) names the tile in error messages. |
| `sections` | In place of `tiles`: a list of `{ title, tiles }`. `title` is required and unique; every section has at least one tile; tile ids are unique across all sections. Filters, chips, Reset, clicks and the URL hash work across all sections. Errors name the section and the tile: `section "<title>", tile "<id or number>": …`. |
| `layout` | Only with `sections`. `stack` (default): each section is a titled group in config order, its KPIs in their own row at its top. `tabs`: one tab per section, the first open on load. Tiles in a closed tab do not query; opening a tab queries them for the current filters. The open tab is in the URL hash as `tab=<n>` (1-based) when it is not the first. |

## Filters in tile SQL

`{{filters:<table>}}` expands to the active filters that apply to that table (`TRUE` when none). With an alias: `{{filters:sales AS s}}`. A join uses one placeholder per table. `exclude: [dim]` on a tile drops that dimension from its placeholders, so a tile does not filter itself. Each dimension holds one value; a click or select replaces it, clicking again clears it.

## Tiles

| `type` | Keys | SQL result |
|---|---|---|
| `kpi` | `sql`, `compare`, `spark`, `format`, `note` (plain text under the value, at most 200 characters) | see `presets.md` |
| `echarts` | `preset`, `sql`, `click`, `exclude`, `format`, `option` | the preset's columns, see `presets.md` |
| `pivot` | `sql`, `click`, `format` | rows `r, c, v`; optional booleans `r_total, c_total` mark total rows/columns |
| `table` | `source`, `columns` | none: the renderer pages the source table; every column must exist in it |
| `table` | `sql`, `click`, `exclude` | any: the columns are the result's columns, in SQL order |
| `text` | `markdown` | none |

`format` (on `kpi`, `echarts`, `pivot`) is `number` (default, at most 2 fraction digits), `currency` (US dollars), `percent` (the value is a ratio: 0.25 → 25 %), or a mapping with any of these keys:

| Key | Meaning |
|---|---|
| `style` | `number` (default), `currency` or `percent`. |
| `decimals` | 0–6: exactly that many fraction digits. |
| `currency` | A three-letter ISO 4217 code for `style: currency`, e.g. `EUR`. Default `USD`. |
| `unit` | Text appended after a non-breaking space: `{ decimals: 2, unit: m³/t }` → `88.66 m³/t`. |

```yaml
locale: de-DE
tiles:
  - { type: kpi, title: Revenue, format: { style: currency, currency: EUR },   # 2.260,50 €
      sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}" }
```

Table cells take no `format`: a number is written in the locale, a `DECIMAL(p,s)` column with exactly `s` fraction digits (`1,410.50`), any other number with at most 2. The date column is ISO (`2025-01-05`) without `locale` and the locale's numeric short date with it (`05.01.2025`).

A `table` takes exactly one of `source` and `sql`. With `sql` it shows a tile-SQL result (anomalies, top or bottom rows, data-quality findings) in the order the SQL returns it; `columns` is not allowed. The result is capped at 1 000 rows: a longer one shows the first 1 000 and the title says `first 1 000 rows`, so put `ORDER BY` in the SQL. Header clicks sort the loaded rows only. `click: <dim>` makes a row set that dimension to its value in the **first** column.

```yaml
- type: table
  title: Revenue by region
  click: region
  sql: SELECT region, SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1
```

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
- `--remote s3://<bucket>/<prefix> [--expires <n>h|<n>d]` stores the data in a bucket (unqualified): `remote.md`.
- `--shell <file>` renders the page chrome with another shell module instead of the default (any mode): `shell.md`. Not needed for colours, fonts or a logo (`theme:`).
- A `--split` folder must be new, empty, or hold only an earlier featherBI split build. Otherwise the build stops before writing anything and names the foreign files.
- When the embedded Parquet exceeds 25 MB the build warns. Build with `--split`, or aggregate in the source SQL.

# Tiles and presets

Reference for the `kpi`, `echarts` and `text` tiles. Every tile is configured, never coded: pick a type (and a preset), write SQL that returns the listed columns, and the build checks the result before it writes any HTML.

All tile SQL runs in the browser over the snapshot tables. Put `{{filters:<table>}}` (or `{{filters:<table> AS <alias>}}`) in every `WHERE` so the tile follows the filters.

## `kpi`

```yaml
- type: kpi
  title: Revenue
  format: currency            # or number (default)
  sql: "SELECT SUM(revenue) AS value FROM sales WHERE {{filters:sales}}"
  compare: "SELECT SUM(target) AS value FROM targets WHERE {{filters:targets}}"
  spark: "SELECT date_trunc('month', order_date) AS x, SUM(revenue) AS y FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1"
```

| Key | Result contract | Shown as |
|---|---|---|
| `sql` | one row, column `value` | the figure; `–` when there is no row or the value is NULL |
| `compare` (optional) | one row, column `value` | Δ % of `sql` against `compare`: `(value - compare) / abs(compare)`, e.g. `-1.7%`. Nothing is shown when either value is missing or `compare` is 0. |
| `spark` (optional) | rows `x, y`, ordered by `x` | a small trend line of `y` |

`format: currency` is US dollars with two decimals; `format: number` has up to two decimals.

## `echarts`

```yaml
- type: echarts
  preset: bar
  title: Revenue vs target by region
  click: region               # optional: a declared dimension
  exclude: [region]           # optional: keep every region visible after a click
  format: currency            # optional: tooltip number format
  sql: >
    SELECT s.region AS x, SUM(s.revenue) AS y, 'revenue' AS series
    FROM sales s WHERE {{filters:sales AS s}} GROUP BY 1
    UNION ALL
    SELECT region, target, 'target' FROM targets WHERE {{filters:targets}}
    ORDER BY 3, 1
```

Rows are drawn in the order the SQL returns them, so add an `ORDER BY`.

### The 17 presets

| Preset | Required columns | Optional | Click key columns | Notes |
|---|---|---|---|---|
| `line` | `x, y` | `series` | `x` | One line per `series` value. |
| `area` | `x, y` | `series` | `x` | A line with a filled area. |
| `bar` | `x, y` | `series` | `x` | Bars side by side per `series` value. |
| `stacked-bar` | `x, y, series` | | `x` | Bars stacked per `series` value. |
| `hbar` | `x, y` | `series` | `x` | Horizontal bars; `x` is the category, `y` the length. First row on top. |
| `pie` | `name, value` | | `name` | |
| `donut` | `name, value` | | `name` | |
| `scatter` | `x, y` | | none | Both columns numeric. |
| `heatmap` | `x, y, value` | | `x, y` | One cell per row. Takes two click dimensions. |
| `treemap` | `name, value` | | `name` | Flat: one rectangle per row. |
| `sunburst` | `name, value` | | `name` | Flat: one ring. |
| `funnel` | `name, value` | | `name` | Sorted by `value`, largest on top. |
| `gauge` | `value` | | none | One row; the scale is 0 to 100, so return a percentage. |
| `sankey` | `source, target, value` | | `source, target` | One link per row. A click on a link sets the dimensions; nodes are not clickable. The links must not form a cycle. |
| `waterfall` | `x, y` | | `x` | `y` is the **change** of each step; the bars float on the running total. Rises and falls have different colours. |
| `boxplot` | `name, min, q1, median, q3, max` | | `name` | One box per row; compute the quantiles in SQL (`quantile_cont`, `median`). |
| `calendar` | `x, y` | | none | `x` is a DATE, one row per day; the range runs from the first to the last date. |

Each preset file (`assets/presets/<name>.json`) holds `columns`, `optional`, `click` (the click key columns) and `option` (the ECharts option template). In the template, a string starting with `@` binds data from the tile's rows: `@rows`, `@uniq:<column>`, `@min:<column>`, `@max:<column>`, `@names:<column>,<column>` (sankey nodes) and `@steps` (waterfall running totals).

### `click`

- `click: <dim>` sets that dimension to the value of the clicked element's **first** click key column. `click: [<dimX>, <dimY>]` sets two dimensions from the first and second key column (heatmap, sankey).
- Clicking the same element again clears the dimension(s). A click on another element replaces the value.
- Every `click` dimension must be declared in `dims`, and its values must match the key column's values (click on `region` needs `region AS x`).
- A tile that is filtered by its own click shrinks to the clicked element. Add `exclude: [<dim>]` to keep the other elements visible and clickable.
- Presets without click key columns (`scatter`, `gauge`, `calendar`) ignore `click`.

### `option`

`option` is deep-merged over the preset's option and is for **styling only**: labels, colours, axis formats, legend, grid. Objects merge key by key, arrays item by item.

```yaml
option:
  yAxis: { name: USD }
  series: [{ label: { show: true } }]
```

Keys that bind data are ignored wherever they appear: `data`, `dataset`, `datasetIndex`, `encode`, `links`, `nodes`, `source`. Data always comes from the tile SQL through the preset. When a `series` column splits a chart into several series, `option.series[0]` styles all of them.

### Theme

Chart colours, text and grid lines come from the dashboard theme and switch with the light/dark toggle. Leave colours out of `option` unless a chart needs a fixed one; a fixed colour does not change with the theme.

## `text`

```yaml
- type: text
  title: About
  markdown: |
    ## Notes

    Revenue is **net** of returns.

    - Click a bar to filter.
    - See [the source](https://example.com/report).
```

`markdown` takes a small Markdown subset: `#`, `##` and `###` headings, paragraphs separated by a blank line, `- ` lists, `**bold**`, `*italic*` and `[label](https://…)` links (`http` and `https` only). Anything else, including HTML, is shown as literal text. A text tile has no SQL and no click.

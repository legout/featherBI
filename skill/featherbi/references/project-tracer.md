# Project-to-preview tracer

## Portable project

The compiler accepts `project: 1` YAML with strict keys. In addition to the
sections below, a project may declare `theme`, `themeCss`, `models`,
`dimensions`, and `measures`. Unknown keys and versions fail. IDs use
`^[a-z][a-z0-9_]*$`.

```yaml
project: 1
title: Example dashboard
sources:
  - id: inspections
    type: parquet
    file: inspections.parquet
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: true}
filters: []
relationships: []
queries:
  total:
    sql: queries/total.sql
    params: []
layout:
  - id: total
    type: kpi
    query: total
    label: Total
    field: value
    x: 1
    y: 1
    width: 12
    height: 1
```

Query SQL is always a safe project-relative `queries/<id>.sql` reference. The compiler embeds validated SQL in strict runtime contract 2 with `app: grid` and `data.mode: upload`. It never reads `.featherbi/local-sources.yaml`.

## Standard analytical catalog

`models/<id>.sql` contains one read-only SELECT/CTE over sources or acyclic
models and declares its output schema in YAML. Dimensions name one model field.
Measures use `count`, `distinct-count`, `sum`, `min`, `max`, or `average`, or a
ratio of two same-model measures. Every measure declares `empty: null|zero`;
ratios additionally declare `zero: null|zero`.

Metric queries name one model plus dimension, measure, and compatible filter
IDs. Compilation expands them to ordinary SQL; external `queries/<id>.sql`
remains supported. See `examples/standard-dashboard/dashboard.yaml` for the
complete concise form.

Themes are `neutral` (default), `daisyui`, and explicit `siemens-ix`. Optional
trusted `theme.css` is parsed, network-loading constructs are rejected, and
selectors are scoped under `#dashboard`. Production pins PostCSS 8.5.28 (the
advisory-fixed successor to the probe's 8.5.6) with
`postcss-prefix-selector` 2.1.1.

Every component declares integer `x`, `y`, `width`, and `height` on the
12-column desktop grid. Supported standard components are heading, escaped
Markdown/text, divider, tabs/sections, KPI, metric group, table, and typed bar,
line, area, scatter, pie/donut, heatmap, treemap, sankey, gauge, and boxplot.
Filters are single-select, multi-select, exact text, date range, numeric range,
boolean, and searchable options. Numeric `from` and `through` bounds are both
inclusive; date `through` remains the inclusive calendar date displayed over an
exclusive next-day SQL boundary. `interactionDimension`, `brushDimension`, and
opt-in table-column `dimension` bindings target only compatible shared filters;
unmapped dimensions stay local.

## Confirmed relationships

A query containing `JOIN` needs at least one explicit confirmed declaration:

```yaml
relationships:
  - left: inspections
    right: products
    leftKey: product_id
    rightKey: product_id
    cardinality: many-to-one
    confirmed: true
```

The compiler validates declared source/key existence but does not claim to prove arbitrary SQL matches the relationship. Runtime DuckDB parser admission remains final authority. Prefer a rejected query over guessing a relationship.

## Local/generated state

A project `.gitignore` must include `.featherbi/`. Keep only a source-ID map in `.featherbi/local-sources.yaml`, for example:

```yaml
inspections: /absolute/author-only/inspections.parquet
```

Pass those paths explicitly to profiling/build commands. Never paste them into YAML, SQL, generated config, HTML, reports, or logs.

## Failure checklist

- Profile failure: report logical source ID, format, and operation; do not infer missing facts.
- Compile failure: fix the reported YAML/SQL filename and location, then compile again.
- Build failure: preserve the prior artifact; fix config or explicit source mapping.
- Chrome failure: require extracted ZIP, `file://`, desktop Chrome, online pinned runtime assets, and explicit file selection.
- Verification mismatch: stop and reconcile profile/query/dashboard evidence before sharing.

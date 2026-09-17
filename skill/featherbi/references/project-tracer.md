# Project-to-preview tracer

## Portable project

The tracer accepts `project: 1` YAML with these strict top-level keys: `project`, `title`, `sources`, `filters`, optional `relationships`, `queries`, and `layout`. Unknown keys and versions fail. IDs use `^[a-z][a-z0-9_]*$`.

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
```

Query SQL is always a safe project-relative `queries/<id>.sql` reference. The compiler embeds validated SQL in strict runtime contract 2 with `app: grid` and `data.mode: upload`. It never reads `.featherbi/local-sources.yaml`.

This slice reuses runtime-v1 filter and component shapes. Models, metrics catalogs, responsive coordinates, themes, expanded components/filters, cross-filtering, alternate renderers, and SQL playground are not supported yet.

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

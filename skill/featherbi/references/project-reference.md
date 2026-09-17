# Project and schema reference

A dashboard project is the source tree the compiler turns into strict runtime contract 2:

```text
<dashboard>/
├── dashboard.yaml          # project: 1, strict keys, unknown keys rejected
├── models/<model>.sql      # optional reusable SELECT/CTE definitions
├── queries/<query>.sql     # component results (external SQL)
├── theme.css               # optional trusted author CSS
└── .gitignore              # must ignore .featherbi/ (and *.zip)
```

Generated local state stays in ignored `.featherbi/`: `profile.json`, `local-sources.yaml`, `dashboard.config.json`, previews, ZIPs, screenshots. `local-sources.yaml` maps source IDs to absolute author-machine paths, for example `inspections: /absolute/author-only/file.parquet`; pass those paths explicitly to profile/build commands and never paste them into YAML, SQL, configs, or reports.

## dashboard.yaml

```yaml
project: 1
title: Example dashboard
sources:
  - id: inspections            # ^[a-z][a-z0-9_]*$
    type: parquet              # csv | parquet | json
    file: inspections.parquet  # suggested recipient basename, never a path
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: true}
filters: []                    # see components.md for the typed kinds
relationships: []              # confirmed joins only, see below
queries:
  total: {sql: queries/total.sql, params: []}
layout:                        # integer x/y/width/height on a 12-column grid
  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}
theme: neutral                 # neutral | daisyui | siemens-ix
rendererPreset: standard       # standard | perspective-first
```

Compilation rejects unknown properties, unsupported versions, layout overlap (except alternatives inside one tabs/section owner), out-of-grid placement, and emits runtime `contract: 2` with `data.mode: upload`. It never reads `.featherbi/`.

- **Models** declare `sql` (project-relative `models/<id>.sql`) plus an output `schema`; models may reference sources or strictly earlier models (acyclic).
- **Metric queries** name one `model` plus `dimensions`, `measures`, compatible `filters`, and optional `orderBy`; the compiler expands them to ordinary validated SQL. External `queries/<id>.sql` remains supported for anything the catalog cannot express.
- **Relationships** admit joins: `{left, right, leftKey, rightKey, cardinality, confirmed: true}`. Any JOIN in model or query SQL requires one confirmed relationship over the referenced sources.
- Complete realistic examples live in the repository: `examples/basic-dashboard` (minimal), `examples/standard-dashboard` (models/metrics/themes), `examples/exploration-dashboard` (Perspective and playground), `examples/ap-dashboard` (large-scale AP scenario).

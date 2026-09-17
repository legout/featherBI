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
  # Remote sources replace type/file with a remote declaration; schema stays:
  # - id: remote_inspections
  #   schema: {station: {type: string, nullable: false}}
  #   remote:
  #     uri: s3://example-bucket/inspections.parquet   # s3:// or https://, no credentials
  #     format: parquet                                # csv | parquet | json
  #     auth: s3                                       # none (public) | s3 (AWS chain or gitignored .env)
  #     region: eu-central-1                           # optional, non-secret
  #     filename: inspections.parquet                  # optional ZIP member name (default: URI basename)
  #     delivery: packaged                             # default and only supported value today
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
- **Remote sources** are read-only `s3://`/`https://` declarations. `delivery: packaged` (the default) materializes them into the ZIP at build time; `delivery: live` keeps `{uri, format, auth, region?, endpoint?}` in the runtime config and the recipient's browser reads the source at open time (public direct, private after a per-session credential prompt held memory-only). `auth: s3` resolves authoring credentials via the AWS credential chain, then the gitignored `.env` (see [`/.env.example`](../../../.env.example): `FTHR_S3_KEY_ID`, `FTHR_S3_SECRET`, optional session token, region, endpoint). Credentials never appear in project files, profiles, configs, HTML, or ZIPs; profile output stays bounded with no URIs.
- Complete realistic examples live in the repository: `examples/basic-dashboard` (minimal), `examples/standard-dashboard` (models/metrics/themes), `examples/exploration-dashboard` (Perspective and playground), `examples/ap-dashboard` (large-scale AP scenario).

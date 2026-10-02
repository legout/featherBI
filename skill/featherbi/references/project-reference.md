# Project and schema reference

A dashboard project is the source tree the compiler turns into strict runtime contract 2:

```text
<dashboard>/
├── dashboard.yaml          # project: 1, strict keys, unknown keys rejected
├── models/<model>.sql      # optional reusable SELECT/CTE definitions
├── queries/<query>.sql     # component results (external SQL)
├── theme.css               # optional trusted author CSS
├── theme.tokens.yaml       # optional validated theme tokens
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
  #     delivery: packaged                             # packaged (default) | live
  # Live table sources are live-only remotes (delivery: live required; never packaged):
  # - id: sales
  #   schema: {amount: {type: number, nullable: true}}
  #   remote:
  #     kind: parquet-set
  #     uri: s3://reports/sales/                       # s3:// prefix ending with "/"
  #     selector: {glob: "year=*/part-*.parquet"}      # exactly one selector; alternative:
  #                                                   #   selector: {manifest: s3://reports/sales/manifest.json}
  #     auth: s3                                       # storage credentials; optional region/endpoint as above
  #     delivery: live
  # - id: orders
  #   schema: {amount: {type: number, nullable: true}}
  #   remote:
  #     kind: iceberg
  #     metadataUri: s3://reports/orders/metadata/v3.metadata.json # fixed versioned pointer; a catalog
  #                                                   #   identity instead declares catalog: {endpoint, warehouse,
  #                                                   #   namespace, table} + catalogAuth: none|bearer (HTTPS only)
  #     auth: s3                                       # storage credentials, independent of catalogAuth
  #     delivery: live
filters: []                    # see components.md for the typed kinds
relationships: []              # confirmed joins only, see below
queries:
  total: {sql: queries/total.sql, params: []}
layout:                        # integer x/y/width/height on a 12-column grid
  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}
theme: neutral                 # neutral | daisyui | siemens-ix | siemens-ix-light
themeTokens: theme.tokens.yaml # optional custom theme; valid only with neutral (see themes-and-css.md)
rendererPreset: standard       # standard | perspective-first
```

Compilation rejects unknown properties, unsupported versions, layout overlap (except alternatives inside one tabs/section owner), out-of-grid placement, and emits runtime `contract: 2` with `data.mode: upload`. It never reads `.featherbi/`.

- **Models** declare `sql` (project-relative `models/<id>.sql`) plus an output `schema`; models may reference sources or strictly earlier models (acyclic).
- **Metric queries** name one `model` plus `dimensions`, `measures`, compatible `filters`, and optional `orderBy`; the compiler expands them to ordinary validated SQL. External `queries/<id>.sql` remains supported for anything the catalog cannot express.
- **Relationships** admit joins: `{left, right, leftKey, rightKey, cardinality, confirmed: true}`. Any JOIN in model or query SQL requires one confirmed relationship over the referenced sources.
- **Remote sources** are read-only single-file `s3://`/`https://` declarations. `delivery: packaged` (the default) materializes them into the ZIP at build time; `delivery: live` keeps `{uri, format, auth, region?, endpoint?}` in the runtime config and the recipient's browser reads the source at open time (public direct, private after a per-session credential prompt held memory-only). `auth: s3` resolves authoring credentials via the AWS credential chain, then the gitignored `.env` (see [`/.env.example`](../../../.env.example): `FTHR_S3_KEY_ID`, `FTHR_S3_SECRET`, optional session token, region, endpoint). Credentials never appear in project files, profiles, configs, HTML, or ZIPs; profile output stays bounded with no URIs.
- **Live Parquet file sets** (`remote: {kind: parquet-set}`) read S3 Parquet objects under one prefix as one logical source, `delivery: live` required (never packaged). Exactly one selector: `{glob: "year=*/part-*.parquet"}` (a relative pattern under the prefix) or `{manifest: s3://reports/sales/manifest.json}` — a fetched JSON document `{"files": [relative .parquet keys]}` of at most 2 MiB and 10,000 files; identical keys deduplicate and every key stays under the declared prefix. Membership resolves once per generation; only explicit Refresh or reopen re-resolves it, never a filter change. Profile with `--glob` or `--manifest` and the s3:// prefix as `--input`. Recipients need CORS-reachable bucket endpoints and S3 list+read permissions; publish immutable object keys — changing bytes in place can defeat per-load pinning.
- **Live Iceberg tables** (`remote: {kind: iceberg}`) are remote table sources read with true snapshot/delete semantics, `delivery: live` required. The identity is exactly one of `metadataUri` (a fixed versioned `.metadata.json` pointer: Refresh re-reads the same document, and changing the authored URI selects another snapshot) or `catalog: {endpoint, warehouse, namespace, table}` with `catalogAuth: none|bearer` (HTTPS endpoints only; no OAuth, vended credentials, or custom headers), resolved once per generation so Refresh follows new commits. Storage `auth: none|s3` is independent of catalog authentication and prompts are separate and memory-only, naming each destination. Profile with `--iceberg-metadata`, or `--iceberg-catalog` with `--catalog-warehouse`, `--catalog-namespace`, `--catalog-table`, and `--catalog-auth bearer` reading its token from `FTHR_ICEBERG_TOKEN` in the environment or a gitignored `.env` (never portable files or reports). Delta Lake is not supported: never declare a Delta table or relabel its Parquet files as a table read.
- Complete realistic examples live in the repository: `examples/basic-dashboard` (minimal), `examples/standard-dashboard` (models/metrics/themes), `examples/exploration-dashboard` (Perspective and playground), `examples/ap-dashboard` (large-scale AP scenario).

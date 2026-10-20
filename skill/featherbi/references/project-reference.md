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
  #                                                   #   (or a public https:// .json URI; files stay below the s3 prefix)
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
  # - id: readings
  #   schema: {value: {type: number, nullable: true}}
  #   remote:
  #     kind: ducklake                                 # public https:// catalog URL + one named table
  #     uri: https://host.example/reports/space.ducklake
  #     table: readings                                # the one explicitly exposed table
  #     auth: none                                     # only allowed value: publicly readable catalog
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
- **Live Parquet file sets** (`remote: {kind: parquet-set}`) read S3 Parquet objects under one prefix as one logical source, `delivery: live` required (never packaged). Exactly one selector: `{glob: "year=*/part-*.parquet"}` (a relative pattern under the prefix) or `{manifest: s3://reports/sales/manifest.json}` — a fetched JSON document `{"files": [relative .parquet keys]}` of at most 2 MiB and 10,000 files; identical keys deduplicate and every key stays under the declared prefix. The manifest URI may instead be a public `https://` .json document (spec [2026-10-19-0005](../../../project/specs/2026-10-19-0005-static-sharing-and-live-refresh.md) §4): the browser fetches it itself with no credentials, while the Parquet files keep resolving below the S3 prefix. Membership resolves once per generation; only explicit Refresh or reopen re-resolves it, never a filter change. Profile with `--glob` or `--manifest` and the s3:// prefix as `--input`. Recipients need CORS-reachable bucket endpoints and S3 list+read permissions; publish immutable object keys — changing bytes in place can defeat per-load pinning.
- **Live Iceberg tables** (`remote: {kind: iceberg}`) are remote table sources read with true snapshot/delete semantics, `delivery: live` required. The identity is exactly one of `metadataUri` (a fixed versioned `.metadata.json` pointer: Refresh re-reads the same document, and changing the authored URI selects another snapshot) or `catalog: {endpoint, warehouse, namespace, table}` with `catalogAuth: none|bearer` (HTTPS endpoints only; no OAuth, vended credentials, or custom headers), resolved once per generation so Refresh follows new commits. Storage `auth: none|s3` is independent of catalog authentication and prompts are separate and memory-only, naming each destination. Profile with `--iceberg-metadata`, or `--iceberg-catalog` with `--catalog-warehouse`, `--catalog-namespace`, `--catalog-table`, and `--catalog-auth bearer` reading its token from `FTHR_ICEBERG_TOKEN` in the environment or a gitignored `.env` (never portable files or reports). Delta tables are never declared directly; export them and declare the resulting Parquet set (next bullet).
- **Live DuckLake tables** (`remote: {kind: ducklake}`) expose one explicitly named table of a public `https://` catalog: `uri` plus `table`, `auth: none` (the only allowed value), `delivery: live` required — no private credentials, `s3://` catalogs, or REST-catalog APIs. The trusted runtime constructs the `ducklake:<uri>` attach through the pinned owner-approved extension capability ([ADR 0009](../../../project/adr/0009-browser-only-lakehouse-readers.md)); Refresh re-attaches and re-reads the catalog, exposing only the named table.
- **Delta table export** (spec [2026-10-19-0005](../../../project/specs/2026-10-19-0005-static-sharing-and-live-refresh.md) §4): DuckDB-WASM cannot read Delta, so the author exports the current snapshot on their own machine with `featherbi export delta --input <table location> --output <directory>` (native DuckDB 1.5.5 plus the Delta extension, already installed; no upload happens). The input is a local directory or a remote location native DuckDB can read — S3 credentials follow the existing author conventions (AWS chain, then the gitignored `.env`). The recorded Delta version pins the scan, so `export.json` always identifies the exact exported snapshot. The output directory holds immutable `<export-id>/part-NNN.parquet` files, a root `manifest.json` exactly `{"files": ["<export-id>/part-NNN.parquet", …]}`, and an `export.json` sidecar with the Delta version and export time. A re-export adds new part files and overwrites only those two root files — never an existing part. Publish the output directory at a public `https://` location (the author's decision; the README trust limits apply) and declare the table as a live Parquet set with `selector: {manifest: https://…/manifest.json}`; freshness equals the export cadence and Refresh re-fetches the manifest. Keep the table location out of YAML, SQL, configs, and reports.
- **Build targets**: `--target` is required. `--target static` writes exactly one self-contained `dashboard.html` with no dataset bytes, credentials, or absolute paths, and accepts only live sources — a local file or `delivery: packaged` source fails the build naming the source and the remedy (declare `delivery: live` with a public `https://` URI, or use the zip target). Its CSP lists exact origins only, so an S3-backed live source needs `region` or `endpoint`, and an Iceberg REST-catalog source needs `remote.endpoint`. `--target zip` keeps the existing bundle behavior for local and packaged sources. Neither target uploads or publishes; hosting is the author's decision.
- Complete realistic examples live in the repository: `examples/basic-dashboard` (minimal), `examples/standard-dashboard` (models/metrics/themes), `examples/exploration-dashboard` (Perspective and playground), `examples/ap-dashboard` (large-scale AP scenario).

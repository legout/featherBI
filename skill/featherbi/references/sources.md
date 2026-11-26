# Remote source handoffs

Reference for the sources that need a network, a server or a login. Local files (CSV, JSON, Parquet, XLSX, SQLite, Delta, Iceberg metadata file, DuckLake local catalog) are covered by the CI fixtures and are not listed here.

## Rules for every remote source

- The native DuckDB CLI (>= 2.0) reads the source in the **source phase** and writes a snapshot table. Nothing else touches the source, and the HTML never contains source SQL, connection strings or credentials.
- **Credentials never go in `dashboard.yaml`.** Use the environment, `~/.pgpass`, or a DuckDB secret (created once, outside the config). The build refuses any source key whose name contains `password`, `passwd`, `secret`, `key_id` or `token`.
- Host, database and bucket names are not secrets and may appear in the config. Do not put a password in a URL or connection string.
- `attach` sources are opened `READ_ONLY`. Prefixes the build installs extensions for: `postgres:`, `sqlite:`, `ducklake:`. Everything else goes through `read` (any DuckDB table expression).
- Keep source SQL repeatable: no clock functions, no `random()`.

## Qualification status

**Unqualified until verified.** Each remote source below is *unqualified* until the owner has built a dashboard from it once on their own servers and checked that a `COUNT(*)` KPI and a sum KPI match the source (spec 0001, acceptance 10). Do not tell a user that a source is supported until it is marked verified here. To mark a source verified, change its status line to `verified <date>, <DuckDB version>`.

| Source | Status |
|---|---|
| Postgres | unqualified until verified |
| pg_lake | unqualified until verified |
| pg_ducklake | unqualified until verified |
| S3 | unqualified until verified |
| SeaweedFS | unqualified until verified |
| Iceberg REST catalog | unqualified until verified |
| SharePoint / OneDrive | unqualified until verified |

`--remote` (data in a bucket, presigned links in the HTML) is a different feature: `remote.md`.

## Postgres

**Status: unqualified until verified.**

**Handoff:** `attach` with host and database in the config. The password comes from libpq: set `PGPASSWORD` in the environment, or add a line to `~/.pgpass` (mode `0600`). A DuckDB secret of type `postgres` also works.

```yaml
sources:
  orders:
    attach: "postgres:host=db.internal port=5432 dbname=shop user=report"
    table: orders
  daily:
    attach: "postgres:host=db.internal port=5432 dbname=shop user=report"
    sql: "SELECT order_date, region, SUM(revenue) AS revenue FROM src.orders GROUP BY 1, 2"
```

```sh
# the password stays in the shell, never in the config
PGPASSWORD="$(cat /path/to/secret-file)" node skill/featherbi/scripts/featherbi.mjs build dashboard.yaml
```

Notes: the attached database is called `src`; with `sql`, refer to tables as `src.<table>` (add the schema if it is not `public`: `src.sales.orders`). Use a read-only database role.

## pg_lake and pg_ducklake

**Status: unqualified until verified** (each).

**Handoff:** both are Postgres extensions, so DuckDB reaches them through the normal Postgres protocol. Use the Postgres handoff above and point `table` or `sql` at the lake-backed tables the extension exposes. Credentials are the same as for Postgres. The object-store credentials of the lake belong to the Postgres server, not to featherBI.

```yaml
sources:
  events:
    attach: "postgres:host=lake-pg.internal dbname=lake user=report"
    table: events          # a pg_lake / pg_ducklake table
```

Notes: only what Postgres returns through a `SELECT` is supported. Direct reads of the lake's files from DuckDB are a different handoff (see S3 and Iceberg below) and are not covered by this entry.

## S3 and SeaweedFS

**Status: unqualified until verified** (each).

**Handoff:** an `s3://` URL in a `read` expression. Credentials come from a DuckDB secret, or from the AWS environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`). DuckDB loads the `httpfs` extension for `s3://` URLs on first use, so the machine needs network access to the extension repository or a pre-installed `httpfs`.

```yaml
sources:
  sales:
    read: "read_parquet('s3://reports/sales/*.parquet')"
```

Create the secret once, outside the config, for example in the DuckDB CLI (values from the environment, not typed into a file you commit):

```sql
CREATE PERSISTENT SECRET reports_s3 (TYPE s3, PROVIDER credential_chain);
```

SeaweedFS speaks the S3 protocol; it needs a custom endpoint and usually path-style URLs. Put the endpoint in the secret, not in `dashboard.yaml`:

```sql
CREATE PERSISTENT SECRET seaweed (
  TYPE s3, KEY_ID '<from your secret store>', SECRET '<from your secret store>',
  ENDPOINT 'seaweed.internal:8333', URL_STYLE 'path', USE_SSL false
);
```

(The placeholders are not values. Run that statement yourself; never paste real keys into a file in this repository.)

## Iceberg REST catalog

**Status: unqualified until verified.**

**Handoff:** the catalog URI, with credentials from a DuckDB secret (type `iceberg`) or the environment. Create the secret outside the config; featherBI only reads from it.

```sql
CREATE PERSISTENT SECRET lake_rest (TYPE iceberg, TOKEN '<from your secret store>');
```

Known gap: the source phase's `attach` runs `ATTACH '<string>' AS src (READ_ONLY)` and has no way to pass `TYPE iceberg` or an `ENDPOINT`, and it only installs extensions for the `postgres:`, `sqlite:` and `ducklake:` prefixes. A catalog attach therefore cannot be written in the config yet, and no tested example exists. Until the owner qualifies this source, use one of: `iceberg_scan('<metadata file or table location>')` in a `read` expression (works against the storage, with S3 credentials as above), or ask the owner for catalog support. Do not invent an `attach` string for it.

## SharePoint / OneDrive

**Status: unqualified until verified.**

**Handoff**, in order of preference:

1. **A locally synced folder.** Sync the library with the OneDrive client, then read the file by its local path. This is the supported route.
2. **A URL the CLI can read without an interactive login**, such as an anonymous share link that returns the file bytes directly.

```yaml
sources:
  targets:
    read: "read_xlsx('/home/user/OneDrive - Contoso/Reports/targets.xlsx')"
  budget:
    read: "read_csv('https://contoso.sharepoint.com/:x:/s/team/<anonymous-link-id>?download=1')"
```

Anything that needs an interactive login (Microsoft sign-in, MFA, a cookie) is **unsupported**. Do not put a session cookie or token in the config or URL. A share link that embeds an access token is a credential: treat it like one and do not commit it.

## `profile` output

`profile` prints a JSON array, one object per source: `source`, `schema`, `count` (always exact), `samples` (up to 5 distinct values per column), and `sampled: true` when the statistics come from a sample. It never writes files or sends data anywhere. Each `schema` entry (`name`, `type`) also carries:

| Field | For | Meaning |
|---|---|---|
| `nulls` | all | share of NULLs, 0–1 |
| `distinct` | all | distinct values; approximate above 100 000 rows, then `distinct_approx: true` |
| `min`, `max` | numeric, date, timestamp | |
| `top` | text with ≤ 50 distinct values | up to 10 `{value, count}`, most frequent first |
| `step` | date, timestamp | median gap between consecutive distinct values as a DuckDB interval (`10 days`, `00:15:00`) |

Above 5 000 000 rows the statistics use `USING SAMPLE 1000000 ROWS (reservoir, 42)` (fixed seed, repeatable).

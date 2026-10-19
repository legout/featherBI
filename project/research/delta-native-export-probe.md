# Delta native export probe (S3, ticket #39)

**Verdict: pass.** Native DuckDB 1.5.5 with the official Delta extension exports a Delta snapshot (after an update and a delete) to immutable Parquet parts plus a root `manifest.json` `{"files":[...]}` whose row counts equal `delta_scan`, and the actual exported manifest/parts load through the existing manifest selector in desktop Chrome. Behavior source: [spec 2026-10-19-0005](../specs/2026-10-19-0005-static-sharing-and-live-refresh.md) §4 / SL-05, [ADR 0009](../adr/0009-browser-only-lakehouse-readers.md) as amended.

## Environment (all under `/tmp`, removed after evidence capture)

- CLI: official `duckdb_cli-osx-arm64.gz` from `https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-osx-arm64.gz`; SHA-256 `37144723eb43639a96b47207b44036e6dedc084f81afbf0c18625e7f3deac810` verified byte-for-byte against the GitHub release API digest and the owner-approved digest before decompression. `--version` reports `v1.5.5 (Variegata) d8cdaa33fd`.
- Delta extension: the user's existing official build `~/.duckdb/extensions/v1.5.5/osx_arm64/delta.duckdb_extension` (extension_version `45c4087`, etag `33c0d09dab52b99d4f73b5d8d9800cb9-3` per its `.info`) copied with its `.info` into an isolated `HOME` under `/tmp`; `LOAD delta` succeeds from that copy only. No install, no writes to the user's extension directory.

## Fixture and oracle

The official 1.5.5 Delta extension is **read-only** for this build: `COPY … (FORMAT DELTA)` is not a registered copy function and the delta catalog rejects `CREATE TABLE` ("Delta tables do not support creating tables"), so no native DML writer exists. The disposable fixture therefore follows the Delta protocol directly: real Parquet parts written by the same CLI, `_delta_log` commits with standard `add`/`remove` actions (update = remove + rewritten add; delete = remove).

| Fixture state | rows | `status='fixed'` | `station='XX'` |
| --- | --- | --- | --- |
| v0 write: 12 rows, 2 files | 12 | 0 | 4 |
| v1 update: `SET status='fixed' WHERE id IN (1,4)` | 12 | 2 | 4 |
| v2 delete: `DELETE WHERE station='XX'` | 8 | 2 | 0 |

Each stage was verified through `delta_scan('/tmp/t39/fixture')` before the next commit, so the update and delete are observably honored (final live files: 5 + 3 rows). Implication for #41: Delta fixtures for tests need this hand-authored-log approach or an external writer, since native DML is unavailable in 1.5.5.

## Export

```sql
SET threads=4;
COPY (SELECT * FROM delta_scan('/tmp/t39/fixture'))
  TO '/tmp/t39/export' (FORMAT PARQUET, ROW_GROUP_SIZE 2, PER_THREAD_OUTPUT true);
```

Two parts (`data_0/1.parquet`, 5 + 3 rows) renamed into the spec §4 shape: `exp-20261019-39a2/part-000.parquet`, `part-001.parquet`, plus root `manifest.json` `{"files":["exp-20261019-39a2/part-000.parquet","exp-20261019-39a2/part-001.parquet"]}` and `export.json` `{"delta_version":2,"exported_at":"2026-10-19T14:23:40+00:00"}`. `FILE_SIZE_THRESHOLD` is not recognized by DuckDB 1.5.5's Parquet writer; `PER_THREAD_OUTPUT` (with bounded threads) is the available multi-file lever, and explicit renaming produces the `part-NNN.parquet` names.

## Count comparison against `delta_scan`

| | delta_scan | exported parts |
| --- | --- | --- |
| rows | 8 | 8 |
| `status='fixed'` | 2 | 2 |
| `station='XX'` | 0 | 0 |
| symmetric difference (`EXCEPT` both directions) | 0 | 0 |

## Browser check (existing manifest selector)

A focused spec in `/tmp` (pattern of `tests/browser/live-parquet-set.spec.mjs`) served the **actual exported** `manifest.json` and parts from a local S3-style https endpoint and rendered a dashboard through the pinned base's `renderDashboard`: source `remote: {kind: parquet-set, uri: s3://reports/export/, selector: {manifest: s3://reports/export/manifest.json}}`, three KPIs. Result: `data-state=ready`; KPIs **8 / 2 / 0**, exactly the `delta_scan` oracle. The exported manifest is therefore compatible with `resolveManifestParquetSet` / `manifestParquetFiles` (`runtime/sources.mjs`). Run environment: desktop Chrome via Playwright (`channel: 'chrome'`); the worktree has no `node_modules`, so resolution used the canonical checkout's installed modules (its `package.json` is identical to the pinned base, including `@duckdb/duckdb-wasm` 1.33.1-dev64.0) through a `/tmp` module-resolve hook plus a gitignored `node_modules` symlink, and `.generated/validate-config-v2.mjs` was produced by the repo's own `generate:contract` script.

## Named failure modes

- Wrong counts after update/delete — disproven (table above; symmetric difference 0).
- No native Delta extension build for 1.5.5 — disproven (attempt 1 observed HTTP 200; loaded and used here).
- Exporter manifest incompatible with selector — disproven (browser check on the actual artifacts).

Harness, server, fixture, CLI, and temp extension home lived only under `/tmp/t39` and were removed after evidence capture; the sole repository change is this note.

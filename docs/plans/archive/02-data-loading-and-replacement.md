# Plan 02 — Data loading and replacement

> **Archived:** superseded by [`../mvp.md`](../mvp.md). Keep for historical evidence only; do not execute this decomposition.

Status: approved by the owner. Plan 01 and P2.1 are integrated; P2.2/P2.3 remain pending.

- **Approval reference:** owner message on 2026-09-07: “plans look good. approved”.
- **Approved revision and scope:** `742330bb95b1a19c9ab26a33029b9a75ac470633`; RC-02/RC-03/RC-04 data loading, source-generation, and capability-gate scope described below.
- **Capture checkpoint:** [runtime contract §10](../../specs/runtime-contract-v1.md#10-planning-handoff), reconciled at `0d166f322ed6724ce14437fee278a542d506206b`; vocabulary is in [`CONTEXT.md`](../../../CONTEXT.md), architectural constraints are in ADR-0001 through ADR-0004, and no material capture decision remains unresolved.
- **Planning contract/provenance:** contract version 1; installed `write-implementation-plan` hash `fbad63d3b33b854f78d5d93b91bc0b756448a819f877010649fe453455689609`; installed `planning-contract` hash `671e9bf465ecf63e4030882f5e848c33aa028d271949a89a2ce776af0c89c271`.
- **Execution evidence:** P2.1 review verdict PASS at reviewed head `4ebf1beb9d2c5c8cbdb4e307dccb8032d861ba3c`, tree `b626c0bf9b64baf33ab20e5672da782e8fcc3839`; candidate review PASS at `6f32003e7079b0a0ec2eee67787b77e7f0cc8705`; locally integrated into `main` at `844680298070b2f9e0e68e742f113e50f295e26a`. Integration checks passed with 103 unit tests and 14 browser tests, none failed or skipped. Nothing was pushed or published.

## Goal, dependencies, and sources

Build strict local-data loading and a reversible source-generation seam without a dashboard UI or query scheduler.

Prerequisite: integrated [Plan 01](01-contract-and-fixtures.md), including its setup/ownership rules. Source: [runtime contract](../../specs/runtime-contract-v1.md) §§4–5 and RC-02/RC-03/RC-04; [browser evidence](../../research/browser-feasibility-report.md). Map: RC-02 → P2.2; RC-03 → P2.3 plus P3.3; RC-04 → P2.3 cleanup/staging plus P3.3 atomic publication. P2.1 supplied the reviewed WASM capability evidence for P3.1; dependent implementation must retain its named-to-ordinal binding strategy unless an approved source change supersedes it.

Use one DuckDB-WASM worker and schema-scoped generations. Selected Parquet remains File-backed; full declared-column validation is a scan, not permission to duplicate the file into JS or materialize every source as a table. No parallel writer for the shared package/build files.

## Interfaces for downstream plans

- `createEngine({onStatus})` → `{db, connection, dispose}`; the caller owns disposal. No global singleton.
- `validateInput(engine, source, physicalName)` → `{projectionSql, columns, rowCount}` or a rejected `Error` carrying `code`, `sourceId`, optional `column`, and a bounded message.
- `stageSources(engine, config, replacements, active)` → candidate generation. Replacements map source IDs to `{kind: 'file', file}` or `{kind: 'bytes', bytes}`. Unchanged active inputs are carried forward. All IDs must already exist in config.
- Generation record: `{id, schemaName, inputs, registrations}`. Its schema exposes the stable source IDs as logical views; every physical registration name is newly allocated.
- `withGeneration(engine, generation, operation)` selects that schema for a serialized operation and restores prior schema in `finally`.
- `releaseGeneration(engine, generation)` drops only that generation's views/schema/registrations and releases its references. Releasing twice is harmless; it never calls a blanket `dropFiles()` while another generation is active.

These are ordinary functions/records, not a class hierarchy. The Plan 03 controller owns serialization and active/candidate publication; calling `withGeneration` concurrently outside it is unsupported. Source functions do not import the controller or renderer.

## P2.1 — Browser harness, engine boot, and parser capability gate

**Prerequisites:** Plan 01. **Obligation:** `new-test` — browser boot and engine APIs must be proved on file://, not mocked into existence.

**Create:** `runtime/bootstrap.mjs`, `scripts/build-test-harness.mjs`, `tests/browser/harness.mjs`, `tests/browser/helpers.mjs`, `tests/browser/bootstrap.spec.mjs`, `playwright.config.mjs`. **Modify:** `package.json`, `package-lock.json`.

**Consumed interfaces:** Plan 01's generated contract, fixtures, package scripts, and the pinned browser seam. **Produced interfaces:** `createEngine({onStatus})` and reviewed WASM parser/parameter/canonical-SQL capability evidence for P2.2 and P3.1.

**Execution status:** completed, fresh-reviewed, and integrated into `main` at the commit recorded above.

- [x] Add pinned DuckDB-WASM 1.32.0, esbuild 0.28.2, and test-only `@playwright/test` 1.63.0. Launch installed desktop Chrome (`channel: 'chrome'`), one worker, isolated test contexts; never add Edge or bypass browser policies.
- [x] The harness builder emits one `.artifacts/browser/harness.html` with bundled test hooks. It is separate from production output. Tests navigate via `pathToFileURL`, not a local web server. A test fails if it launches the wrong browser or falls back to a different origin.
- [x] Define `build:harness` = `npm run generate:contract && npm run fixtures && node scripts/build-test-harness.mjs`; `test:browser` = `npm run build:harness && playwright test --project=chrome --grep-invert @private`. Add a focused runner configuration with bounded timeouts and failure screenshots under `.artifacts/`.
- [x] RED: test runtime readiness, an actual `SELECT 1`, worker failure, unavailable module/WASM assets, and disposal before implementing `createEngine`. Use the proven Blob/importScripts bootstrap and pinned URLs. No normal-browser profile or permissive file/security flags.
- [x] Capability gate in the actual pinned WASM engine: prepare and execute `SELECT json_serialize_sql(?)` on a SELECT with a named parameter, CTE/join, table-function read, multiple SELECTs, and DDL; inspect statement count, base-table/function nodes, CTE scopes, modifiers, and `named_param_map`. Test `json_deserialize_sql` using the original serialized JSON string and verify parameter binding order with repeated/reordered named placeholders.
- [x] Native DuckDB 1.5.5 exposes these AST APIs, but the browser probe did not verify them. If the pinned WASM engine cannot expose the required metadata/canonical SQL, stop with exact evidence before P2.2/P3.1. Do not substitute a regex, custom parser, newer dependency, or native-only validation without a reviewed design change.
- [x] GREEN: `npm run build:harness && npx --no-install playwright test tests/browser/bootstrap.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** file:// boot, real worker query and error UI work; engine version is recorded; AST/parameter/round-trip cases pass in WASM; disposal terminates the owned worker. No query-sandbox claim is made.

## P2.2 — Strict complete-input normalization

**Prerequisites:** P2.1 gate. **Obligation:** `new-test` — malformed data after a sample boundary must prevent activation.

**Create:** `runtime/normalize.mjs`, `runtime/sql.mjs`, `tests/unit/normalize.test.mjs`, `tests/browser/normalize.spec.mjs`. **Modify:** `tests/browser/harness.mjs`.

**Consumed interfaces:** `createEngine`, validated source declarations, and Plan 01's parity/boundary fixtures. **Produced interface:** `validateInput` above. `runtime/sql.mjs` initially exports only identifier quoting and runtime-owned SQL construction needed here; Plan 03 adds engine-backed authored-query admission to that same file.

- [ ] RED: load each parity/negative fixture through the actual worker and assert expected normalized values and failures. Pure unit checks cover identifier/path escaping and validation-plan construction; they cannot replace real reader tests.
- [ ] CSV: use the engine's CSV reader with explicit comma/header/UTF-8 policy and lexical string reading. Inspect original header values without relying on the reader's auto-renamed names. Explicitly configure quoted-empty versus unquoted-null behavior and validate complete input, not sample inference.
- [ ] JSON: inspect actual JSON value kinds before typed extraction; do not let auto-inference turn a numeric identifier into an accepted string or silently flatten nested data. Prefer engine raw-object JSON readers/type functions over parsing an entire large file in the main thread. Non-empty inputs must contain each declared column somewhere; missing per-row keys then follow nullable rules. Build a typed zero-row relation for `[]`.
- [ ] Parquet: inspect original schema names/types before projected reads; reject duplicate/case-colliding names and incompatible declared types. Ignore extra columns without forcing their conversion. Preserve the selected File-backed reader.
- [ ] Generate quoted, typed projections and a complete-input aggregate validation scan per source. A `TRY_CAST` may count invalid values, but must not silently replace them with null in accepted data. Enforce strict boolean/numeric/date/timestamp rules, finite/safe numeric values, nullability, and timestamp microseconds. Reject timezone offsets instead of converting them.
- [ ] Return bounded counts and source/column errors; raw records and absolute paths never enter exported config or generic logs. Fixture tests assert leading zeros, null versus empty, numeric boundaries, and timezone-independent output in UTC and Europe/Berlin browser contexts.
- [ ] GREEN: `node --test tests/unit/normalize.test.mjs`; `npm run build:harness && npx --no-install playwright test tests/browser/normalize.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** four format variants agree on exact normalized values; every invalid fixture fails at its intended boundary, including bad final rows; empty inputs conform to the specification. Report complete-scan cost separately from the earlier KPI-only probe.

## P2.3 — Generation staging, rollback, and resource release

**Prerequisites:** P2.2. **Obligation:** `new-test` — partial replacement and stale file state can silently corrupt results.

**Create:** `runtime/sources.mjs`, `tests/browser/sources.spec.mjs`. **Modify:** `tests/browser/harness.mjs`.

**Consumed interfaces:** `createEngine` and `validateInput`. **Produced interfaces:** `stageSources`, generation records, `withGeneration`, and `releaseGeneration` as defined above.

- [ ] RED: stage two named sources, query a known join, reject a missing/unknown assignment, then stage two replacements with one invalid. Assert active views/results remain readable and no incomplete generation is published.
- [ ] Register every candidate input under a fresh physical name and create typed views in its own internal schema. Keep active generation inputs available until explicit retirement. A source ID remains a logical table name, never a filesystem path.
- [ ] Validate before returning a candidate. On a failure, remove only candidate resources and restore the prior connection schema even if SQL execution failed. Test partial schema creation and a failure after the first source passed.
- [ ] Exercise `withGeneration` switching and restoration; candidate queries must see candidate tables, active queries must still see active tables after rollback. The generation record is not made globally active by `stageSources`.
- [ ] Regression: selected small Parquet → embedded bytes → different Parquet, then repeat with another candidate. Results must match each input; old filenames must never be reused. Test the same File deliberately assigned to two logical sources.
- [ ] Run at least 20 bounded replacement/rollback cycles and assert owned registration, view, statement, and File-reference counts return to the active-generation baseline. Record available memory measurements without pretending they establish a universal peak-memory bound.
- [ ] GREEN: `npm run build:harness && npx --no-install playwright test tests/browser/sources.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** joins and reversible staging work in the pinned WASM engine; one invalid candidate does not destroy active data; unique-name regression passes; cleanup is idempotent and bounded. Atomic filter/result publication is explicitly deferred to P3.3, not marked complete here.

## Global verification and handoff

```sh
npm ci
npm run check
npm run test:browser
```

P2.1 passed these applicable checks on its reviewed candidate and integration merge. Rerun the full commands after P2.2/P2.3; browser infrastructure failure is reported as blocked, never a skipped green check. Use the native browser tool for additional manual inspection, screenshots, and OS-level user-flow evidence; it does not replace the reproducible suite.

Hand engine, generation, normalization, and disposal interfaces to [Plan 03](03-queries-and-filters.md). Immediate review is required for P2.1's capability evidence and P2.3's rollback/resource ownership. Residual risks: heavy full validation, mid-query source loss, browser memory pressure, SQL admission, and UI publication remain explicit.

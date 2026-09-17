---
status: accepted
---

# Stage source generations within one DuckDB-WASM worker

Use one DuckDB-WASM worker with schema-scoped source generations, stable logical source IDs, and fresh physical registration names for every generation. Preserve selected Parquet as File-backed input instead of eagerly copying it into JavaScript; stage and validate candidate views while retaining the active generation, then publish data, filter defaults, and results together before retiring obsolete resources.

This avoids requiring two permanent workers or wholesale dataset copies while preserving rollback. Reusing physical filenames failed in the [Chrome probe](../research/browser-feasibility-report.md); a single connection also requires serialized generation/query operations rather than concurrent schema switching. The active implementation path is [GitHub issue #1](https://github.com/legout/featherBI/issues/1), implementing the [runtime contract §5](../specs/runtime-contract-v1.md). Full-input validation and rollback still require real WASM evidence; repeated cleanup stress belongs to the [deferred backlog](../plans/deferred.md).

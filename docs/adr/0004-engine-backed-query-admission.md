---
status: accepted
---

# Admit authored queries through the engine, not a text heuristic

Use the pinned DuckDB-WASM engine's parser metadata and canonical SQL APIs to admit the supported authored SELECT language, with typed filter values bound through prepared statements. Runtime-owned loading SQL is a separate boundary; a SELECT-prefix regex, custom grammar, or native-only check cannot replace browser-engine admission evidence.

This keeps admission aligned with the executing engine rather than maintaining a second SQL interpretation, but makes the actual WASM capability gate a dependency for query implementation. It is supported-language validation, not a sandbox for hostile authored SQL or HTML. This records the existing choice in the [runtime contract §6](../specs/runtime-contract-v1.md) and [Plan 03 P3.1](../plans/03-queries-and-filters.md). The [Plan 02 P2.1](../plans/02-data-loading-and-replacement.md) review must settle capability limitations and the binding strategy before dependent implementation; this ADR does not approve an unreviewed workaround or dependency upgrade.

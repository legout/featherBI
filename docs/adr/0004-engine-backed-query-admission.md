---
status: accepted
---

# Admit authored queries through the engine, not a text heuristic

Use the pinned DuckDB-WASM engine's parser metadata and canonical SQL APIs to admit the supported authored SELECT language, with typed filter values bound through prepared statements. Runtime-owned loading SQL is a separate boundary; a SELECT-prefix regex, custom grammar, or native-only check cannot replace browser-engine admission evidence.

This keeps admission aligned with the executing engine rather than maintaining a second SQL interpretation. It is supported-language validation, not a sandbox for hostile authored SQL or HTML. The pinned WASM capability gate is already established; [GitHub issue #1](https://github.com/legout/featherBI/issues/1) now owns the smallest production admission path required by the [runtime contract §6](../specs/runtime-contract-v1.md). This ADR does not approve a regex workaround, custom parser, or unreviewed dependency upgrade.

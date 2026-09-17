---
status: accepted
---

# Compile dashboard projects into typed capability-built viewers

Authors and agents maintain a source-controlled dashboard project—YAML, SQL, and optional scoped CSS—while deterministic tooling profiles local data, compiles that project into a strict runtime contract, and packages only the typed capabilities it uses. DuckDB-WASM remains the single owner of sources and SQL; ECharts, AG Grid Community, Perspective, CodeMirror, and theme adapters consume bounded results rather than establishing competing data lifecycles.

This supersedes [ADR 0002](0002-declarative-config-and-fixed-viewer.md) for the target runtime. It preserves the fixed-viewer and no-arbitrary-JavaScript boundary while replacing JSON-only authoring, Siemens-specific presentation, and the no-SQL-playground assumption. The trade-off is a compiler and capability registry, accepted so humans can edit concise source files, agents can run a repeatable interview/preview loop, and artifacts avoid loading every optional UI dependency.

The v2 migration replaced runtime contract v1 rather than extending it in place; transitional dual support existed only while staged implementation remained green and is now removed. Recipient SQL stays ephemeral and bounded; Perspective is a result viewer/preset above DuckDB, not a second source engine; AG Grid Enterprise and custom component plugins are outside the accepted scope.

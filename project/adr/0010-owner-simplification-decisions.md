---
status: accepted
---

# Owner decisions from the simplification review

Recorded 2026-10-19 from owner answers after four read-only analyses (runtime, authoring and skill, data layer and build, scope and process). Implementation is a separate, approved step; this ADR changes no code.

## Decided

- **E1 Primary sharing path:** a statically hosted `dashboard.html` whose data comes from public `https` sources declared `delivery: live` with `auth: none`. The recipient no longer selects local files as the standard flow. This supersedes the primary-path part of [ADR 0005](0005-external-data-only-delivery.md) once implemented.
- **ZIP fallback:** the ZIP with external data files stays for data without a public host. It receives no further expansion.
- **E2 Live reading:** recipients can read live CSV, JSON, Parquet files, Parquet file sets, Iceberg, DuckLake, and Delta. Every live source gets an explicit **Refresh** control. There is no automatic polling, consistent with the pinned-generation rule in [ADR 0009](0009-browser-only-lakehouse-readers.md).
- **E2 Delta:** DuckDB-WASM cannot load the Delta extension (`delta_scan` is native-only; wiki observation 2026-09-28). Delta is therefore read through an author-side export with native DuckDB to Parquet or Iceberg. The recipient reads that export live and uses Refresh. Freshness equals the export cadence.
- **E2 DuckLake:** browser support is unverified. A feasibility spike comes first. The spike decides scope: load the extension in the browser, attach a public catalog, read a table.
- **E3 Exploration:** Perspective, the SQL playground, and the `perspective-first` preset are opt-in. They are not part of the standard dashboard or the basic skill path.
- **E4 Themes:** agents create theme token files from style prompts ([ADR 0008](0008-theme-token-system.md)). The standard theme is `vercel` (name approved 2026-10-19; token values derived from `~/coding/libs/featherbi-mockups/shots/vercel.png`, visual approval in the E1 ticket). Further presets are prepared, including `siemens-ix` (dark) and `siemens-ix-light`.
- **E5 Authoring queries:** SQL is the standard authoring path. The metric catalog is not part of the standard path. Decided 2026-10-19: the metric catalog stays in the codebase as an opt-in feature.
- **E6 Setup:** `featherbi setup` keeps one default agent path. Agent variants and the DuckDB-skill prompt go.
- **E6 Profiler:** the native DuckDB profiler stays. This follows from the Delta export decision, because native DuckDB is the only engine that reads Delta. Not asked separately; confirm if you disagree.
- **E7 Process:** a lean process replaces the orchestration framework. The project keeps `AGENTS.md` and one short plan per change, not a multi-skill gate framework. Decided 2026-10-19: the installer-managed `pi-implementation-orchestrator` block in `AGENTS.md` is removed; `skills-lock.json` is pruned to the needed skills.

## Open

- DuckLake extension trust decision after spike S2 (plan 0005, gate G3): resolved 2026-10-19 — G3 approved the exact artifact and SHA-256 recorded in [ADR 0009](0009-browser-only-lakehouse-readers.md); the live source ships in #44.
- Visual approval of the `vercel` token values (inside the E1 ticket).

## Consequences when implemented (separate approval)

Plans: [plan 0005](../plans/2026-10-19-0005-static-sharing-and-live-refresh.md) (spec [2026-10-19-0005](../specs/2026-10-19-0005-static-sharing-and-live-refresh.md); issues #37–#45) and [plan 0006](../plans/2026-10-19-0006-simplification-and-standard-theme.md) (issues #46–#54). The ADR amendments above are written with these plans.

- `CONTEXT.md`: the `Artifact`, `ZIP bundle`, and `Upload mode` entries change with E1.
- [ADR 0005](0005-external-data-only-delivery.md), [ADR 0006](0006-compile-dashboard-projects-into-typed-viewers.md), [ADR 0008](0008-theme-token-system.md), and [ADR 0009](0009-browser-only-lakehouse-readers.md) need status and scope updates.
- `skill/featherbi/SKILL.md` steps 5 and 7 and the README "Recipient use" section describe the old file-selection flow and must change.
- `AGENTS.md` points to `project/plans/mvp.md`, which declares itself complete. The pointer must change with E7.
- Not chosen: `build --embed` (embedded single-file HTML). It conflicts with [ADR 0005](0005-external-data-only-delivery.md).

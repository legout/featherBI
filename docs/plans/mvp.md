# featherBI MVP plan

**Status:** approved. Owner approved the plan and its migration to GitHub Issues in the current planning-doc conversation. Tracker migration preserves the approved scope and changes only its decomposition location.

**Goal:** open a config, load local data, see and filter a dashboard, replace data safely, and share it as a ZIP bundle with data kept outside HTML.

**Sources:** behavior = [runtime contract v1](../specs/runtime-contract-v1.md) and [AP dashboard](../specs/ap-inspection-dashboard.md); constraints = [ADRs 0002–0005](../adr/) with ADR 0005 superseding ADR 0001; vocabulary = [CONTEXT.md](../../CONTEXT.md); optional hardening = [deferred.md](deferred.md).

**Capture checkpoint:** `Artifact` now means the ZIP-only external-data deliverable in `CONTEXT.md`; ADR 0005 records the consequential removal of embedded data; public remote URLs are deferred; no material MVP decision is unresolved. Planning-contract v1 provenance is recorded in `skills-lock.json`.

## Execution

This is the thin overview. Linked GitHub issues own the canonical task bodies; do not copy their editable details back into this plan.

- Execute tickets in order through `orchestrate-implementation`'s supervised mode with one sequential writer.
- Use one obligation per validation unit and the smallest check for its named failure mode. Run `npm run check` for every code change and `npm run test:browser` when browser/runtime behavior changed.
- Use parent inspection for low-risk work, one candidate review for normal-risk work, and immediate plus candidate review only for source/query lifecycle or other dependency-defining high-risk work.
- Commit accepted tickets separately. Integration, push, publication, and release retain separate approval gates.

## Foundation

Completed and integrated: shared config validator, compact synthetic fixtures, file:// Chrome harness, DuckDB-WASM boot/capability evidence, and initial CSV/JSON/NDJSON/Parquet source registration.

This foundation is reusable infrastructure, not release acceptance. Remaining validation and rollback behavior belongs to T1 rather than the archived horizontal plans.

## GitHub issues

1. [#1 — First usable filtered dashboard](https://github.com/legout/featherBI/issues/1) — ready; RC-01–RC-06.
2. [#2 — Complete AP inspection dashboard](https://github.com/legout/featherBI/issues/2) — blocked by #1; RC-07/RC-08/RC-10 and AP-01–AP-05/AP-07.
3. [#3 — Shareable artifacts and authoring skill](https://github.com/legout/featherBI/issues/3) — blocked by #2; RC-09/RC-11 and AP-06.

## Definition of done

- `npm run check` and `npm run test:browser` pass from a clean checkout.
- The owner builds against `/Users/volker/data/ewn/unified_ap.parquet`, extracts the ZIP, opens `dashboard.html` in desktop Chrome, selects the accompanying Parquet file, and confirms the AP baseline from the specification.
- Evidence maps to RC-01–RC-11 and AP-01–AP-07 without claiming deferred stress matrices, Edge/offline support, publication, or a performance SLA.

## Successor

The owner confirmed the locally integrated MVP in desktop Chrome. GitHub issue closure and push remain separate actions. The approved post-MVP execution map is [Dashboard project and runtime v2](dashboard-project-v2.md), whose canonical tasks are issues #4–#8.

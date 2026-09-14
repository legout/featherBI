# featherBI MVP plan

**Status:** approved. Owner approved the plan and its migration to GitHub Issues in the current planning-doc conversation. Tracker migration preserves the approved scope and changes only its decomposition location.

**Goal:** open a config, load local data, see and filter a dashboard, replace data safely, and share it as HTML or a ZIP bundle.

**Sources:** behavior = [runtime contract v1](../specs/runtime-contract-v1.md) and [AP dashboard](../specs/ap-inspection-dashboard.md); constraints = [ADRs 0001–0004](../adr/); vocabulary = [CONTEXT.md](../../CONTEXT.md); optional hardening = [deferred.md](deferred.md).

**Capture checkpoint:** no vocabulary changed, no new consequential architecture choice was introduced, and no material decision is unresolved. Planning-contract v1 provenance: `planning-contract` `671e9bf…c271`, `write-implementation-plan` `bd0ba5b…7032`, `orchestrate-implementation` `dd3b66f…0973` (full hashes in `skills-lock.json`).

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
- The owner builds against `/Users/volker/data/ewn/ap_unified.parquet`, opens the result in desktop Chrome, and confirms the AP baseline from the specification.
- Evidence maps to RC-01–RC-11 and AP-01–AP-07 without claiming deferred stress matrices, Edge/offline support, publication, or a performance SLA.

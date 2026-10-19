# Implementation plan: static sharing, live refresh, source export

**Status:** approved by owner in chat on 2026-10-19 (plan, spec 2026-10-19-0005, and Refresh for single-file live sources). Ticketized in GitHub Issues #37–#45; the issues own the canonical task bodies. Candidate assembly, integration, push, and publication remain separate gates.

**Goal:** a dashboard HTML hosted on a static host reads live sources without file selection. Every live source gets a Refresh control. Delta tables reach the browser through an author-side export. DuckLake goes live only after its gate.

**Behavior source:** [spec 2026-10-19-0005](../specs/2026-10-19-0005-static-sharing-and-live-refresh.md), approved revision 1 (2026-10-19), SL-01 to SL-08. Decisions: [ADR 0010](../adr/0010-owner-simplification-decisions.md), E1 and E2. Amended with this plan: ADR 0005, 0007, 0009 and the remote-sources, live-table and v2 specifications.

**Capture checkpoint:** vocabulary: *Static dashboard*, *Refresh*, *Source export* in [CONTEXT.md](../../CONTEXT.md). Decisions: ADR 0010 accepted; amendments written. Behavior: spec 2026-10-19-0005 approved revision 1. Uncertainty: DuckLake trust (G3), CSP shape (S1).

**Dependencies:** plan 0006 phases B–E may run in parallel where file targets do not overlap. Spikes write disposable harnesses plus an evidence note under `project/research/`; harness code is not merged.

- S1 evidence (2026-10-19): [static hosting, CORS, and CSP probe](../research/static-hosting-cors-csp-probe.md) — working CSP shape for T4 (#43) and CORS behavior for SL-07.
- S2 evidence (2026-10-19): [DuckLake extension gate probe](../research/ducklake-extension-gate-probe.md) — feasibility passed; the exact artifact URL and SHA-256 are recorded for the still-open G3 trust decision.

## Gates

- **G1** Approved 2026-10-19: owner approved this plan and spec 2026-10-19-0005.
- **G2** Approved 2026-10-19: Refresh applies to single-file live sources (CSV, JSON, Parquet file).
- **G3** Open: owner approves trust for the DuckLake extension artifact (URL and hash from S2), following the ADR 0009 Iceberg precedent. Blocks T5 only.

## Tickets — canonical task bodies

| Ticket | Task | Blocked by |
| --- | --- | --- |
| [#37](https://github.com/legout/featherBI/issues/37) | S1: Spike — static hosting, CORS, and CSP evidence | — |
| [#38](https://github.com/legout/featherBI/issues/38) | S2: Spike — DuckLake extension gate in DuckDB-WASM | — |
| [#39](https://github.com/legout/featherBI/issues/39) | S3: Spike — native Delta export to Parquet parts and manifest | — |
| [#40](https://github.com/legout/featherBI/issues/40) | T1: Refresh for all live sources | — |
| [#41](https://github.com/legout/featherBI/issues/41) | T2: Delta export command | #39 |
| [#42](https://github.com/legout/featherBI/issues/42) | T3: Static build target | #37, #40 |
| [#43](https://github.com/legout/featherBI/issues/43) | T4: Content-Security-Policy for the static target | #42 |
| [#44](https://github.com/legout/featherBI/issues/44) | T5: DuckLake live source (conditional; cancelled if S2 fails) | #38 + G3 |
| [#45](https://github.com/legout/featherBI/issues/45) | T6: Documentation and owner acceptance | #40–#43 |

## Requirement-to-task map

| Requirement | Tickets |
| --- | --- |
| SL-01, SL-02, SL-04 | #42 |
| SL-03 | #40 |
| SL-05 | #39, #41 |
| SL-06 | #38, #44 |
| SL-07 | #37, #43 |
| SL-08 (manual) | #45 |

## Global validation

`npm run check` after every code change; `npm run test:browser` after #40, #42, #43, #44 and on the assembled candidate. Documentation edits: link and diff inspection. One parent-owned fix pass and one delta recheck per candidate; remaining blockers go to the owner.

## Residual risks

- A CSP may block DuckDB-WASM loads; S1 gates T4.
- Data owners must configure CORS on their hosts; the viewer shows the remedy but cannot fix host configuration.
- Publishing data at a public URL is an author decision; the README trust limits apply.
- Delta extension availability for native DuckDB 1.5.5 is unverified until S3.

## Not in this plan

Browser reads of Delta. Removing Perspective or the playground. Deleting the metric catalog. Theme changes — those are in [plan 0006](2026-10-19-0006-simplification-and-standard-theme.md).

Contract provenance: planning-contract v1. Installed skill revision: `unknown`.

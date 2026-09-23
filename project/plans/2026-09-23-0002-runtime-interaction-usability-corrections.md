# Runtime interaction and usability corrections — implementation plan

**Status:** Approved for ticketization by the owner on 2026-09-23 (“appoved.ticketize”). Ticket creation does not authorize implementation, integration, push, or publication.

**Goal:** Complete the observable runtime-v2 corrections without introducing a second source lifecycle or a speculative streaming rewrite.

**Approved behavior:** [runtime interaction and usability corrections](../specs/2026-09-23-0002-runtime-interaction-usability-corrections.md), written revision approved by the owner on 2026-09-23; exact scope RI-01–RI-08. [Runtime v2](../specs/dashboard-project-and-runtime-v2.md), [remote sources v1](../specs/remote-sources-v1.md), [ADR 0006](../adr/0006-compile-dashboard-projects-into-typed-viewers.md), and [ADR 0007](../adr/0007-remote-sources-and-recipient-credentials.md) remain binding. [CONTEXT.md](../../CONTEXT.md) owns `Pending filter edits` and `Filter revision`.

**Capture checkpoint — planning-contract v1:** Vocabulary captured in `CONTEXT.md`; the approved specification owns behavior and non-goals; ADR 0006 owns the architectural boundary, so no new ADR is warranted. Streaming implementation remains conditional on probe evidence and would require a separate scoped design. Installed skill provenance: unknown.

**Execution:** GitHub issues below own the canonical task bodies (owned files, interfaces, prerequisites, validation obligations, and completion criteria). Execute sequentially with one writer through supervised `orchestrate-implementation`; candidate assembly, integration, push, and publication retain separate gates. Preserve DuckDB ownership, escaped content, bounded results, revision rollback, and credential handling. The target is extracted `file://` in installed desktop Chrome. At ticketization, desktop Chrome was absent at the three paths checked by `tests/browser/helpers.mjs`: **do not start runtime/browser slices until the required browser gate can run**; no fallback or waiver is authorized.

**Global validation:** Every code slice runs `npm run check`; browser/runtime changes also run `npm run test:browser` in installed desktop Chrome; viewer/bundle changes run `npm run build`. Documentation-only work gets focused link/diff inspection. Failed required gates stop handoff. One parent-authorized fix pass and one delta recheck at most; unresolved findings return to the owner.

## Sequential GitHub issues

1. [#15 — T1: Direct ECharts selection with coherent draft filters](https://github.com/legout/featherBI/issues/15) — contract/revision interface; `new-test`, immediate plus candidate review before #16 consumes it.
2. [#16 — T2: Perspective grouped/split selection](https://github.com/legout/featherBI/issues/16) — blocked by accepted #15; `new-test`.
3. [#17 — T3: Visible option-read errors](https://github.com/legout/featherBI/issues/17) — blocked by #15 draft/render behavior; `new-test`.
4. [#18 — T4: Boolean All / Yes / No](https://github.com/legout/featherBI/issues/18) — blocked by #15 control/draft behavior; `new-test`.
5. [#19 — T5: Safe-subset Markdown](https://github.com/legout/featherBI/issues/19) — independent behavior, sequential viewer writer; `new-test`.
6. [#20 — T6: Incremental bounded Arrow collection](https://github.com/legout/featherBI/issues/20) — independent of viewer work, sequential integration; `existing-check`.
7. [#21 — T7: Representative large-file memory probe](https://github.com/legout/featherBI/issues/21) — blocked by #20; `no-new-test`. A reproduced buffering failure returns to design, not a streaming patch under this plan.
8. [#22 — T8: One secret-parameter definition](https://github.com/legout/featherBI/issues/22) — independent, sequential writer; `existing-check`.
9. [#23 — T9: Correct agent-document routes](https://github.com/legout/featherBI/issues/23) — independent documentation; `no-new-test`.

## Requirement map

| Source criterion | Canonical issues |
| --- | --- |
| RI-01 | #15 |
| RI-02 | #16 |
| RI-03 | #15; #17 retains drafts on option errors |
| RI-04 | #17 |
| RI-05 | #18 |
| RI-06 | #19 |
| RI-07 | #20, #21; streaming needs separate approval |
| RI-08 | #22, #23 |

At final candidate assembly, inspect integration effects and run the applicable gates against the assembled candidate; do not reopen settled findings. No release, PR, push, or target integration is implied. The new specification and this plan remain local until a separately authorized commit/push; their GitHub issue-body links will not resolve on `main` before that publication.

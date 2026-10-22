<!-- featherBI project contract -->

Goal: a simple, fully functional featherBI MVP. Optimize for working user-visible features, not process ceremony or test volume.

## Sources

- Behavior: `project/specs/dashboard-project-and-runtime-v2.md`; `project/specs/runtime-contract-v1.md` is superseded historical migration evidence.
- Accepted architecture: `project/adr/`; vocabulary: `CONTEXT.md`; artifact routing: `project/agents/artifacts.md`; tracker and context layout: `project/agents/issue-tracker.md` and `project/agents/domain.md`.
- Scoped authority: glossaries own terminology; ADRs own accepted architectural constraints; specifications own behavior; plans and tickets own execution decomposition. No scope silently overrides another.

## Workflow

- One short plan or canonical task record (GitHub issue) per change. Issues own task bodies; plans own scope and order. `project/plans/2026-10-19-0007-ticket-execution-order.md` is the current order reference for issues #37–#54, not approved behavior.
- One writer per change; keep one writer per worktree.
- Name one validation obligation per validation unit (`new-test`, `existing-check`, or `no-new-test`) and use the smallest relevant check. Runtime/browser changes include the browser gate; documentation-only changes need focused link and diff inspection. Report skipped checks honestly.
- Integration, push, and release are separate gates; implementing or locally integrating a change authorizes none of the later ones.
- `project/plans/archive/` is historical; deferred items live in `project/plans/deferred.md` and require an explicit owner pull-back.
- Stop and ask the owner when authoritative sources conflict, a required gate fails, or required tooling is missing.

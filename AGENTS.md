<!-- featherBI agent workflow (MVP mode) -->

## Agent workflow

Goal: a simple, fully functional featherBI MVP. Optimize for working user-visible features, not process ceremony or test coverage.

- One plan owns the remaining work: `docs/plans/mvp.md`. Execute its steps in order. Behavior authority: `docs/specs/runtime-contract-v1.md`; accepted architecture: `docs/adr/`; vocabulary: `CONTEXT.md`; artifact map: `docs/agents/artifacts.md`.
- Execution: one agent implements a step directly in the working tree, then runs `npm run check` (and `npm run test:browser` when runtime/browser code changed). No patch/digest/manifest handoffs between agents; git is the transport.
- Review: the owner reviews at step boundaries via `git diff`. No fresh-context reviewer subagents unless the owner explicitly asks.
- Tests: unit tests cover hand-written logic (validation, normalization, packaging). One e2e browser spec is the acceptance gate. Never test library behavior (Ajv, DuckDB-WASM) or enumerate edge-case matrices. Deferred hardening lives in `docs/plans/deferred.md`; do not implement items from it unless the owner pulls them back.
- Every change ends with a green `npm run check`. Report skipped checks honestly. Commit per step.
- Stop and ask the owner when authoritative sources conflict, a required gate fails, or required tooling is missing.

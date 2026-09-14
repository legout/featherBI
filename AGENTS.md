<!-- featherBI project contract -->

## Project workflow

Goal: a simple, fully functional featherBI MVP. Optimize for working user-visible features, not process ceremony or test volume.

- The active execution map is `docs/plans/mvp.md`. Behavior authority is `docs/specs/runtime-contract-v1.md`; accepted architecture is `docs/adr/`; vocabulary is `CONTEXT.md`; artifact routing is `docs/agents/artifacts.md`.
- Execute approved work through `orchestrate-implementation` in its default supervised mode: one writer per managed worktree, with candidate assembly, integration, and publication kept behind their explicit gates.
- Plan and implement vertical slices. Give each validation unit exactly one obligation (`new-test`, `existing-check`, or `no-new-test`); do not test Ajv/DuckDB-WASM library behavior or build edge-case matrices without a named failure mode.
- Code changes use the smallest relevant check; runtime/browser changes include the browser gate. Documentation-only changes need focused link/diff inspection, not the application test suite. Report skipped checks honestly.
- `docs/plans/archive/` is historical; do not execute its old decomposition. Deferred items live in `docs/plans/deferred.md` and require an explicit owner pull-back.
- Stop and ask the owner when authoritative sources conflict, a required gate fails, or required tooling is missing.
<!-- pi-implementation-orchestrator:start -->
## Agent workflow

- Every validation unit receives one test obligation: `new-test`, `existing-check`, or `no-new-test`; related tasks may share a validation unit, and focused TDD is required only for `new-test` work.
- Review is adaptive and orchestrator-owned: low-risk work uses parent diff inspection; normal-risk work gets one candidate review; high-risk or dependency-defining work gets immediate plus candidate review.
- Plans and tickets reference exact feature sources; this file defines stable repository-wide scope.
- Scoped authority: glossaries own terminology; ADRs own accepted architectural constraints; specifications own behavior; plans/tickets own execution decomposition. No scope silently overrides another; reconcile owner decisions into the affected artifacts before dependent work proceeds.
- Stop before implementation when authoritative sources conflict.

### Routing and authority

- Read `docs/agents/artifacts.md` for the project artifact mapping and load the `planning-contract` skill for artifact classification and planning handoffs; read `docs/agents/issue-tracker.md` and `docs/agents/domain.md` when their scope applies. Preserve established project conventions.
- Use `shape-design` for unresolved behavior/design choices, `write-implementation-plan` for approved multi-step work, and `orchestrate-implementation` to execute approved work. Do not turn a trivial edit into a planning exercise.
- Default orchestrated execution to `supervised`: the `implementer` may implement and validate, but candidate assembly, integration, and publication retain explicit approval gates.
- Route implementation to the preconfigured `implementer` agent and, when required by the selected policy, independent review to a fresh read-only `code-reviewer`; if either is unavailable, stop and ask the owner before using builtin `worker`/`reviewer`, and record the approved resolved names in the run manifest.
- Keep one writer per worktree. Use `pi-subagents` for spawned-child lifecycle; named persistent `pi-intercom` peers are read-only advisors, not implementation or review agents.
- Use `systematic-debugging` for unexpected failures and `verification-before-completion` before success claims; match evidence to the exact change and report skipped checks.
- Use `merge-worktree` for target integration and `make-release` for releases. Local integration does not authorize pushing; opening a PR does not authorize merging; release or publication requires its own approved plan.
- Stop on conflicting authoritative sources, unclear ownership, failed required gates, or missing required tooling. Never silently switch execution modes to bypass a blocker.

### Documentation map

- `CONTEXT.md`: canonical domain vocabulary for the whole repository.
- `docs/adr/`: accepted architecture decisions.
- `docs/agents/`: workflow, tracker, and artifact-map configuration.
- `docs/specs/` or the configured tracker: feature behavior and acceptance.
- implementation plans/tickets: execution entry points and explicit source references.
<!-- pi-implementation-orchestrator:end -->

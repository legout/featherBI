<!-- pi-implementation-orchestrator:start -->
## Agent workflow

- Every task declares one test obligation: `new-test`, `existing-check`, or `no-new-test`; focused TDD is required only for `new-test` work.
- Review is adaptive and orchestrator-owned: high-risk or dependency-defining changes are reviewed immediately; low-risk changes may be reviewed cumulatively at a wave boundary.
- Plans and tickets reference exact feature sources; this file defines stable repository-wide scope.
- Scoped authority: glossaries own terminology; ADRs own accepted architectural constraints; specifications own behavior; plans/tickets own execution decomposition. No scope silently overrides another; reconcile owner decisions into the affected artifacts before dependent work proceeds.
- Stop before implementation when authoritative sources conflict.

### Routing and authority

- Read `docs/agents/artifacts.md` for the project artifact mapping and load the `planning-contract` skill for artifact classification and planning handoffs; read `docs/agents/issue-tracker.md` and `docs/agents/domain.md` when their scope applies. Preserve established project conventions.
- Use `shape-design` for unresolved behavior/design choices, `write-implementation-plan` for approved multi-step work, and `orchestrate-implementation` to execute approved work. Do not turn a trivial edit into a planning exercise.
- Default orchestrated execution to `supervised`: the `implementer` may implement and validate, but candidate assembly, integration, and publication retain explicit approval gates.
- Route implementation to the preconfigured `implementer` agent and independent review to a fresh read-only `code-reviewer`; if either is unavailable, stop and ask the owner before using builtin `worker`/`reviewer`, and record the approved resolved names in the run manifest.
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

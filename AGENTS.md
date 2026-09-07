<!-- pi-implementation-orchestrator:start -->
## Agent workflow

- Every task declares one test obligation: `new-test`, `existing-check`, or `no-new-test`; focused TDD is required only for `new-test` work.
- Review is adaptive and orchestrator-owned: high-risk or dependency-defining changes are reviewed immediately; low-risk changes may be reviewed cumulatively at a wave boundary.
- Plans and tickets reference exact feature sources; this file defines stable repository-wide scope.
- Source precedence: current owner decision → accepted ADR → approved specification → implementation plan → ticket → existing implementation.
- Stop before implementation when authoritative sources conflict.

### Routing and authority

- Read `docs/agents/issue-tracker.md` and `docs/agents/domain.md` when their scope applies; preserve established project conventions.
- Use `shape-design` for unresolved behavior/design choices, `write-implementation-plan` for approved multi-step work, and `orchestrate-implementation` to execute approved work. Do not turn a trivial edit into a planning exercise.
- Default orchestrated execution to `supervised`: workers may implement and validate, but candidate assembly, integration, and publication retain explicit approval gates.
- Keep one writer per worktree. Use `pi-subagents` for spawned-child lifecycle; named persistent `pi-intercom` peers are read-only advisors, not workers or schedulers.
- Use `systematic-debugging` for unexpected failures and `verification-before-completion` before success claims; match evidence to the exact change and report skipped checks.
- Use `merge-worktree` for target integration and `make-release` for releases. Local integration does not authorize pushing; opening a PR does not authorize merging; release or publication requires its own approved plan.
- Stop on conflicting authoritative sources, unclear ownership, failed required gates, or missing required tooling. Never silently switch execution modes to bypass a blocker.

### Documentation map

- `CONTEXT.md`: canonical domain vocabulary for the whole repository.
- `docs/adr/`: accepted architecture decisions.
- `docs/agents/`: workflow and tracker configuration.
- `docs/specs/` or the configured tracker: feature behavior and acceptance.
- implementation plans/tickets: execution entry points and explicit source references.
<!-- pi-implementation-orchestrator:end -->

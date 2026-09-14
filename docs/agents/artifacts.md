# Artifact mapping

Mapping: generated defaults. This file is declarative documentation, not executable configuration.

- docs/research/: investigations, design studies, and probe reports.
- docs/adr/: accepted architectural decisions.
- docs/specs/: behavioral contracts.
- docs/plans/: execution maps.
- docs/tickets/: local work items when the configured tracker is Local Markdown.
- docs/agents/: workflow configuration, including the tracker (docs/agents/issue-tracker.md) and the context layout (docs/agents/domain.md).
- CONTEXT.md: canonical domain vocabulary per the context layout declared in docs/agents/domain.md.

Project-specific mapping:

- `docs/plans/mvp.md`: sole active execution overview and GitHub issue order.
- [GitHub Issues](https://github.com/legout/featherBI/issues): canonical executable task bodies; `docs/tickets/` is unused.
- `docs/plans/deferred.md`: optional work outside MVP acceptance; it cannot override a specification.
- `docs/plans/archive/`: historical execution evidence only, never a source of pending tasks.

Planning artifact and handoff semantics are owned by the `planning-contract` skill from `legout/skills`.

Setup never moves existing documents and never fabricates glossaries, ADRs, or placeholder folders to match this map. A misplaced document is evidence of misclassification, not a mapping rule; resolve conflicts explicitly with the owner.

---
name: planning-contract
description: Canonical planning artifact and handoff contract. Use when classifying documents as research, ADRs, specs, plans, or tickets, mapping artifact paths, checking approval or execution readiness, or decomposing work into tasks.
---

# Planning Contract

Contract version: 1. This is the single canonical contract for classifying planning artifacts and governing handoffs between shaping, planning, and execution. Skills that shape, plan, or execute work load this contract by name rather than copying its rules into each skill. It is locally authored in this catalog; no upstream skill applies.

## Default artifact paths

| Destination | Owns |
| --- | --- |
| `docs/research/` | investigations, design studies, probe reports — evidence |
| `docs/adr/` | architectural decision records — why |
| `docs/specs/` | behavioral contracts — what and acceptance |
| `docs/plans/` | execution maps — how, decomposed |
| `docs/tickets/` | local work items |
| `docs/agents/` | workflow configuration, including the protected project mapping |
| root `CONTEXT.md` | single-context vocabulary; explicit multi-context projects use their owning context glossaries |

Directories are created lazily when real content exists for them. Setup never fabricates empty folders, placeholder glossaries, or fictional decisions.

## Project mapping

The installer-managed project mapping lives in `docs/agents/artifacts.md`, linked from the project's root agent instructions.

- The mapping is declarative documentation read by humans and agents. It is never an executable configuration file; nothing interprets it as code or config.
- Explicit project mappings override these defaults. A conflict between a mapping and established paths requires an owner decision; never resolve it silently.
- A research document found under `docs/specs/` is evidence of misclassification, not an established rule to copy. Route its content to research and link it from the owning artifact.
- Directory membership never grants approval. A mixed document is separated into evidence, behavior, and rationale with links; moving or rewriting existing content requires owner approval. No setup rerun moves existing documents, manufactures ADRs, or rewrites user notes automatically.

## Scoped authority

Glossaries own terminology; ADRs own accepted architectural constraints; specifications own behavior; plans and tickets own execution decomposition. No artifact silently overrides a conflict in another scope. Current owner decisions are authoritative, but must be reconciled into the affected artifacts before dependent work proceeds.

## Shaping capture checkpoint

Before handing a shaped change to planning or implementation, assess and report:

1. **Vocabulary:** resolved new or changed terms are captured in the owning glossary. No new terms is a valid outcome; missing confirmed vocabulary is not silently skipped.
2. **Decisions:** assess consequential choices against all ADR criteria — costly to reverse, surprising without context, based on real alternatives. Record a qualifying approved choice as an ADR or present its proposed ADR for approval; otherwise report that no ADR is warranted.
3. **Behavior:** identify scope, non-goals, acceptance criteria, and the approved source.
4. **Uncertainty:** unresolved material decisions block the next execution handoff. Research and probes may continue within their authorized scope.

Capture may happen during discussion; the checkpoint catches omissions. Its result is recorded with the shaped design or execution handoff, not as another standalone checklist document.

## Approval

- Research is evidence, even when the owner accepts its findings. Acceptance of findings is not authorization to build.
- Specifications and plans state whether they are proposed or approved, with a reference to the owner's approval and the exact scope and revision approved.
- Do not invent approval from a file's location, an assistant-written status, or an unrelated "yes". One explicit owner approval may cover multiple named artifacts and actions; do not demand redundant ceremonial prompts.
- Probe approval does not authorize keeping probe code or implementing the product. Planning approval does not inherently authorize writers. Integration and publication retain separate gates.

## Execution readiness

Before dispatching an implementer, verify: an approved behavioral source (or the bounded-change equivalent below), the capture-checkpoint result, requirement coverage, unresolved decisions, prerequisite evidence, owned surfaces, assigned validation, and execution authority.

Research alone, a draft specification, an ADR without behavioral acceptance, or a materially changed unapproved source cannot satisfy readiness. Report the specific missing prerequisite and route the work back to the skill that owns it. A material behavior, interface, or scope change invalidates the readiness of affected tasks until source and decomposition are reconciled and approved; unaffected tasks need no reapproval, and cosmetic edits need no new behavioral approval. This contract adds planning readiness on top of existing baseline, clean-worktree, independent-review, and integration checks; it replaces none of them.

## Work size and decomposition

- An understood bounded change may proceed from an explicitly approved issue or short design with acceptance criteria, without a separate specification and plan. The capture checkpoint still applies proportionately.
- Substantial work uses a linked behavioral source and the smallest execution map that exposes dependencies, ownership, requirement coverage, and global validation. Each task names its source criteria, owned surfaces, consumed and produced interfaces, prerequisites, test obligation, completion evidence, and non-goals, so a fresh implementer can execute it without accumulated chat.
- A small feature keeps its tasks in one compact plan. When tracker coordination is required, tickets own the canonical task bodies and a thin overview links to them; never maintain duplicate editable task definitions. Sequential work uses bounded tasks with shared context in the linked source, not duplicated full plans.
- Parallel execution requires satisfied dependencies, stable consumed interfaces, and non-conflicting ownership. Distinct ticket files alone do not justify parallel writers. Contract-defining tasks are accepted before dependent tasks consume them.

## Installation and missing-contract behavior

This skill is installed explicitly alongside its consumers; the skills CLI does not resolve skill-to-skill dependencies.

Standalone installation:

```bash
npx skills add legout/skills --skill planning-contract --global --agent pi --yes --copy
```

When installing consumers explicitly, include `planning-contract` in the same skill list so the contract is reachable after selected-skill installation, in global and project scope alike.

A consumer installed without this contract must detect its absence, refuse to proceed on inherited or invented rules, and request installation of the `planning-contract` skill. It must never assume automatic dependency resolution or silently continue.

## Version and provenance

This contract identifies itself as Contract version: 1. A consumer that depends on changed semantics records the contract version it was written against.

At handoff, record the contract version and the available installed skill revision or provenance, such as the installed catalog revision. If exact provenance is unavailable, record `unknown` explicitly rather than claiming a reproducible installation. This is honesty about what is installed; it is not a package lock system, and no lockfile is maintained.

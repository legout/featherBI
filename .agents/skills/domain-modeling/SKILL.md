---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editing an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

This skill owns domain vocabulary and durable decision records. `shape-design` owns feature behavior and requirements. An ADR records **why** a hard-to-reverse decision was made; it is not a specification or implementation plan.

This skill is the acting half of the vocabulary and decisions parts of the [`planning-contract`](../planning-contract/SKILL.md) capture checkpoint (Contract version: 1): shaping calls it when resolved terms or qualifying decisions need capture. Load that contract for classification, scoped authority, and handoff rules; if it is not installed, stop and request installing `planning-contract` rather than proceeding on inherited or invented rules.

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, or the project explicitly declares multiple contexts, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily: only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved — for any single-context project, configured or unconfigured. Never create a root `CONTEXT.md` for a configured multi-context project. If no `docs/adr/` exists, create it when the first ADR is needed.

## Discover context ownership

Before writing a glossary, read `docs/agents/domain.md` when present. Treat its explicit single/multiple-context declaration as configuration, not as a reason to invent names. Then:

1. If `CONTEXT-MAP.md` exists, read it and follow its real paths.
2. Inspect the relevant package/context directories and their existing `CONTEXT.md` or glossary files.
3. If a term could belong to more than one context, ask which real context owns it rather than choosing silently.
4. If explicit configuration and existing map/glossary evidence conflict, surface the conflict and ask the owner which source to update; do not rewrite either source automatically.
5. For explicit multiple-context projects with no map or resolvable owner, stop and ask for the real context ownership. **Do not create a root `CONTEXT.md` just because the map is absent.** Capture a map or context glossary lazily once ownership is known.
6. A project configured as single-context, or unconfigured with no map, preserves the single-context fallback: use the root `CONTEXT.md`, creating it lazily when the first term is actually resolved. A configured single-context repository with no glossary yet creates its first real glossary the same way; it does not need a context map.

The installer does not create placeholder glossaries or fictional domain names. A context map is meaningful only when it names real contexts and relationships.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update CONTEXT.md inline

When a term is resolved, update the owning `CONTEXT.md` right there. Don't batch these up: capture them as they happen. Use the format in [context-format.md](./references/context-format.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. When the capture checkpoint asks, report that no ADR is warranted instead of manufacturing one. Use the format in [adr-format.md](./references/adr-format.md).

After recording an ADR, return to the calling design workflow. If the decision changes observable behavior, invariants, or acceptance criteria, capture those in the specification rather than expanding the ADR.

## Provenance

Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/domain-modeling) at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT).

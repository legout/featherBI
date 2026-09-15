---
name: prototype-question
description: Build throwaway code to answer a design question about logic, state, feasibility, or UI appearance.
---

# Prototype

> Adapted from Matt Pocock's [`prototype`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/SKILL.md) skill at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT). Observable-uncertainty routing is adapted from Cursor's [`poteto-mode`](https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/poteto-mode) prototype playbook at commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99` (MIT, Copyright (c) 2026 Cursor).

A prototype is disposable code that answers one written question. When `shape-design` delegated a Spike, return the evidence and verdict to that workflow; `shape-design` owns the resulting production decision. A selected UI variant is never approval for production implementation; preserve the verdict and return through the normal design handoff.

Load the [`planning-contract`](../planning-contract/SKILL.md) skill (Contract version: 1) for artifact classification and approval boundaries. If it is not installed, stop and request installing `planning-contract` rather than proceeding on inherited or invented rules; never assume automatic dependency resolution. When the probe report is durable, file it as research evidence under `docs/research/` and link it from the owning design — never `docs/specs/`. Probe approval does not authorize keeping prototype code or implementing the product.

Separate observable uncertainty from user-owned decisions. Behavior, timing, layout, compatibility, output, and performance questions are observable uncertainty: answer them by building and running the probe, not by asking the user. Product intent, preferences, trade-offs the user owns, and irreversible decisions remain questions for the user.

## Choose the artifact

- **Logic/state:** read [`references/logic.md`](references/logic.md), then make the smallest runnable harness that exercises hard cases and displays full state after each action.
- **UI:** read [`references/ui.md`](references/ui.md), then make several meaningfully different variants that can be compared from one route or artifact. Build multiple variants only when the alternatives are genuinely viable; a routine question needs one probe.
- **Feasibility:** build only the risky seam needed to answer whether the approach works.

If the question is ambiguous, ask. If the user is unavailable, infer from context and state the assumption prominently.

## Constraints

1. Label files and UI as `PROTOTYPE`.
2. Keep it close to the code it informs without inventing a permanent architecture.
3. Provide one obvious run command or a self-contained file.
4. Keep state in memory unless persistence is the question.
5. Skip production abstractions, broad error handling, and polishing.
6. Surface inputs, outputs, and relevant state so the result is inspectable.
7. Do not silently promote prototype code into production.

## Close the experiment

Report:

- the question;
- the evidence observed;
- the answer and confidence;
- what would invalidate it; and
- the production recommendation, if any.

Preserve the verdict in the issue or design when durable. Remove the prototype from the main change unless the user explicitly chooses to keep a clearly isolated experimental artifact.

---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown research note in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Use this for durable, primary-source research. Use `last30days` instead when the question is specifically about recent community discussion, sentiment, or trends.

Load the [`planning-contract`](../../workflow/planning-contract/SKILL.md) skill (Contract version: 1) before saving findings; it owns artifact classification and handoff rules. If it is not installed, stop and request installing `planning-contract` rather than proceeding on inherited or invented classification rules. Never assume automatic dependency resolution.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown note, citing each claim's source.
3. Save it as research evidence: investigations, design studies, and probe reports belong under `docs/research/` by default. Depart from that default only via the project's explicit mapping in `docs/agents/artifacts.md` or an explicit owner decision. When research notes already exist elsewhere, inspect that established convention and report it — with any conflict against the mapping or default — for an owner decision instead of silently adopting it; a research note found under `docs/specs/` is misclassification evidence to report, not a convention to copy. Link the note from the owning specification or design when one exists.

## Approval boundary

Research is evidence, even when the owner accepts its findings. Acceptance of findings is never authorization to build; behavioral contracts with acceptance criteria belong in `docs/specs/` and are shaped by `shape-design`. When handing findings to another skill, record the contract version and the available installed provenance, or `unknown` if exact provenance is unavailable.

## Provenance

Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/research) at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT).

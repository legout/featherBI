---
name: orchestrate-implementation
description: Use when implementing a project or feature from ADRs, specifications, issues, or plans, especially when work spans multiple tasks, reviewers, worktrees, repositories, or Pi sessions.
---

# Orchestrate Implementation

> Worktree isolation patterns are adapted from [`using-git-worktrees`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/using-git-worktrees/SKILL.md) and David Ondrej's [`git-worktree`](https://github.com/davidondrej/skills/blob/11dee2ebc2d045806b686ba0b57746f1e3d7e331/skills/agent-orchestration/git-worktree/SKILL.md). Test-seam patterns are adapted from Matt Pocock's [`tdd`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/SKILL.md), [`tests`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/tests.md), and [`mocking`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/mocking.md) guidance (all MIT). Exact pins are recorded in `sources.json`.
>
> Shared-write separation, smallest-safe-decomposition, and bounded child context are adapted from Cursor's [`poteto-mode`](https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/poteto-mode) at commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99` (MIT, Copyright (c) 2026 Cursor).

## Overview

The current session is the orchestrator. Keep user intent, scope, authority, routing, candidate assembly, and final acceptance here. Delegate bounded evidence gathering and implementation; do not turn a collection of chat sessions into an implicit scheduler.

The parent owns every child's work: review the diff yourself and write the final conclusion; a child's self-report is input, not acceptance. Delegate large outputs and bulk exploration, but hand children bounded file references and a task contract rather than accumulated conversation history.

Default to lean assurance: use the smallest evidence set that establishes acceptance criteria and addresses named material risks. Do not add tests, validation commands, reviewers, or review rounds for speculative failures or duplicate evidence. Escalate assurance for security, permissions, secrets, money, destructive data handling, migrations, concurrency, distributed behavior, and public contracts; do not weaken approval, data-integrity, or publication gates.

## Review ground rules

Agreed feature, then correctness, then proven risk. Written conventions are binding and violations are must-fix; unwritten reviewer taste never blocks. A reportable finding must violate a named requirement or written rule, be caused or worsened by this change, be reachable through real callers/inputs/environment, matter, and have a proportionate response. Test requests pass the same gate: name a real scenario, not a coverage target.

Security review activates only for touched untrusted/external input, credentials, auth, or dependency boundaries. Require a named asset, realistic attacker, and actual attack path. Stolen-secret, broken-TLS, malicious-admin, and generic-hardening stories are not findings. Otherwise write `security: n/a`; missing security facts stay `unverified`, never become invented threats. Trusted internal libraries and user-owned local data are not hostile by default; service tasks use the real deployment/auth/network boundary. Written safety guarantees remain binding.

The parent dispositions every finding before repair: reject failed gates in one line, authorize small in-scope fixes, or hand large/out-of-scope fixes to the human. Only the parent starts fixes/rechecks. Review ends once criteria, real risks, and written rules are covered, with `pass` or `fix-first`; finding count is not success. One fix pass, one delta recheck, then ask the human; no third round. Candidate review does not reset that budget or reopen settled findings.

After each task, restate the approved task, compare the result, and choose `accept / fix / hand back / ask`. Extra ideas get one line, not code. Keep the smallest safe change; dependencies and abstractions need a job today. Use existing reports, not new ledgers, lifecycles, or sign-off artifacts.

**REQUIRED SUB-SKILL:** Use `pi-subagents` for child lifecycle, fresh contexts, managed worktrees, artifacts, missions, review, and recovery.

Use `pi-intercom` only for explicitly named, persistent read-only peers or visible cross-project peers. Spawned children use Pi's native supervisor channel for decisions and progress.

## Durable handoff and recovery boundary

The worker worktree is an execution detail, not the review artifact. Before mutation, create a collision-checked, parent-owned named base ref such as `refs/heads/orchestrator/<run>/base/<lane>` at the approved lane base. Record its resolved SHA and require that the ref still resolves to that SHA before every recovery. Pass the named ref—not a raw SHA or the moving parent `HEAD`—to managed allocation.

Require each mutation lane to report a complete binary-capable patch, its digest, worker-reported commit/tree/cleanliness, and the runtime handoff/cleanup status. Keep the base and handoff artifacts until every consumer is terminal. Missing, partial, dirty, corrupt, or inconsistent handoffs block acceptance; a child exiting is not success by itself.

When the worker worktree or branch is gone, reconstruct in a registered parent-owned review worktree outside extension auto-discovery and the active source checkout: create it from the pinned named base, verify the patch digest, run `git apply --check` and `git apply --index`, and compare the staged tree with the expected worker tree. Commit that reconstructed tree, run focused checks there, and apply the selected review policy to its exact base/head range. Record worker provenance separately from the materialized review SHA/tree; advance `lastReviewedSha` only for the reconstructed branch.

A fix worker replays a full patch relative to the original pinned base. The replacement patch supersedes the prior full lane patch; it is not an incremental patch applied on top of the previous result. Preserve the prior materialized review ref/SHA before reconstruction. Reconstruct the full replacement from the pinned base, but re-review only `priorReviewSha..replacementReviewSha` and the behavior the accepted fixes address. Full-patch transport does not reset review scope or the correction budget; missing prior review evidence requires an owner decision, not a full review restart. Assemble accepted reconstructed commits in a separate registered candidate worktree, then hand `merge-worktree` the candidate path, branch, base/head, checks, review evidence, and authorization state.

## Modes

Choose one mode from the request or configured default:

- **`plan-only`**: normalize inputs, create the manifest and task briefs, and make no source edits.
- **`supervised`** (default): run workers with proportional validation and review, then pause before cherry-picking or publication.
- **`autonomous`**: run the same loop and cherry-pick accepted commits when clean; pause on conflicts, unresolved decisions, failed gates, missing required peers, push, PR merge, deploy, or release.

If the user does not specify a mode, use `supervised` and state that choice briefly.

## Intake and preflight

Load the [`planning-contract`](../planning-contract/SKILL.md) skill (Contract version: 1) before dispatch; it owns artifact classification, approval, and readiness. If it is not installed, refuse to dispatch and request installing `planning-contract` rather than proceeding on inherited or invented rules; never assume automatic dependency resolution.

Read all supplied ADRs, specifications, issues, plans, and approved designs before dispatching a writer. Preserve them as source material. Classify each input with the contract: research reports, probe verdicts, and ADRs without behavioral acceptance are evidence, never approved behavioral sources. Extract:

- constraints, invariants, and non-goals;
- acceptance criteria and validation evidence;
- source seams and claimed files/contracts;
- task dependencies and candidate-assembly order; and
- unresolved owner decisions.

Stop before mutation when inputs conflict or a material acceptance criterion is missing. Ask for the exact owner decision instead of selecting one silently.

Require a git repository for mutation modes. Verify repository, cwd, base ref, cleanliness, and worktree support before allocating writers. Detect whether the harness already provides isolation; never create nested or manually registered mutation worktrees when managed child worktrees are available. Registered parent-owned review and candidate checkouts are the one deliberate exception: they exist only for reconstruction, focused checks, review, and assembly of already-captured lanes. They are not nested child worktrees, not a second child allocator, and never concurrent shared-writer locations; managed mutation children stay with `pi-subagents`. A non-git directory may use `plan-only`; it must not receive mutation-capable workers.

Before dispatch, run or record the smallest fast baseline able to distinguish pre-existing failures from task regressions. Do not run the full repository matrix unless project policy or the named risks require it. If the baseline is red, separate pre-existing failures from task obligations and ask whether to investigate or proceed; never attribute them to a worker later. Each mutation lane gets one managed worktree and one writer. Follow the plan's smallest safe decomposition: do not create lanes merely to parallelize or add review points, and prefer one writer when coordination would cost more than the work. The orchestrator owns managed lane cleanup and candidate assembly. `merge-worktree` separately owns target-branch integration and cleanup of the completed source worktree.

Normalize different plan formats with a read-only scout. Preserve the planner's source documents; do not require every planning skill to emit one new format.

## Planning readiness gate

Before dispatching any implementer, verify execution readiness as defined in `planning-contract` — the sole canonical procedure; never restate its checklist here. Refuse the dispatch before any writer or worktree is allocated, report the specific missing prerequisite, and route the work back to the skill that owns it — `shape-design` for behavior and approval, `write-implementation-plan` for decomposition. A material change discovered during execution re-runs the contract's readiness rule for the affected tasks before further dispatch.

Record in the manifest: each source artifact's classification, approved scope and revision, and approval reference; the capture-checkpoint outcome; the contract version and available provenance, or `unknown`; and each task's prerequisite evidence and readiness verdict.

## Risk and test obligations

Classify each validation unit as low, normal, or high risk using the lean assurance policy in the approved plan. Several tightly related tasks may share one validation unit; do not multiply checks per checkbox. Assign exactly one obligation to each unit:

- `new-test`: changed behavior lacks meaningful existing coverage and a named reachable failure would otherwise be unprotected. Add one focused test at the cheapest stable public seam with an independently derived expected value: failing test → intended failure → minimal implementation → passing focused check. Add further tests only for distinct material failure modes.
- `existing-check`: an existing focused check already exercises the changed behavior. Add no redundant test; run and report that check.
- `no-new-test`: a new test would prove little, including documentation, formatting, comments, static metadata, generated artifacts, mechanical changes, or behavior-neutral refactoring. Run the smallest meaningful parse, build, smoke check, or diff inspection.

For every command or manual check, name the failure mode it covers. Reuse required CI; do not repeat the full suite in every lane or test the same behavior at multiple layers without a distinct risk. A worker may challenge the assignment after inspection but must report why; it may not silently skip validation. Evidence is mandatory, but more evidence is not automatically better evidence.

## Execution references

Before dispatch, read [manifest and briefs](references/manifest-and-briefs.md). For native child/worktree mechanics, read [Pi dispatch](references/pi-dispatch.md). Before accepting work or recovering a failed lane, read [review and recovery](references/review-and-recovery.md).

## Quick reference

| Situation | Action |
|---|---|
| Non-git directory | `plan-only`; no mutation workers |
| Conflicting sources | Stop before dispatch; request owner decision |
| Research-only, draft, or unapproved source | Refuse dispatch; route the work back to the owning skill |
| Independent writers | Managed worktree per writer |
| High-risk or dependency-defining task | Immediate review |
| Low-risk completed task | Run its focused check and include it in the parent's final diff inspection; no independent task review |
| Dependent tasks | Serial handoff with explicit interface |
| Spawned child question | Native supervisor channel |
| Persistent specialist | Named read-only intercom peer |
| Missing optional peer | Fresh advisor fallback |
| Missing required peer | Pause |
| Review finding | Parent dispositions first; one batch of accepted small in-scope fixes, then one fresh delta-only recheck; unresolved or large fixes go to the human |
| Missing/corrupt handoff | Block acceptance; preserve the artifact and owned refs for recovery |
| Candidate-assembly conflict | Pause and preserve ownership |
| Push/merge/deploy/release | Separate authority gate |

## Common mistakes

- Treating intercom messages as durable state instead of using missions and artifacts.
- Calling persistent sessions "clean" despite retained history.
- Running parallel writers in one checkout.
- Giving every worker the whole plan and accumulated reports.
- Letting a reviewer or worker become the final scope or publication authority.
- Starting a replacement writer before failed-lane ownership is resolved.
- Assuming a completed child's worktree or cwd still exists at fix time; durable handoff patch paths, pinned named bases, and registered parent-owned review/candidate checkouts are the recovery boundary.
- Treating a worker-reported SHA as the reviewed tree without reconstructing and checking the artifact.
- Adding duplicate tests, broad validation matrices, or review rounds without a distinct reachable failure mode.
- Dispatching a writer from research findings, a draft specification, or a materially changed unapproved source.
- Calling autonomous candidate-assembly permission to integrate or publish.

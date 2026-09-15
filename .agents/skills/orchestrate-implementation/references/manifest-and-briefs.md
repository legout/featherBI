# Implementation manifests and briefs

## Run manifest

Create one compact run manifest in runtime-managed artifacts. Record:

- repository, cwd, base ref, and mode;
- source artifact references, each with its planning-contract classification, approved scope and revision, and approval reference;
- the contract version and available provenance, or `unknown`;
- the capture-checkpoint outcome;
- normalized constraints, non-goals, and acceptance criteria;
- task IDs, dependency edges, lanes, and claimed files/contracts;
- per-task readiness: prerequisite evidence and the readiness verdict recorded before dispatch;
- worker, reviewer, simplifier, oracle, and peer configuration;
- validation units with risk, named failure modes, focused commands, review policy, and the one-fix/one-delta-recheck limit (not reset at candidate assembly);
- unresolved decisions and their owners;
- per-lane pinned named base ref and resolved SHA, worker-reported commit/tree/cleanliness, materialized review ref/worktree and SHA/tree, lane base/head/last-reviewed SHA, and handoff/cleanup state;
- candidate-branch base, head, registered worktree, cherry-picks, exact review range, and review state; and
- residual risks and artifact references.

Store large content in artifacts. Keep only paths and concise summaries in the manifest or mission state.

## Cold-start task brief

Give each worker one bounded brief containing:

1. goal;
2. repository, cwd, base ref, lane, and managed worktree;
3. allowed files/contracts and authority boundary;
4. relevant upstream interfaces, the approved behavioral source with its exact approved scope and revision, and approved decisions;
5. acceptance criteria;
6. the validation unit's risk, named failure mode, and focused command not already covered by required CI;
7. test obligation: the assigned obligation and its rationale;
8. commit and report requirements; and
9. stop/escalate conditions.

Do not paste the complete plan or accumulated task history into worker prompts. Include relevant written conventions (named sources/rules, or none found), real callers/input provenance/environment, and any actually touched trust boundary. Never infer that an internal library or user-owned local data is internet-facing.

Paste this guardrail into each worker's task, including fix workers:

```text
Approved scope outranks reviewer suggestions. Use the smallest safe change; dependencies and abstractions need a job today. Follow named written conventions; taste is not a requirement. Test requests require a real reachable scenario, not coverage percentage or impossible inputs; use the assigned focused obligation, one failing test first for new-test.
Do not act on raw reviewer output. The parent must first disposition each finding: reject failed gates in one line, authorize a small in-scope fix, or hand a large/out-of-scope fix to the human. Challenge accepted findings that source inspection contradicts instead of silently implementing them. Security findings need a touched boundary, named asset, realistic attacker, and actual path through real use; stolen-secret, broken-TLS, malicious-admin, and generic-hardening stories fail the gate. Missing security facts are unverified, not invented threats.
Only the parent starts fixes/rechecks. One fix pass, one delta recheck, then ask the human; no third round. After the task, restate its approved goal, compare the result, and choose accept / fix / hand back / ask without resetting that limit. Extra ideas get one line, not code.
```

The worker report contains:

- status and commit IDs;
- changed files;
- test-obligation evidence: the assigned obligation, named failure mode, commands, and results; failing test before and passing test after implementation for `new-test`;
- validation commands and results;
- the one-sentence approved-task comparison and `accept / fix / hand back / ask` recommendation (the parent still owns acceptance);
- open decisions and residual risks; and
- artifact and handoff references, including the complete patch digest, worker tree/cleanliness, runtime cleanup state, and any warnings.

The manifest must distinguish four identities: worker provenance (the commit/tree reported by the child), the materialized review commit/tree (the parent-owned reconstruction actually checked), the lane review boundary (`lastReviewedSha` on that reconstruction), and the candidate commit/tree assembled from accepted reviewed lanes. Never copy a clean verdict between these identities. Retain the prior materialized review ref/SHA for a fix: the replacement is reconstructed from the original pinned base but the recheck compares the old and new materialized endpoints, not the full replacement against the base. Record these ranges in the existing review state, not a new ledger.

Workers do not expand scope, assemble other lanes, publish, or delegate further unless the orchestrator explicitly grants that authority.

## Roles and context

| Role | Context | Authority |
|---|---|---|
| Orchestrator | Parent | Routing, decisions, acceptance, candidate assembly |
| Scout/normalizer | Fresh | Read-only repository and input inspection |
| Worker | Fresh | Sole writer in one managed worktree; evidence per assigned test obligation |
| Reviewer | Fresh | Read-only review against the exact task diff |
| Simplifier | Fresh | Optional read-only complexity challenge |
| Oracle | Forked, exceptional | Advisory hard-decision escalation |

Profiles represent stable model, tool, thinking, context, or stance differences. Do not create a profile per task.

## Persistent intercom peers

Persistent peers are optional read-only consultants:

- `architecture-peer`: ADR and design consistency;
- `domain-peer`: product and domain ambiguity; and
- `quality-peer`: retained quality perspective before candidate assembly.

At configured checkpoints:

1. call `intercom({ action: "list" })`;
2. ask only live, explicitly configured peers bounded questions;
3. record advice as evidence in the manifest; and
4. use the configured missing-peer policy: `fresh-advisor` or `pause`.

Named peers must already be running or be opened separately as visible project panes. Do not claim that intercom created a clean session. Peers may not edit production code, commit, integrate, push, merge, deploy, or release.

Spawned children use `contact_supervisor` for blocking decisions or meaningful progress. The parent responds through `subagent_supervisor`. Do not route ordinary child lifecycle through generic intercom.

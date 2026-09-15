# Managed lifecycle acceptance fixture (executable, live run PENDING)

This is a bounded **executable** native Pi acceptance fixture for `orchestrate-implementation`. Unlike the offline suite (`tests/orchestrator_handoff_test.sh`, which replays the documented recipe against a synthetic Git fixture), this fixture must be run live through the native Pi runtime. **Status: PENDING — it has not been executed yet.** A green offline suite is not evidence for this fixture; do not claim it passed without the evidence fields below.

## Hard boundaries

- All Git mutations must belong to the **disposable Git repository** created for this run (see setup). Never use, mutate, or publish from an unrelated project checkout.
- Use the `orchestrate-implementation` skill and native Pi subagent tooling (`pi-subagents`); discovering agents/capabilities first is part of the run.
- Execute this fixture in **autonomous** mode: authorization to run this disposable evaluation includes assembly of accepted reconstructed commits in its candidate checkout, but no target integration, push, PR, deploy, release, or publication. If the owner instead selects supervised mode, pause before assembly and report **AWAITING APPROVAL**, not PASS or an infrastructure failure.
- **Fail closed:** if any native prerequisite is unavailable (runtime not installed, no configured model credentials, no disposable-repo execution permission, protocol mismatch), report the run as **BLOCKED** with the exact error and stop. Never switch to a CLI/foreground fallback mode to force a result, and never report a blocked run as success.
- Do not import private runtime modules or invent runtime APIs; only documented native request shapes.

## Disposable setup

```bash
set -euo pipefail
run_root=$(mktemp -d "${TMPDIR:-/tmp}/managed-lifecycle.XXXXXX")
mkdir -p "$run_root/repo"
git -C "$run_root/repo" init -q
git -C "$run_root/repo" config user.name "managed lifecycle fixture"
git -C "$run_root/repo" config user.email "managed-lifecycle-fixture@example.invalid"
printf 'seed\n' > "$run_root/repo/seed.txt"
git -C "$run_root/repo" add seed.txt && git -C "$run_root/repo" commit -qm "fixture base"
```

Keep parent-created review/candidate checkouts under `$run_root`. Native managed worktrees and handoff/report artifacts may use the runtime's configured locations outside `$run_root`; record their exact paths and ownership rather than changing runtime placement or copying a report in place of the captured patch. Verify every mutation checkout's canonical `git rev-parse --git-common-dir` identifies `$run_root/repo/.git` before using it. Only this fixture's recorded resources may be cleaned up; preserve failed or uncertain artifacts.

## Scenario

1. **Discover:** list available agents/capabilities through the native protocol; record the runtime version.
2. **Pin:** create the collision-checked named base `refs/heads/orchestrator/<run>/base/api` at the approved lane base with the documented pin recipe; record the resolved SHA.
3. **Worker:** launch one small managed mutation worker with fresh context from the named `baseRef`, a bounded brief, a `new-test`-style check, and a declared report output path. Let normal child finalization run — do not request retention of the worktree.
4. **Handoff:** consume the actual runtime handoff artifact: complete binary-capable patch path, digest, worker-reported commit/tree/cleanliness, and recorded cleanup state (worktree removed/preserved).
5. **Move parent:** commit an unrelated change on the parent branch so its HEAD advances past the pinned base.
6. **Reconstruct:** run the documented replay recipe: verify the pin, verify the digest, `git apply --check`/`--index` in a registered parent-owned review worktree, verify the staged tree equals the reported clean worker tree, commit, run the focused check there.
7. **Review:** dispatch a fresh read-only reviewer against the exact `base..reconstructed-head` range with the full inline reviewer contract and actual fixture criteria; record the verdict. Preserve the materialized review ref/SHA. Plant one real criterion violation for this fixture's repair, not a pseudo-finding.
8. **Fix:** launch a fresh managed fix worker from the same verified pinned base, replaying the full prior patch and applying one accepted finding; capture its complete replacement patch and digest; let finalization clean up.
9. **Replace:** reconstruct the replacement patch from the pinned base on a distinct review branch; verify it is a full replacement (not incremental). Recheck only the direct `priorReviewSha..replacementReviewSha` delta and the accepted finding's behavior. One fix pass, one recheck; unresolved findings stop for the human, never reset the budget or re-review settled code.
10. **Candidate:** assemble the reconstructed reviewed commit in a registered candidate worktree; record the handoff fields for `merge-worktree`; stop before integration.

## Required evidence fields

| Field | Meaning |
|---|---|
| `runtime_version` | Actual Pi/`pi-subagents` version used |
| `agents_discovered` | Agent/capability discovery result |
| `run_id`, `lane_id` | Run and lane identifiers, terminal worker/fix/reviewer IDs, and native request shapes |
| `base_ref`, `base_sha` | Named base pin and resolved SHA (before/after checks) |
| `patch_path`, `patch_digest` | Complete handoff patch and digest; same for the replacement |
| `worker_report` | Worker-reported commit/tree/cleanliness |
| `finalization_state` | Runtime cleanup result: worktree/branch removed or preserved; exact managed paths and disposable-repository ownership checks |
| `parent_moved_sha` | Parent HEAD after movement |
| `review_ref`, `review_sha`, `review_tree` | Materialized reconstruction identities |
| `review_range`, `review_verdict` | Exact reviewed range and verdict |
| `replacement_digest`, `prior_review_sha`, `recheck_range` | Full replacement digest, preserved prior materialized review SHA, and exact delta recheck endpoints |
| `candidate_ref`, `candidate_path`, `candidate_base`, `candidate_head` | Registered candidate handoff |
| `handoff_fields` | Fields handed to `merge-worktree` |
| `cleanup_evidence` | What was cleaned up, what was preserved, and why |
| `blocker` | Exact infrastructure failure, or `none` |

## Verdict

Before PASS, exercise the refusal cases on separate fixture-owned review paths: a moved base or digest mismatch must abort before creating a review worktree/branch; a corrupt patch with its matching digest must abort at applicability checking without creating a reconstruction commit. A wrong expected tree must also refuse before commit, preserving the staged review checkout for inspection. Record exit statuses, refs, and preserved artifacts for each case.

PASS requires every evidence field populated from actual live execution, every refusal boundary above honored, and final validation plus fresh review on the exact candidate tree, checking integration effects and verifying correspondence to prior review evidence without reopening settled findings. Missing native prerequisites produce **BLOCKED** with the exact error; a failed required assertion produces **FAIL**. A supervised approval pause is **AWAITING APPROVAL**. None is PASS or permission for a fallback run. This fixture's live status remains **PENDING** until executed and its evidence recorded.

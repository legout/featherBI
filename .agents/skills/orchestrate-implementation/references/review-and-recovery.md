# Implementation review and recovery

## Review policy

Choose one review policy per run:

- `adaptive` (default): parent diff inspection for low-risk work, one independent candidate review for normal-risk work, and immediate plus candidate review for high-risk or dependency-defining work.
- `strict`: immediate task review plus final review.
- `final-only`: one independent candidate review, with no task or wave reviews.
- `parent-only`: parent diff inspection plus focused checks; use for low-risk changes only.

Immediate-review triggers:

```text
public API/schema/shared contract; security/auth/permissions/secrets; money/data-loss/migration; concurrency/distributed behavior; broad cross-cutting diff; weak or missing checks; worker uncertainty/scope expansion; candidate-assembly conflict; a task whose contract will be consumed before the next wave review
```

Review boundaries are branch-scoped. For each mutation lane, record `laneBaseSha`, `laneHeadSha`, and `lastReviewedSha`. Review that lane's exact `lastReviewedSha..laneHeadSha` range in its managed worktree while that worktree exists; once the lane is reconstructed, review the reconstructed branch in its parent-owned review checkout. Never use the orchestrator's `HEAD` to represent unintegrated parallel lanes. After a clean verdict with no unresolved material criterion or owner decision, advance only that lane's `lastReviewedSha`. For fixes, retain the prior materialized review ref/SHA and compare the two endpoints directly, even when they are sibling reconstructions.

At a wave boundary, independently review only high-risk lanes and dependency-defining contracts needed by the next wave. For normal-risk lanes, defer review until the candidate is assembled; for low-risk lanes, the parent inspects the exact candidate diff. Send all accepted blockers for one lane in one batch to one fix worker. After accepted commits are assembled on an explicit candidate branch, record `candidateBaseSha` and `candidateHeadSha` and apply the selected candidate review once. Verify correspondence to prior reviewed code; candidate review covers previously unreviewed changes and integration effects, not a fresh hunt through settled findings. Strict review adds boundaries, not repeated review of unchanged code. No boundary advances solely on inspection of another branch, and candidate assembly never resets a finding's correction budget.

## Execution loop

1. Read source artifacts.
2. Preflight constraints, dependencies, conflicts, and repository state; classify each task's risk and assign its test obligation.
3. Consult configured persistent peers when useful.
4. Create the manifest, briefs, lane board, and gates; record the review policy and each lane's initial `laneBaseSha` and `lastReviewedSha`.
5. Run fresh scouts for load-bearing context.
6. Dispatch workers in safe serial or parallel waves with their validation-unit test obligations.
7. Run the validation unit's focused check once on the tree being accepted; do not repeat equivalent validation on both worker and reconstructed trees unless reconstruction itself is in doubt.
8. Record each completed lane's `laneHeadSha`; immediately review only high-risk or dependency-defining ranges.
9. At a dependency boundary, review only the contract the next task will consume. Apply disposition before any repair; batch accepted small in-scope blockers for one lane into one fix pass.
10. Only the parent dispatches the fix and recheck. Use the same writer when its managed worktree exists and the child is resumable; otherwise use a fresh managed fix worker from the exact original base with the prior full patch replayed. Run affected focused checks and one fresh delta-only recheck with the inline dispatch contract. Surviving or new material blockers stop for the human; do not dispatch another fix automatically.
11. After every candidate lane is clean, assemble accepted commits according to mode on an explicit candidate branch and record its base and head.
12. Apply the selected candidate policy to the exact candidate range: parent inspection for low risk, one fresh independent review for normal risk, or fresh final review for high risk.
13. Run required repository CI plus only the focused acceptance commands tied to named failure modes; do not automatically run every available typecheck, lint, and test command.
14. Keep push, PR merge, deploy, and release behind separate authority gates.

One fix pass, one delta recheck is the limit, not a renewable default. No third round. If the same finding survives an honest fix, stop: the finding or fix is wrong. Any unresolved material blocker or unverified security criterion requires a human decision, not another full review, a renamed lane, or an automatic repair loop. A changed scope needs explicit owner approval. Never loop for optional polish.

## Findings and recovery

### Disposition before repair

The parent evaluates every finding against the exact reviewed head and approved task **before touching code or dispatching a fix**. Reviewer urgency never outranks requirements. Require all five: named violated requirement/written rule, change-caused or worsened problem, real reachability, material impact, and proportionate response. Written convention violations remain must-fix; taste does not become convention. Security and test demands additionally pass the inline reviewer contract's realism/scenario gates.

- **Reject** stale, invalid, speculative, taste-only, or otherwise failed gates in one line with the reason. No repair is owed.
- **Fix** gate-passing findings with small in-scope repairs; batch them into the single authorized fix pass and revalidate.
- **Hand back** gate-passing findings whose proper repair is large or outside approved scope, with one sentence explaining the owner decision. Do not silently accept the defect or list a large redesign as an automatic fix-first item.
- **Ask** when a material criterion is unverified, including genuinely security-sensitive work with missing facts. A reviewer `pass` does not clear this acceptance gate.

Pre-existing/out-of-scope observations get at most one non-blocking line. Reviewers end with `pass` or `fix-first` and stop once agreed criteria, actual risks, and written rules are covered; zero findings is a successful review. No extra evidence ledger or sign-off artifact: use the existing report.

Treat `needs_attention` as a control signal, not proof of failure. Preserve stopped or failed worktrees and artifacts until ownership is clear. Do not launch a replacement while the original writer may still own the seam. Inspect exact head and focused logs before classifying a failed gate.

A completed child's managed worktree may be removed automatically before a later resume. Child cwd or session survival is never the recovery boundary; the pinned named base, durable handoff patch, digest, and registered parent-owned reconstruction are. If the managed worktree still exists and the child is resumable, resume the same writer only after verifying both runtime resumability and worktree ownership. Otherwise:

1. Verify that the named base still resolves to its recorded SHA. If it moved, stop and preserve the handoff for an owner decision; never fall back to current `HEAD`.
2. Create a registered parent-owned review worktree outside extension auto-discovery and the active source checkout at the verified named base.
3. Verify the patch identity/digest, then run `git apply --check` and `git apply --index`. Do not use fuzzy application or omit files. Compare the reconstructed staged tree with the worker-reported clean tree; reports are supporting evidence, not acceptance.
4. Commit the initial reconstruction, run focused checks on that exact tree, and apply the selected review policy to the exact base/head range. For a replacement after review, use step 5's delta recheck instead. Advance `lastReviewedSha` only after the required review or parent inspection.
5. For the one accepted fix pass, preserve the prior materialized review ref/SHA, allocate a fresh managed worker from the same verified named base, replay the prior full patch, and apply only parent-accepted findings. Reconstruct the new full patch on a distinct review branch and verify its entire staged tree as above. Re-review only `priorReviewSha..replacementReviewSha` and the behavior those fixes address, using a direct two-endpoint diff rather than merge-base/triple-dot. The full transport patch is not the re-review range. Missing prior review evidence stops for the owner, never resets to a full review. Advance `lastReviewedSha` only after the recheck passes.

Preserve failed or uncertain artifacts and owned refs. Delete them only after all consumers are terminal and cleanup is explicitly authorized.

Escalate product, architecture, credential, merge, release, and publication choices instead of guessing.

## Completion evidence

Before accepting a run, verify:

- final diff contains only intended files;
- focused validation covers changed behavior per its assigned obligation;
- high-risk and dependency-defining lane ranges received their required review, and the exact candidate range received the selected review or parent inspection before target integration or publication;
- accepted findings were fixed and revalidated;
- every lane is terminal or blocked with a named next action;
- handoffs are durable before worktree cleanup; and
- skipped validation and residual risks are explicit.

After each task, restate the approved task in one sentence, compare the result, and choose `accept / fix / hand back / ask`. `fix` is subject to the existing correction limit, not permission to restart it. Extra ideas get one written line, not code. Reviewer reports, CI checks, and receipts are evidence, not publication authority.

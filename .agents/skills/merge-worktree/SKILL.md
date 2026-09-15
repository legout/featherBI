---
name: merge-worktree
description: Integrate a completed Git worktree into a target branch locally, or create and optionally merge a GitHub pull request with separate authorization. Use when the user asks to merge, integrate, land, or clean up worktree changes.
compatibility: Requires git; GitHub PR mode also requires an authenticated gh CLI.
---

# Merge Worktree

> Branch-finishing safety patterns are adapted from the MIT-licensed [`finishing-a-development-branch`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/finishing-a-development-branch/SKILL.md) workflow. Exact pin and relationship are recorded in `sources.json`.

Integrate one registered Git worktree with a merge commit. This skill owns integration and worktree cleanup; implementation workflows must hand off to it rather than merging for themselves.

## Resolve Authorization

Determine these inputs from the request and repository:

- source worktree path and branch;
- target branch and the base from which the work forked;
- integration mode: local or GitHub PR;
- for PR mode, action: **open only** or **merge after checks**; and
- cleanup choice: enabled only by an explicit `--clean-up` request, otherwise ask after successful integration.

Use the repository default branch only when unambiguous. If authorization is incomplete, offer: merge locally, open a PR without merging, open and merge a PR after checks, or keep the branch unchanged. Opening a PR never authorizes merging it. A local merge never authorizes a push.

## Candidate handoff from orchestrate-implementation

When the source is an orchestrator candidate, accept only a registered parent-owned candidate worktree and branch. The handoff must name the pinned candidate base/head, exact reviewed range, assembled lane commits, focused validation, fresh candidate review evidence, and authorization state. Do not substitute a deleted worker path, the target branch's current `HEAD`, or a worker-reported SHA for the candidate tree. A candidate handoff does not grant push, PR merge, deploy, or release authority.

## Preflight

1. Run `git worktree list --porcelain`. Require the source to be a registered worktree on a non-detached branch.
2. Verify source and target are distinct branches in the same repository and no merge, rebase, or cherry-pick is already in progress.
3. Require the source to contain at least one commit not reachable from the target. If it is already integrated, report that and skip the merge.
4. Locate any worktree where the target is checked out. Require it to be clean before updating it.
5. Inspect the source diff and commits. Stop for unrelated changes, suspected secrets, or unclear ownership.
6. Read repository instructions and run the smallest relevant validation from the source worktree.
7. If the source has intended uncommitted changes, stage only those files and create a concise commit. Do not amend existing commits unless requested.
8. For PR mode, fetch the selected remote with pruning and stop on authentication failure or ambiguous/diverged target state. For local mode, fetch only if the user asked to integrate against a remote-tracking target.

Never force-push or guess a target branch.

## Local Integration

Keep the target reference unchanged until the candidate merge passes:

1. Record the current target SHA.
2. Create a temporary integration branch and registered sibling worktree at that SHA.
3. In the integration worktree, run `git merge --no-ff <source-branch>` with a concise message.
4. If conflicts occur, trace both sides to their intent and resolve each file deliberately. Do not choose `ours` or `theirs` wholesale. Regenerate conflicted generated files with their owning tool instead of hand-editing them.
5. Run relevant checks and require the integration worktree to be clean and conflict-free.
6. Reconfirm the target still equals the recorded SHA. If it moved, stop with the validated integration worktree intact.
7. Fast-forward the target to the validated integration commit. If the target is checked out, update it in that clean worktree. Otherwise update the branch reference only when its old value still matches the recorded SHA.
8. Verify the target now names the integration commit.
9. Remove the temporary worktree with `git worktree remove`, delete only its known ephemeral branch, and run `git worktree prune`.

Do not push in local mode. Never use `rm -rf`, forced worktree removal, or a force update for integration cleanup.

## GitHub PR Integration

Run `gh --help` and the relevant `gh pr` help before relying on fast-moving syntax. Then:

1. Verify `gh auth status`, the selected GitHub remote, and the current target branch.
2. Push the source branch normally with upstream tracking.
3. Reuse its open PR or create one targeting the selected branch. Derive title and body from the commits and validation evidence.
4. Report the PR URL.

For **open only**, stop here. Do not wait for checks indefinitely, merge, enable auto-merge, or clean up the source worktree.

For **merge after checks**, require that action to have been explicitly authorized, then:

1. If GitHub reports conflicts, merge the current target into the source locally with `--no-ff`, resolve deliberately, rerun validation, and push normally.
2. Watch required checks. Stop if they fail or time out; never bypass branch protection.
3. Merge with the repository's allowed merge-commit mechanism. If policy requires a queue or auto-merge, use that policy rather than bypassing it.
4. Verify the PR is merged and the remote target contains the resulting commit before cleanup.

## Source Worktree Cleanup

Only after successful local integration or a verified merged PR:

- With an explicit `--clean-up` request, remove the source worktree.
- Otherwise ask whether to remove it.
- Verify it is clean and its commit is reachable from the integrated target.
- Run `git worktree remove <path>` followed by `git worktree prune`.
- Do not delete local or remote branches unless separately requested.

If the user asks to discard work, first show the branch, path, uncommitted files, and commits that would become unreachable. Require the exact confirmation `discard` before deleting unique work. Never force-remove a dirty worktree to hide it.

## Report

Report the authorization received, mode, source, target, merge commit or PR URL, checks run, whether anything was pushed or merged remotely, and whether either worktree was removed. If stopped, name the failing gate and preserve recoverable state.

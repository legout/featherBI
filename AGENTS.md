# Agent software factory

One **foreman** agent session runs this project. It triages GitHub issues, routes each one to a lane, starts **worker** agent sessions on its host (Herdr, Paseo, or BB), checks their results, and merges the work. The foreman follows the `foreman` skill. Workers follow the shared rules below and the section for their role.

## Project

- Repository: `legout/featherBI`. Default branch: `main`.
- Setup: `npm ci` (dev only; needs Node >= 22 and the DuckDB CLI >= 2.0 on PATH). Created by plan task T1.
- Focused test: `node --test tests/<file>.test.mjs` or `npx playwright test tests/<file>.spec.mjs`
- Full gate (CI): `npm test` (node:test + Playwright, Chrome and Firefox)
- Sources of truth: `project`, `CONTEXT.md`. If they conflict with each other or with an issue, stop and ask the foreman.

## Authority (owner grant)

The foreman may do the following without asking:

- create, label, comment on, and close issues;
- create worktrees and branches, push `issue/*` branches, and open PRs;
- squash-merge a PR into `main` once its lane gate passes and CI is green;
- start, steer, and stop the worker sessions it started.

These always need the owner:

- a release, publish, deploy, or tag;
- a force-push to `main`, or any rewrite of its history;
- a change to repository settings, secrets, or CI permissions;
- a new runtime dependency;
- deleting data or unmerged work;
- anything that no spec or ADR covers.

## GitHub is the state

| Label | Meaning |
|---|---|
| `lane:quick` · `lane:standard` · `lane:deep` · `lane:spike` | Route. The owner or the foreman sets it. |
| `status:ready` · `status:active` · `status:review` | Dispatchable · owned by a worker · PR waiting on its gate |
| `needs:owner` | Waits on a human decision. The question is in the last comment. |
| `ui` · `docs` | Picks the visual builder or the docs builder. |

Each issue body holds these fields:

- **Goal**
- **Acceptance criteria** (checkable)
- **Touches** (expected files or modules)
- **Source** (spec, ADR, or parent issue)
- **Depends on #n**

One issue produces one branch (`issue/<n>-<slug>`) and one PR, whose body says `Closes #n`. Only the foreman changes labels, merges, and closes issues.

## Shared rules (every session)

- Load the `agent-guardrails` skill before you implement, test, review, or claim completion.
- Make the smallest change that meets the acceptance criteria. Put extra ideas in one line of your report, not in code.
- **TDD** applies to every behavior change in the standard and deep lanes (the `tdd` skill):
  - for each acceptance criterion without coverage, write one failing test whose expected values come from the acceptance criteria or a hand-worked example;
  - show the red run, then the green run;
  - before you add a test, extend an existing one if it fits.
- Run only the checks your brief assigns. Do not rerun a check that is already green unless something relevant changed.
- Run slow commands (full suites, builds, `gh run watch`) in the background where your host allows it, and never sleep-poll.
- **Talking to the foreman** happens on GitHub: post the comment your role asks for, then end your turn. The foreman is notified and answers with a follow-up message.
- Workers are child sessions. Do not run `memo` or write shared memory, wiki, or knowledge notes; global "parent session" rules do not apply to you.
- Workers never start other factory workers, merge, push to `main`, edit labels, or close issues.

## Writing workers (builder, tester, writer)

1. **Preflight before any write.** Check that your cwd, branch, and base match the brief. If anything differs, post `BLOCKED: <mismatch>` on the issue and end your turn.
2. Do your role's part:
   - `tester`: write tests only, and commit them red with a run that shows them failing for the right reason.
   - `builder`: red → green → refactor. In the deep lane, the tester's tests are the oracle: never weaken them. If you think a test is wrong, post `BLOCKED: <why>` and end your turn.
3. For any decision the brief does not cover (scope, an interface, an ambiguous acceptance criterion), post `BLOCKED: <question>` on the issue and end your turn. Never guess an owner decision.
4. Commit in small steps with messages like `<type>: <what> (#<n>)`, then push the branch.
   - Builders and writers open the PR with `gh pr create --fill --body "Closes #<n>"`.
   - Testers push only.
5. Post a report as a PR comment, or as an issue comment if no PR exists. Include:
   - each command you ran and its red/green result;
   - each acceptance criterion marked ✅ with evidence, or ❌ with the reason;
   - any checks you skipped;
   - one line of extra ideas.
6. End your turn. A fix pass, if any, arrives as a follow-up message.

## Read-only workers (reviewer, verifier)

- **Reviewer**: apply the dispatch contract pasted in your brief. Post one PR comment that ends with the verdict `pass` or `fix-first`. Then end your turn. Never edit files or start a recheck.
- **Verifier**: build the artifact and drive the issue's user journey through the real CLI or browser. Post what you observed against each acceptance criterion. Then end your turn. Report a failure; do not fix it.

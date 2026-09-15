---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

> Adapted from [`obra/superpowers`](https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/verification-before-completion) at commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT).
>
> Same-surface proof discipline is adapted from Cursor's [`poteto-mode`](https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/poteto-mode) at commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99` (MIT, Copyright (c) 2026 Cursor).

# Verification before completion

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before a success claim, commit, or PR:

1. Identify the command or observation that proves each claim, exercised on the same surface the claim names.
2. Run that complete focused check now. Add no test or command without a named reachable scenario; coverage percentage and duplicate evidence are not goals. Required project checks still apply.
3. Read its full relevant output and check exit status and failure counts.
4. Inspect the VCS diff for delegated or file-changing work.
5. Restate the approved task in one sentence, compare the result against its requirements and written conventions, and choose `accept / fix / hand back / ask`. Extra ideas get one line, not code. Disposition reviewer findings before repairing: reject failed gates, fix small in-scope violations, hand large/out-of-scope work to the human. One fix pass and one delta recheck; unresolved findings go to the human rather than another round.
6. Report the actual result with evidence. If a check fails or was not run, say so.

Evidence must match the claim's surface: compilation proves compilation, and a unit test proves only the behavior it exercises. Match examples to their claim — rendered UI for UI claims, a built or installed CLI for CLI claims, a restart-and-read for persistence claims, and transformed data plus stale-path checks for migration claims. Tests do not prove a build, lint does not prove types, code changes do not prove a bug is fixed, and an agent report does not prove its work. A regression test is credible only after the intended red/green behavior is observed when practical.

Never weaken assertions, skip failing checks, rely on an old run, or use “should”, “probably”, or “seems” as a substitute for evidence.

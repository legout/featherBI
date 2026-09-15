---
name: systematic-debugging
description: Diagnose bugs, test failures, build failures, performance regressions, and unexpected behavior by building a repro, tracing evidence, testing hypotheses, and fixing the root cause.
---

# Systematic Debugging

> Consolidates Matt Pocock's [`diagnosing-bugs`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/diagnosing-bugs/SKILL.md) feedback-loop method with Obra's [`systematic-debugging`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/SKILL.md), [`root-cause-tracing`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/root-cause-tracing.md), and [`condition-based-waiting`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/condition-based-waiting.md) guidance (all MIT). Exact pins are recorded in `sources.json`.
>
> Evidence-traced fixes, speculative-guard rejection, and measured baselines are adapted from Cursor's [`poteto-mode`](https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/poteto-mode) at commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99` (MIT, Copyright (c) 2026 Cursor).

**No fix before reproducible evidence and root-cause investigation.**

Redact secrets from commands, logs, traces, screenshots, and reports. Keep credentials in environment variables.

## 1. Build a tight feedback loop

Create one command that exercises the user's exact symptom and can turn red on the bug and green on a fix. Prefer, in order:

1. focused failing test;
2. HTTP/CLI script with a fixture;
3. browser automation assertion;
4. captured-request or trace replay;
5. minimal throwaway harness;
6. fuzz, differential, or automated bisection loop; or
7. as a last resort, a human-in-the-loop bash script — drive the human with `scripts/hitl-loop.template.sh` so the loop stays structured.

Run it. Tighten speed, determinism, and specificity. For flaky bugs, increase reproduction rate with repetition, controlled concurrency, seeded randomness, or timing instrumentation.

If no runnable loop is possible, stop and list attempted probes plus the exact artifact or access needed. Do not substitute guesses.

## 2. Reproduce and minimize

Confirm the observed failure is the reported symptom. Remove inputs, callers, configuration, and steps one at a time while keeping the loop red. The remaining elements should be load-bearing.

Check complete errors, stack traces, recent changes, environment differences, and similar working code.

## 3. Trace the cause

Follow bad state backward across calls and component boundaries until its origin is known. At each boundary compare expected and observed input, output, configuration, and state.

For performance, establish a numeric baseline and use a profiler, query plan, or timing harness rather than broad logging. Re-run the same measurement after each change and report both numbers; a performance claim without a baseline and an after-measurement is a guess.

## 4. Rank and test hypotheses

Write 3–5 plausible hypotheses when the space is uncertain. Each must predict an observable result: “If X causes this, changing Y will produce Z.” Rank by evidence and cost.

Test one variable at a time with the smallest probe. Prefer debugger/REPL inspection, then narrowly tagged logs such as `[DEBUG-a4f2]`. A failed probe updates the ranking; it does not justify stacking another speculative fix. Every shipped line must trace to observed evidence: a guard that might help is a hypothesis, not a fix, and does not ship. When evidence refutes a hypothesis, revert the production changes and instrumentation motivated only by that disproven hypothesis.

After three failed fix attempts, stop and question the architecture with the user.

## 5. Fix at the correct seam

When a correct test seam exists:

1. convert the minimized repro into a failing regression test;
2. observe the intended failure;
3. make one minimal root-cause fix;
4. observe the regression test pass; and
5. rerun the original unminimized loop.

If no honest test seam exists, record that architectural limitation rather than adding a shallow test that cannot catch the bug.

## 6. Clean and verify

- rerun original repro and regression/relevant suite;
- remove every tagged debug statement and throwaway artifact;
- state the root cause and why the fix addresses it;
- record residual uncertainty; and
- invoke `verification-before-completion` before claiming success.

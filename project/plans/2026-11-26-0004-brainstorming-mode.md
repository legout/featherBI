# Plan 0004: brainstorming mode, richer profile, domain playbooks and four presets

Status: **approved** by the owner on 2026-11-26 ("ok", together with the issue table). Source: [spec 0004 revision 1](../specs/2026-11-26-0004-brainstorming-mode.md), approved by the owner on 2026-11-26 ("genehmigt"), whole spec.
Architecture: [ADR 0001](../adr/0001-dashboard-stack.md), [ADR 0002](../adr/0002-repository-is-the-skill.md). Vocabulary: add **brainstorming mode** and **domain playbook** to [CONTEXT.md](../../CONTEXT.md) in BR2.
Contract: planning-contract v1. Installed provenance: legout/skills (installed copy, exact revision unknown).
Capture checkpoint (from the spec): two new terms; no new ADR; open: model reliability (acceptance 4 is the check), CI time for 20 examples (measured in BR3), public datasets deferred.

## Goal

The skill explores unknown data with the user (profile → domain guess → interview → three ideas → build), backed by a richer `profile`, 20 domain playbooks with generated examples, and four new presets. Spec 0004 acceptance 1–5 must hold.

## Constraints for sequencing

- **Presets before playbooks:** playbooks reference presets by name, so the four new presets (BR1) land before any playbook that uses them.
- **Mode before domains:** BR2 fixes the playbook format, the domains index and the mode instructions; BR3–BR6 fill domains in that format only.
- **Domains in four waves, one issue each**, in the spec's grouping. Each wave owns its own files (`references/domains/<domain>.md`, `examples/<domain>/`) plus one row per domain in `references/domains.md`; waves touch that index only by appending rows, so they may run in parallel after BR2.
- **Examples:** generated data only (DuckDB `make.sql`, deterministic, no network); Parquet git-ignored; one shared test file `tests/examples.spec.mjs` added in BR3 that discovers `examples/*/` and checks each README's figures, so later waves add no test code. If BR3 measures the CI time per example above ~20 s per browser, the page check runs in Chromium only (decision recorded in BR3's PR).
- **Non-goals** (spec): no invented data or figures, no ML/forecasting, no maps, no public datasets, no changes to the existing 17 presets.

## Requirement → task map

| Spec 0004 item | Task |
|---|---|
| `pareto`, `histogram`, `candlestick`, `timeline` presets (+ build-time column checks, `presets.md`) | BR1 |
| Richer `profile` (`nulls`, `distinct`, `min`/`max`, `top`, `step`, sampling) | BR2a |
| Brainstorming flow in `SKILL.md` + `references/brainstorm.md`; playbook format; `references/domains.md` index; skip rule | BR2 |
| Industry playbooks + examples (5) | BR3 |
| Commerce playbooks + examples (3) | BR4 |
| Finance + environment playbooks + examples (4) | BR5 |
| Vehicle + operations playbooks + examples (8) | BR6 |
| Acceptance 1–3, 5 (automated) and 4 (manual, owner) | BR7 |

## Tasks

### BR1: Four new presets

- **Files:** `skill/featherbi/assets/presets/{pareto,histogram,candlestick,timeline}.json`, `skill/featherbi/assets/renderer.js` (new `BIND` helpers where a preset needs derived data: `@pareto` sorted rows with cumulative share, `@timeline` bars from start/end), `skill/featherbi/references/presets.md` (four rows + the histogram bin recipe), `fixtures/hand/presets.yaml` + `fixtures/hand/README.md` (four tiles with hand-computed expectations), `tests/presets.spec.mjs` (extend).
- **Behavior:** spec 0004 §Four new presets. Column checks reuse the existing preset contract in `scripts/lib/validate.mjs` (no code change expected; the preset JSON declares `columns`/`optional`/`click`).
- **Validation (normal risk):** `new-test`, extend `tests/presets.spec.mjs` (Chrome + Firefox). Oracles from hand-made rows in the README: Pareto cumulative series ends at 100 and its bars are in descending order; histogram bars share edges (`hi` of one = `lo` of the next) on a value axis; candlestick: a row with `close > open` drawn in the theme's success colour; timeline: one bar per row spanning its `start`..`end`. Extend `tests/validate.test.mjs` with one missing-column rejection per new preset. Focused cmd: `npx playwright test tests/presets.spec.mjs --workers=1 && node --test tests/validate.test.mjs`.
- **Done:** green; CI green.

### BR2a: Richer profile

- **Files:** `skill/featherbi/scripts/lib/sources.mjs` (`profile`), `tests/sources.test.mjs` (extend), `skill/featherbi/references/sources.md` (output fields).
- **Behavior:** spec 0004 §Richer profile; existing fields unchanged. Sampling: above 5 000 000 rows the per-column statistics use `USING SAMPLE 1000000 ROWS (reservoir, 42)` (fixed seed, so repeatable); `count` stays exact.
- **Validation (normal risk):** `new-test`, extend `tests/sources.test.mjs`. Oracle: spec 0004 acceptance 1 values for the hand fixture (hand-checked against `fixtures/hand/README.md`); a generated 6 M-row source → `sampled: true`, exact `count` 6 000 000. Focused cmd: `node --test tests/sources.test.mjs`.
- **Done:** green; CI green.

### BR2: Brainstorming mode and playbook format

- **Prerequisites:** BR1, BR2a.
- **Files:** `skill/featherbi/SKILL.md` (mode trigger and the five steps, one short section), `skill/featherbi/references/brainstorm.md` (detailed flow, question rules, the proposal format, the skip rule, "never invent data"), `skill/featherbi/references/domains.md` (index table: domain → detection signals → playbook file; empty rows not allowed, it starts with the template only), `skill/featherbi/references/domains/_template.md` (the five sections), `CONTEXT.md` (two terms).
- **Validation (low risk):** `no-new-test` (instructions). skill-diet link check; `SKILL.md` stays under its current size budget plus one section (report the byte count). Acceptance 4/5 are checked manually in BR7.
- **Done:** links ok; merged.

### BR3–BR6: Domain waves

Each wave is one issue with the same shape; the waves differ only in their domains.

| Task | Domains |
|---|---|
| BR3 Industry | sensor time series, end-of-line test, SPC/quality, OEE and downtime, energy/smart meter |
| BR4 Commerce | sales/e-commerce, SaaS subscriptions, web/product analytics |
| BR5 Finance & environment | stock OHLCV, accounting plan/actual, weather, air quality |
| BR6 Vehicle & operations | vehicle telematics, fleet and maintenance, logistics, support tickets, IT operations/logs, issue tracking, HR, sports/tournament results |

- **Prerequisites:** BR2 (and BR3 for BR4–BR6, which reuse BR3's `tests/examples.spec.mjs`).
- **Files per domain:** `skill/featherbi/references/domains/<domain>.md` (the five sections; every SQL recipe runs on the example's data), one row in `references/domains.md`, `examples/<domain>/{make.sql,dashboard.yaml,README.md}`; `.gitignore` (`examples/*/*.parquet`) in BR3; `tests/examples.spec.mjs` (new in BR3: for each `examples/*/`, run `make.sql`, build, open over `file://`, assert the README's listed KPI values and 0 console errors).
- **Behavior:** each example's `make.sql` is a pure function of row numbers (as `tools/gen-volume.sql`); its README lists 3–5 figures derived by hand from the generator rule, never from a query; the dashboard uses the playbook's first tile ideas, including the new presets where the playbook names them (Pareto for EOL failure codes and downtime reasons, histogram for measurements, candlestick for OHLCV, timeline for downtime and charging sessions).
- **Validation (normal risk):** `new-test` once (BR3 creates `tests/examples.spec.mjs`), later waves `existing-check` with that file. Oracle: each README's hand-derived figures. BR3 reports CI time per example and applies the Chromium-only rule from the constraints if needed. Focused cmd: `npx playwright test tests/examples.spec.mjs --workers=1`.
- **Done:** every example of the wave builds and its figures match; links ok; CI green.

### BR7: Final verification

- **Automated (verify-only, integrated `main`):** spec 0004 acceptance 1 (profile on the hand fixture and a 6 M-row source), 2 (four presets, both browsers), 3 (all 20 examples build and match in CI) — reuse the CI run at the verified SHA where it covers them, report each item with its command.
- **Manual (owner):** acceptance 4 (cold-agent run for at least three domains from different groups, fresh folder with only one example's data and the installed skill) and 5 (skip rule). The issue lists the exact steps from the cold-agent recipe used on 2026-11-25.
- **Done:** report on the epic; the automated part by a verifier, the manual part by the owner (`needs:owner` once the automated part passes).

## Validation summary

Required CI (`npm test`) runs all new tests. Residual risks: model adherence to the mode (BR7 manual), CI duration after 20 examples (measured in BR3), playbook SQL recipes beyond the example data are reviewed only by reading.

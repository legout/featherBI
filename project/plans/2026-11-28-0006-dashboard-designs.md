# Plan 0006: selectable dashboard designs and tile sizes

Status: **approved** by the owner on 2026-11-28 ("ja genau so", together with spec 0006 r1 and ADR 0004). Source: [spec 0006 revision 1](../specs/2026-11-28-0006-dashboard-designs.md), whole spec.
Architecture: [ADR 0003](../adr/0003-replaceable-page-shell.md) amended by [ADR 0004](../adr/0004-built-in-dashboard-designs.md); shell contract v1 ([references/shell.md](../../skill/featherbi/references/shell.md)).
Contract: planning-contract v1. Installed provenance: unknown.
Capture checkpoint: terms **design** and **tile size** go into CONTEXT.md in D1; ADR 0004 accepted; no blocking uncertainty.

## Goal

Spec 0006 acceptance 1–8 hold: four built-in designs selected by `design`, `classic-bi` as the new default, tile `size`, side panels that collapse on narrow screens, and the agent asking for a design in brainstorming mode.

## Constraints for sequencing

- **`assets/shell.js` and `assets/app.css` are shared write targets.** D1 → D2 run sequentially.
- **Deliberate visual change.** Spec 0005's same-page check no longer holds for the default page: D1 records the default design change as its deliberate difference. `#dashboard` JSON stays byte-identical for configs without `design`/`size`; CSS and the accessibility tree may change. Update `tests/same-page.spec.mjs` accordingly instead of deleting it: keep the JSON comparison, drop the CSS/tree comparison for the default design only.
- **CSS rebuild.** The prebuilt `app.css` is regenerated with `npm run build:css` after shell changes (no CDN Tailwind at build time, ADR 0002).
- **Shell contract.** `page.design` (string) and per-tile `size` (string) are added read-only to `page`; this is backward compatible, so the manifest stays `shell: 1`; note it in `references/shell.md` and CHANGELOG.
- **Non-goals** (spec): multi-select, brand designs, layout editing.

## Requirement → task map

| Spec 0006 | Task |
|---|---|
| §1 `design` key, default, validation, `--shell` precedence, `page.design`; §3 `size`; §4 layout behavior for `classic-bi`; acceptance 1, 3 (classic), 4 (classic), 5, 6 | D1 |
| §1 the other three designs; §2 theme override; §4 for those designs; acceptance 2, 3, 4, 7 | D2 |
| §5 agent workflow (SKILL.md, references) | D3 |
| Acceptance 1–8 on integrated main incl. 8 offline | D4 |

## Tasks

### D1: Design key, tile size and the classic-bi default

- **Files:** `skill/featherbi/scripts/lib/validate.mjs`, `skill/featherbi/schema/dashboard.schema.json`, `skill/featherbi/scripts/lib/config.mjs`, `skill/featherbi/scripts/lib/render.mjs` (`page.design`, tile `size` in the page data), `skill/featherbi/assets/shell.js` (design dispatch; `classic-bi` layout: header, left section rail when sections exist, central canvas with size-mapped grid spans, right filter/context panel, narrow-screen disclosure), `skill/featherbi/assets/app.css` (rebuilt), `tools/app.css` if needed, `skill/featherbi/references/config.md`, `skill/featherbi/references/shell.md`, `CONTEXT.md`, `CHANGELOG.md`, `tests/design.spec.mjs` (new), `tests/validate.test.mjs`, `tests/same-page.spec.mjs` and existing browser tests whose selectors depended on old layout, without weakening their behavioral assertions.
- **Behavior:** spec §1, §3, §4 for `classic-bi`.
- **Validation (normal risk, public contract):** `new-test`. Oracle: spec acceptance 1, 3, 5, 6 with hand README values. Focused: `node --test tests/validate.test.mjs && npx playwright test tests/design.spec.mjs tests/shell.spec.mjs tests/sections.spec.mjs tests/same-page.spec.mjs --workers=1`. Reviewer on the shell contract change and visual hierarchy (impeccable craft floor).
- **Done:** green; review pass; CI green.

### D2: Market desk, timetable board and visible grid

- **Prerequisite:** D1.
- **Files:** `skill/featherbi/assets/shell.js` (three designs), `skill/featherbi/assets/app.css` (rebuilt), `tests/design.spec.mjs` (extend), `skill/featherbi/references/config.md`.
- **Behavior:** spec §1, §2, §4 for the three designs.
- **Validation (normal risk):** extend `tests/design.spec.mjs` with acceptance 2, 3, 4, 7 per design in Chromium and Firefox. Focused: `npx playwright test tests/design.spec.mjs --workers=1`. Reviewer on visual distinctness and standard controls.
- **Done:** green; review pass; CI green.

### D3: Agent workflow

- **Prerequisite:** D1 (D2 may run in parallel only if it does not touch these files).
- **Files:** `skill/featherbi/SKILL.md` (one line), `skill/featherbi/references/brainstorm.md` (design question with `classic-bi` default; size guidance).
- **Validation (low risk):** `no-new-test`; skill-diet link check.
- **Done:** links ok; merged.

### D4: Final verification (verify-only)

- **Journeys:** spec 0006 acceptance 1–8 on integrated main, Chrome and Firefox, `file://`, 8 with `--offline` and network blocked; screenshots at 1440×900 and 390×844 per design reviewed against the impeccable craft floor.
- **Done:** report on the epic; no PR.

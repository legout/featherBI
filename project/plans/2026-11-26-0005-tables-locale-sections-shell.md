# Plan 0005: SQL tables, locale, KPI notes, header line, sections and a replaceable page shell

Status: **approved** by the owner on 2026-11-26 (together with spec 0005 r2, ADR 0003 and the issue table). Source: [spec 0005 revision 2](../specs/2026-11-26-0005-tables-locale-sections-shell.md), whole spec; §6 after the spike SP1.
Architecture: [ADR 0001](../adr/0001-dashboard-stack.md) (amended by ADR 0003), [ADR 0002](../adr/0002-repository-is-the-skill.md), [ADR 0003](../adr/0003-replaceable-page-shell.md). Vocabulary: **section**, **layout**, **shell**, **header line** go into [CONTEXT.md](../../CONTEXT.md) in the task that introduces each.
Contract: planning-contract v1. Installed provenance: legout/skills (installed copy, exact revision unknown).
Capture checkpoint (from the spec): four terms; ADR 0003 accepted; open uncertainty: Web Components under `file://` / `--offline` (SP1), the exact shell function list (fixed in C5).

## Goal

Spec 0005 acceptance 1–10 hold: SQL table tiles, locale-aware formats, KPI notes, a header line, sections or tabs, and a versioned, replaceable page shell whose default renders the same page as today.

## Constraints for sequencing

- **`assets/renderer.js` is the shared write target** of this plan, of plan 0004 BR1 (#110) and of plan 0003 TH1 (#107). Order: #110 → #107 → C1 → C2 → C3 → C4 → C5. No two of them run at the same time.
- **Shell last.** C5 moves all page chrome into `assets/shell.js`, including what TH1 (logo), C3 (header line), C4 (tabs) and spec 0002 (remote "Data available until" and expiry alerts) add. Doing it last fixes the shell function list once, from the final chrome.
- **"Same rendered page" check (spec 0005 acceptance 1):** one shared helper `tests/same-page.mjs` (created in C1): build a fixture from a reference checkout and from the working tree, compare the `#dashboard` JSON and the CSS byte for byte (the default colour values changed for 4.5:1 contrast per #108 are an allowed difference, see plan 0003), and compare the Playwright `locator.ariaSnapshot()` of `header` and `main` after load in Chromium. The reference build comes from a `git worktree` of the task's base commit, never from the new code. Each task lists its deliberate differences; the helper accepts an explicit list of locators to exclude.
- **Table number format (spec §2, r2) changes existing table output** (`100` → `100.00`). C2 makes that change, records it as its deliberate difference, and updates the existing assertions that read table numbers.
- **Validation lives in `scripts/lib/validate.mjs`** for every new key, like the existing rules; error texts follow spec §1/§2/§5.
- **Non-goals** (spec): brush, multi-select, runtime data loading, SQL-side paging of `sql` tables, per-column formats, CSV export, a shell key in the config, nested sections, UI string translation.

## Requirement → task map

| Spec 0005 item | Task |
|---|---|
| §1 table with `sql`, 1 000-row cap, row `click`, rejections; acceptance 2, 3, 10 (§1) | C1 |
| §2 `locale`, `format` (percent, object form), table cell formats, dates, rejections; acceptance 4, 10 (§2) | C2 |
| §3 KPI `note`; §4 header line, `subtitle`, `source_label`; acceptance 5, 6 | C3 |
| §5 `sections`, `layout: stack \| tabs`, lazy tab queries, `tab=` hash, keyboard, reserved `tab`, rejections; acceptance 7, 8, 10 (§5) | C4 |
| Uncertainty for §6: Web Components under `file://` and `--offline` | SP1 |
| §6 shell module, `--shell`, `references/shell.md`, test shell; acceptance 9 and acceptance 1 for the whole plan | C5 |
| Acceptance 1–10 on integrated `main` | C6 |

## Tasks

### SP1: Spike: a Web Components shell under `file://` and `--offline`

- **Question:** can a page chrome built from one Web Components library (for example Shoelace/Web Awesome or Material Web, loaded as one ESM bundle) run from a double-clicked file and from an `--offline` single file with every non-`file:` request blocked, in Chrome and Firefox? What breaks (custom-element registration from data: URLs, `import.meta.url` asset lookups, fonts/icons fetched at runtime, CSP)?
- **Method:** a throwaway page in a temp dir (not committed) with three components (select, tabs, dialog) inlined as a data-URL module, opened via Playwright from `file://` with the network blocked.
- **Output:** a research note `project/research/2026-11-26-web-components-shell-spike.md` with the observed result per browser and mode, and the constraints a shell must meet (they go into `references/shell.md` in C5). No product code.
- **Done:** note merged. If §6 cannot work as written, the foreman sets `needs:owner` on C5 and §6 returns to the spec.

### C1: SQL table tile

- **Files:** `skill/featherbi/scripts/lib/validate.mjs` (one of `source`/`sql`, no `columns` with `sql`, `click` declared, first column exists; tile SQL validated like other tiles), `skill/featherbi/schema/dashboard.schema.json` (`sql`, `click` on `table`), `skill/featherbi/assets/renderer.js` (`mountTable`: a client-side row model for `sql` tiles with `LIMIT 1001`, the title note, row click → dimension), `skill/featherbi/references/config.md` (table row), `fixtures/hand/acceptance.yaml` (one `sql` table tile titled "Revenue by region (SQL)"), `tests/same-page.mjs` (new helper), `tests/journey.spec.mjs` (extend), `tests/validate.test.mjs` (extend), `tests/same-page.spec.mjs` (new: acceptance 1 for all existing fixture configs).
- **Behavior:** spec §1. Row numbers raw in this task (formats come in C2).
- **Deliberate differences:** none for existing configs (the new tile exists only in `acceptance.yaml`, which the same-page check compares with that tile excluded).
- **Validation (normal risk):** `new-test`. Oracle: hand fixture README (EU 850, US 1410.5; Online EU 360, US 660; EU click → KPI $850.00). Row cap: a tile over `range(1001)` and `range(1000)` (generated in the test config). Rejections: one case each in `tests/validate.test.mjs`. Same page: `tests/same-page.spec.mjs` over `fixtures/hand/{dashboard,acceptance,pivot-table,presets,upstream}.yaml` and `fixtures/formats/dashboard.yaml` against the task's base commit. Focused cmd: `node --test tests/validate.test.mjs && npx playwright test tests/journey.spec.mjs tests/same-page.spec.mjs --workers=1`.
- **Done:** green; CI green.

### C2: Locale and number formats

- **Prerequisite:** C1.
- **Files:** `skill/featherbi/scripts/lib/validate.mjs` (`locale` via `Intl.NumberFormat.supportedLocalesOf`, `format` object, `decimals` 0–6, three-letter currency), `skill/featherbi/schema/dashboard.schema.json`, `skill/featherbi/assets/renderer.js` (replace the fixed `FORMATS` table with formatters built from `locale` + `format`; table cells use the column's DECIMAL scale from the Arrow type, at most 2 digits otherwise; table date column uses the locale's numeric short date when `locale` is set, ISO otherwise; chart value-axis labels and tooltips), `skill/featherbi/references/config.md` (`locale`, `format`), `tests/locale.spec.mjs` (new), `tests/validate.test.mjs` (extend), existing table-number assertions in `tests/*.spec.mjs` (update to the new format).
- **Behavior:** spec §2 r2. Without `locale`: KPI, chart and pivot output unchanged; table numbers change as spec r2 states.
- **Deliberate differences:** numeric table cells (`100` → `100.00` for DECIMAL(10,2)), listed in the same-page check's exclusions for table grids only.
- **Validation (normal risk):** `new-test`. Oracle: spec acceptance 4 values, hand-checked with Node `Intl` (`2.260,50 €`, `1.234,5 t`, `25 %`, `05.01.2025`; `en-US` `01/05/2025`), each string compared with its non-breaking spaces. Table: `850.00` / `1,410.50` (spec acceptance 2, r2). Focused cmd: `node --test tests/validate.test.mjs && npx playwright test tests/locale.spec.mjs tests/same-page.spec.mjs tests/journey.spec.mjs --workers=1`.
- **Done:** green; CI green.

### C3: KPI note and header line

- **Prerequisite:** C2.
- **Files:** `skill/featherbi/scripts/lib/validate.mjs` (`note`, `subtitle`, `source_label` ≤ 200 chars), `skill/featherbi/schema/dashboard.schema.json`, `skill/featherbi/scripts/lib/render.mjs` (embed the snapshot's min/max date of all dated tables, computed at build time), `skill/featherbi/templates/dashboard.html` (header line slot), `skill/featherbi/assets/renderer.js` (KPI note; header line formatting with `locale`), `skill/featherbi/references/config.md`, `CONTEXT.md` (**header line**), `tests/locale.spec.mjs` (extend), `tests/same-page.spec.mjs` (unchanged: configs without these keys must still match).
- **Behavior:** spec §3, §4. Source SQL, paths, hosts and bucket names never reach the page.
- **Validation (normal risk):** `new-test`. Oracle: spec acceptance 5 and 6 strings (`Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025 · Source Sales export`; `de-DE` variant); "no source path" checked by searching the HTML for `fixtures/hand` and `sales.parquet`. Focused cmd: `npx playwright test tests/locale.spec.mjs tests/same-page.spec.mjs --workers=1`.
- **Done:** green; CI green.

### C4: Sections and tabs

- **Prerequisite:** C3.
- **Files:** `skill/featherbi/scripts/lib/validate.mjs` (one of `tiles`/`sections`, `layout` only with `sections`, section title required and unique, ≥ 1 tile, ids unique across sections, `tab` reserved; errors prefixed `section "<title>", `), `skill/featherbi/schema/dashboard.schema.json`, `skill/featherbi/scripts/lib/filters.mjs` (`tab=<n>` in `serializeHash`/`parseHash`, untrusted like the rest), `skill/featherbi/assets/renderer.js` (section groups; tab list with roving focus, arrow/Home/End; closed tabs do not query; opening a tab runs its tiles for the current state, latest state wins per tab), `skill/featherbi/references/config.md`, `CONTEXT.md` (**section**, **layout**), `fixtures/hand/sections.yaml` (new: two sections), `tests/sections.spec.mjs` (new), `tests/filters.test.mjs` (extend: `tab` parsing), `tests/validate.test.mjs` (extend).
- **Behavior:** spec §5.
- **Validation (normal risk, plus review):** `new-test`. Oracle: hand README values (EU in tab 2 after selecting EU in the filter bar), spec acceptance 7 and 8; "only the first tab queried" by counting the query messages to the engine worker with the init-script wrapper `tests/journey.spec.mjs` already uses for `window.__lag` (no product hook). Hash: `#region=EU&tab=2` round trip; invalid `tab=0`, `tab=9`, `tab=x` ignored (`tests/filters.test.mjs`). Reviewer: the URL hash is untrusted input (risk trigger); the review covers `parseHash` and tab activation only. Focused cmd: `node --test tests/filters.test.mjs tests/validate.test.mjs && npx playwright test tests/sections.spec.mjs tests/same-page.spec.mjs --workers=1`.
- **Done:** green; review pass; CI green.

### C5: Replaceable page shell

- **Prerequisites:** C4, SP1 (and its constraints).
- **Files:** `skill/featherbi/assets/shell.js` (new: default shell, all chrome creation moved from `renderer.js` and `templates/dashboard.html`: header, logo, header line, theme toggle, Explore button and dialog, filter bar, chips, Reset, sections/tabs container, tile card with busy/error state, KPI card, table host, remote progress/expiry/alerts), `skill/featherbi/assets/renderer.js` (calls only the shell contract; no selector queries into shell markup), `skill/featherbi/templates/dashboard.html` (minimal frame), `skill/featherbi/scripts/lib/render.mjs` (inline the shell; `--shell <file>` read, `shell: 1` declared or the build fails), `skill/featherbi/scripts/featherbi.mjs` (flag), `skill/featherbi/scripts/lib/assets.mjs` (offline inlining of the chosen shell), `skill/featherbi/references/shell.md` (contract v1: each function, arguments, return value, callbacks; SP1 constraints), `CONTEXT.md` (**shell**), `tests/fixtures/plain-shell.js` (new: plain `<div>` test shell), `tests/shell.spec.mjs` (new), `CHANGELOG.md`.
- **Interface produced:** shell contract `shell: 1` as documented in `references/shell.md`.
- **Behavior:** spec §6; ADR 0003.
- **Validation (high risk: public contract):** `new-test`.
  - Same page (acceptance 1): `tests/same-page.spec.mjs` over every fixture config including `sections.yaml`, against the base commit of this task; no deliberate differences.
  - Test shell (acceptance 9): `build --shell tests/fixtures/plain-shell.js` of the hand fixture: KPI values of spec 0001 acceptance 1, a click filter, the date filter and Explore work; a shell file without `shell: 1` fails the build; `--offline --shell …` inlines the shell (network blocked).
  - Reviewer: contract review against ADR 0003 (renderer never queries shell markup; every chrome element goes through the contract; versioning rule) and `references/shell.md` completeness. One fix pass, one delta recheck.
  - Focused cmd: `npx playwright test tests/same-page.spec.mjs tests/shell.spec.mjs --workers=1`.
- **Done:** green; review pass; CI green.

### C6: Final verification (verify-only)

- **Journeys:** spec 0005 acceptance 1–10 on the integrated `main`, Chrome and Firefox, `file://`; acceptance 9 also with `--offline`. Reuse the CI run at the verified SHA where it covers an item; report each item pass/fail with commands.
- **Done:** report on the epic; no PR.

## Validation summary

Required CI (`npm test`) runs every new test. Residual risks: derived Web Components shells beyond SP1's three components are not tested here (ADR 0003: their responsibility); the accessibility-tree comparison covers `header` and `main`, not canvas pixels.

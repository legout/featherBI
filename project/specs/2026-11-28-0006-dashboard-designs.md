# Spec 0006: selectable dashboard designs and tile sizes

Status: **approved**, revision 1 (owner, 2026-11-28, "approved" in the foreman session).
Builds on: [spec 0001](2026-11-24-0001-featherbi-v1.md), [spec 0003](2026-11-26-0003-themes.md), [spec 0005](2026-11-26-0005-tables-locale-sections-shell.md) r3.
Architecture: [ADR 0003](../adr/0003-replaceable-page-shell.md), amended by proposed [ADR 0004](../adr/0004-built-in-dashboard-designs.md).
Contract: planning-contract v1.

## Goal

Generated dashboards look like useful BI products rather than one uniform grid. A dashboard author can choose one of four built-in designs. The default design is a classic BI layout with clear priority, side panels and mixed tile sizes. The agent asks for a design during brainstorming mode.

## Scope

### 1. Design selection

- New optional top-level key `design`:
  - `classic-bi` (default): header, left navigation rail when sections exist, central KPI and chart canvas, right filter and context panel.
  - `market-desk`: warm market-page style; left filter rail, dominant primary chart, compact ranked tables, right context rail.
  - `timetable-board`: timetable rhythm; top bar, section rail, strong numeric rows and a large primary chart.
  - `visible-grid`: visible construction grid; filters in a column, large KPI cells and charts snapped to grid spans.
- Without `design`, every dashboard uses `classic-bi`. This is a deliberate visual change for existing dashboards.
- An unknown `design` stops the build with an error naming `design` and listing the four values; no output is written.
- `--shell <file>` keeps precedence over `design`. The build passes the requested design name to the selected shell as `page.design`; an alternate shell may use or ignore it.
- Designs are built-in skill assets. The output remains one self-contained HTML file in default and `--offline` modes; `--split` and `--remote` keep their existing data delivery.

### 2. Themes and designs

- A design owns layout, navigation placement, density, tile proportions, typography choices available in the prebuilt CSS, and one signature visual treatment.
- A theme (spec 0003) still owns colour tokens, palette, radius, font and logo. When `theme` is set, its values override a design's default colours and type values.
- Contrast warnings and theme validation are unchanged.

### 3. Tile size

- Every tile may set optional `size: small | medium | large | wide`.
- Without `size`, KPI tiles are `small`; other tiles are `medium`.
- Size expresses priority. Each design maps sizes to its own grid, but `large` and `wide` must use more area than `medium` on desktop widths.
- On narrow screens, tiles may stack, but their configured order is preserved.
- An invalid `size` stops the build naming the tile and `size`; no output is written.

### 4. Layout behavior

- On desktop widths, all four designs provide a persistent filter/context region unless a design deliberately uses a top or left filter rail; filters must remain visible without scrolling to the bottom of the page.
- On narrow widths, filters and side panels collapse into a standard disclosure control; no filter becomes unreachable.
- Sections and tabs keep spec 0005 behavior: hash, keyboard navigation and lazy closed-tab queries are unchanged.
- Explore, remote status, alerts, header line, KPI notes and table/chart hosts remain available in every design.
- Designs use standard controls: buttons, selects, date inputs, tabs, dialogs and tables. Designs never replace a control with an unfamiliar metaphor.

### 5. Agent workflow

- In brainstorming mode, the agent asks which design to use in the same short interview round and offers `classic-bi` as the default.
- For a specific build request, the agent asks about design only when the requested presentation would materially change the result; otherwise it uses the default.
- The agent may set `size` to communicate priority; it does not give every chart the same size by default.

## Non-goals

- Multi-select per dimension. It needs a separate behavior spec for click toggles, URL hash format, SQL expansion and copied links.
- Shipping brand-specific or customer-specific designs.
- Changing the shell v1 public data/actions contract except adding the read-only `page.design` and per-tile `size` values.
- Per-tile custom CSS, drag-and-drop layout editing or saved user layouts.

## Acceptance examples

1. **Default design.** The hand fixture without `design` builds with `classic-bi`; at 1440×900 the Revenue KPI and filters are visible in the first viewport, the filters are in a side panel, and a `large` chart occupies more area than a `medium` chart. Chrome and Firefox show no console errors.
2. **All designs.** The hand fixture builds with each of the four designs over `file://`; each shows Revenue `$2,260.50`, the filter controls, Explore and every tile. Clicking EU in the revenue bar shows `$850.00`; Reset returns `$2,260.50`.
3. **Responsive.** Each design at 390×844 keeps tile order, has no horizontal overflow, and exposes all filters through a reachable disclosure.
4. **Sections.** `fixtures/hand/sections.yaml` with `layout: tabs` keeps spec 0005 acceptance 7 behavior in every design.
5. **Shell precedence.** A config with `design: market-desk` built with `--shell tests/fixtures/plain-shell.js` uses the plain shell, and the shell receives `page.design = "market-desk"`.
6. **Validation.** `design: magazine` and `size: huge` each stop the build with a named error and write no HTML.
7. **Theme override.** `theme: corporate` with `design: timetable-board` uses corporate colour tokens and still has the timetable-board layout.
8. **Offline.** Each design built with `--offline` opens with every non-`file:` request blocked; the same journey as example 2 passes.

## Capture checkpoint

- **Vocabulary:** add **design** and **tile size** to `CONTEXT.md` on approval.
- **Decision:** ADR 0004 records the change from installation-only shell selection to built-in, config-selected designs while retaining external shell precedence.
- **Behavior:** this specification.
- **Uncertainty:** exact visual tokens and component proportions are design-system work after approval; this spec fixes observable behavior and selection rules.

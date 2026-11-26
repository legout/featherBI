# ADR 0003: Replaceable page shell

Status: **proposed** (2026-11-26), for approval together with [spec 0005](../specs/2026-11-26-0005-tables-locale-sections-shell.md) r1. Not accepted.

## Context

ADR 0001 fixes one generic renderer with DaisyUI 5 markup. Spec 0003 lets an author change colours, palette, radius, font and logo, but not the components: layout and markup changes are a non-goal there.

The owner plans a derived edition, maintained outside this repository, that renders the same dashboards with another Web Components library. Forking the renderer for that would mean every fix to engine start, filters, charts, tables and the build has to be ported by hand, and the fork would drift within weeks.

## Decision

1. **Split the renderer in two.**
   - **Renderer** (unchanged ownership): engine adapter, snapshot loading, filter state and URL hash, latest state wins, tile SQL, chart option building, ECharts and AG Grid instances.
   - **Shell** (new module, `assets/shell.js`): everything that creates page chrome — header, header line, theme toggle, filter bar, chips, Reset, sections or tabs, tile cards with their busy and error states, KPI card, Explore dialog.
2. **The renderer talks to the shell only through a versioned contract** (`shell: 1`, documented in `references/shell.md`): the renderer calls shell functions with plain data and DOM elements, and the shell reports user actions back through callbacks. The renderer never queries shell markup by selector.
3. **The default shell renders today's DaisyUI markup**; with it, every existing build stays byte-identical.
4. **A shell is chosen per installation, not per dashboard:** `build --shell <file>`. `dashboard.yaml` has no shell key, so one config builds with any shell.
5. **Only the default shell ships in this repository.** Derived editions keep their shells, and any company or brand assets, in their own repositories.
6. **A contract change bumps the version.** The build rejects a shell whose declared version it does not support.

## Alternatives considered

- **Fork the renderer per edition:** rejected; every core change has to be ported by hand.
- **CSS-only theming (spec 0003) for derived editions:** not enough when the edition must use another component library.
- **A `shell:` key in `dashboard.yaml`:** rejected; a config would then depend on files that exist only in one installation.
- **Swap only the CSS framework (DaisyUI) at build time:** rejected; components such as selects, tabs and dialogs differ in markup and behaviour, not just in class names.

## Consequences

- The renderer gets a seam and some indirection; markup moves into `shell.js`. The default output must not change (spec 0005 acceptance 1 checks byte identity).
- The shell contract becomes a public interface; changes need a version bump and a note in the CHANGELOG.
- A derived shell is responsible for its own accessibility, `file://` and `--offline` behaviour; this repository tests only the default shell and a minimal test shell.
- Charts and tables keep ECharts and AG Grid in every shell, so their theming stays in the renderer's `chartTheme()` and grid theme hooks.

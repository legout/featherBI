# ADR 0008: Theme token system

**Status:** accepted (owner approved with spec 2026-09-28-0003 on 2026-09-28).

## Context

Dashboard appearance was themable only at the shell level: `neutral`/`daisyui`/`siemens-ix` adapters plus scoped author `theme.css`. Author CSS cannot reach ECharts internals, so charts always rendered with factory defaults (palette, axis chrome, area opacity, heatmap scale) regardless of theme — the dominant visual quality gap identified when comparing design mockups against example dashboards. At the same time the owner wants two built-in Siemens Industrial Experience themes (dark and light) and custom themes generated on the fly by the authoring agent from natural-language style prompts. Unvalidated free-form CSS cannot serve generated themes: typos no-op silently, chart config is unreachable, and compile-time contrast checking is impossible.

## Decision

Introduce a fixed theme-token contract (`theme.tokens.yaml`, schema version 1: surfaces, text, border, accent, status colors, radius, fonts, chart palette, optional heat minimum). The compiler validates tokens and **bakes** a complete theme bundle (scoped CSS variables including AG Grid `--ag-*` overrides, plus a registered ECharts theme object) into the compiled config. Built-in presets — including `siemens-ix` (dark) and `siemens-ix-light` — are shipped token sets baked through the identical code path; there is no preset-only theming mechanism. Contrast violations are compile-time warnings, not errors; schema violations are errors. Author `theme.css` remains as an escape hatch applied after the baked theme.

## Consequences

- The token schema becomes a public authoring contract; changes require a schema `version` bump.
- Chart appearance is themable for the first time, uniformly across presets and custom themes.
- Compile-time baking preserves ADR 0006 (dashboard projects compile into typed viewers) and the artifact CSP.
- KPI/metric-group and filter-bar markup hooks change; existing author `theme.css` targeting old hooks may need edits (accepted, documented in CHANGELOG).
- `neutral` and `daisyui` are deliberately not ported to tokens; they remain as-is.
- `siemens-ix` becomes a dark theme; this is a documented behavior change, and explicit-only selection is preserved.

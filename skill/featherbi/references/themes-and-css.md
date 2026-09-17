# Themes and CSS

`theme` and `rendererPreset` are independent choices.

## Themes

- `neutral` (default): lightweight built-in styles.
- `daisyui`: daisyUI shell classes on buttons, cards, tables, inputs.
- `siemens-ix`: Siemens Industrial Experience shell; select only when the user explicitly asks, never inferred from organization or data names.

Only the selected theme ships in the artifact.

## Renderer presets

- `standard`: typed featherBI components (ECharts, AG Grid, filters, Markdown).
- `perspective-first`: shell and shared filters stay featherBI-owned; primary analytical regions render in Perspective with its toolbar and plugins.

## Author CSS (`theme.css`)

Optional trusted author CSS is compiled scoped under `#dashboard`. The scope transform rejects `@import`, remote URLs, and other network-loading constructs so the artifact content-security policy survives. Style only dashboard-owned elements; AG Grid/Perspective internals are customizable only through their supported variables and parts. CSS must not hide status, error, progress affordances, or accessibility basics (focus rings, labels, contrast).

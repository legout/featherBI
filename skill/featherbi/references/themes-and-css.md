# Themes and CSS

`theme` and `rendererPreset` are independent choices.

## Themes

- `neutral` (default): lightweight built-in styles.
- `daisyui`: daisyUI shell classes on buttons, cards, tables, inputs.
- `siemens-ix`: dark Siemens Industrial Experience theme.
- `siemens-ix-light`: light Siemens Industrial Experience theme.
- `themeTokens: theme.tokens.yaml`: custom theme baked from a validated token file (below).

`siemens-ix` and `siemens-ix-light` are selected only when the user explicitly asks, never inferred from organization or data names. Both presets ship as built-in token sets baked through the same code path as custom token files; there is no preset-only theming. The compiler bakes one theme bundle: scoped CSS variables (including the supported AG Grid `--ag-*` overrides) plus a complete ECharts theme (series palette, text and axis styling, heatmap range). Only the selected theme ships in the artifact.

`themeTokens` is valid only with the default `neutral` shell; combining it with `theme: daisyui`, `theme: siemens-ix`, or `theme: siemens-ix-light` fails compilation with an error naming both fields.

## Theme tokens (`theme.tokens.yaml`)

Schema version 1:

```yaml
version: 1                       # optional, default 1
font: Inter, ui-sans-serif, system-ui, sans-serif   # optional, this default
fontMono: "JetBrains Mono", ui-monospace, monospace # optional
radius: 8                        # optional px integer 0–24, default 8
surface: "#000028"               # required — page background
surface2: "#0d0d40"              # required — raised/input surface
text: "#e6e9f8"                  # required
textDim: "#8f96c4"               # required — labels, hints, axis text
border: "#262660"                # required
accent: "#00e6dc"                # required — primary action, selected marks, heat max
accentContrast: "#000028"        # required — text on accent
success: "#00ffb9"               # required
warning: "#ffb35c"               # required
danger: "#ff6b8a"                # required
chart:
  palette: ["#00e6dc", "#00ffb9", "#009999", "#8f8ff0", "#66d9ff"]  # required, 3–8 colors
  heatMin: "#161650"             # optional; defaults to surface2
```

Colors are `#rgb`, `#rrggbb`, or `rgba(r, g, b, a)`; anything else is a compile error naming the key and value. Font stacks must not contain `@import`, `url(`, scheme text, or CSS delimiters — they reach CSS under the artifact content-security policy — and violations are compile errors. Unknown keys are compile errors naming the file and key; missing required keys are compile errors naming the key. All errors carry `file:line:column`.

When the user describes a style in natural language, author this file directly — never free-form chart CSS — and iterate on the tokens alone (see [interview.md](interview.md)).

### Validation errors and contrast warnings

Schema violations (unknown or missing keys, invalid colors, unsafe font stacks, bad radius or palette) fail compilation. Contrast problems never do: the compiler checks `text/surface`, `textDim/surface`, and `accentContrast/accent` against 4.5:1, plus `accent/surface` and each `chart.palette` entry against `surface` at 3:1. A pair below its target prints one warning with the measured ratio; a pair meeting it stays silent; the build always succeeds. When a pair's background token is translucent (`rgba()` alpha below 1), the ratio is indeterminate because it depends on the recipient's browser backdrop, so the compiler prints one advisory warning per affected pair without a numeric ratio.

## Renderer presets

- `standard`: typed featherBI components (ECharts, AG Grid, filters, Markdown).
- `perspective-first`: shell and shared filters stay featherBI-owned; primary analytical regions render in Perspective with its toolbar and plugins.

## Author CSS (`theme.css`)

Optional trusted author CSS is compiled scoped under `#dashboard`. The scope transform rejects `@import`, remote URLs, and other network-loading constructs so the artifact content-security policy survives. With a baked theme, the injected variables land before author CSS, so `theme.css` applies after them and wins on conflict — the escape hatch for anything the tokens cannot express. Style only dashboard-owned elements; AG Grid/Perspective internals are customizable only through their supported variables and parts. CSS must not hide status, error, progress affordances, or accessibility basics (focus rings, labels, contrast); baked themes and author CSS are held to the same rule.

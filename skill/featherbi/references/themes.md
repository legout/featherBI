# Themes

`theme:` in `dashboard.yaml` sets the look of the page: a built-in theme by name, or your own theme file. The theme is embedded in the HTML in every build mode. Without `theme` the page uses `default`.

```yaml
theme: corporate            # a built-in theme
theme: ./brand/theme.yaml   # or a theme file, relative to the config file
```

## Built-in themes

| Name | Look |
|---|---|
| `default` | DaisyUI winter (light) and night (dark). The same page as without `theme`. |
| `corporate` | Sober blue and grey, square corners. |
| `minimal` | Black and white with one orange accent; charts in the accent and greys. |
| `high-contrast` | WCAG AAA: text at 7:1 or more on its surface (body text 21:1), light and dark. |

They are theme files in `themes/<name>.yaml`; read one to see its colours.

## Theme file

Copy this template, keep what you need and delete the rest. Only one of `light` and `dark` is required.

```yaml
name: Acme                      # used in error messages only
light:
  primary: "#0b5fff"            # buttons, links, the first chart series
  primary-content: "#ffffff"    # text on primary
  base-100: "#ffffff"           # tiles and header
  base-200: "#f4f6fa"           # page background
  base-content: "#1a1a1a"       # text
dark:
  primary: "#6ea0ff"
  primary-content: "#111418"
  base-100: "#111418"
  base-200: "#0b0d10"
  base-content: "#e8eaed"
palette: ["#0b5fff", "#ff7a00", "#00a37a"]   # chart series colours, both schemes
radius: 0.5rem                  # corners of tiles and controls: px, rem or em, or 0
font:
  family: "Acme Sans, system-ui, sans-serif"
  file: ./AcmeSans.woff2        # optional, embedded: woff2, woff, ttf or otf, up to 500 KB
logo: ./logo.svg                # SVG or PNG, embedded, up to 200 KB, shown left of the title
```

- **Colours** are hex or `oklch()`, in quotes. Tokens: `base-100`, `base-200`, `base-300`, `base-content`, and `primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`, `error`, each with a `-content` colour for text on it.
- A token you leave out takes the `default` theme's value for that scheme.
- With both `light` and `dark` the page has the toggle and starts in the viewer's system setting. With one, the toggle is hidden and the page always shows that scheme.
- Without `palette` the chart colours are derived from the theme's colours. A `palette` is used unchanged in light and dark, so pick colours that show on both surfaces.
- File paths are relative to the theme file.
- A mistake stops the build: `theme <file>: <key>: <problem>`. Fix that key.
- **Contrast warning:** when `base-content` on `base-100` or `primary-content` on `primary` is below 4.5:1, the build warns with the ratio. Darken or lighten one of the two until the warning is gone, and pass any remaining warning on to the user.

## Worked example: Acme

`examples/acme-theme/` in the repository (`theme.yaml`, `logo.svg`, a font file with its licence, `dashboard.yaml`) is a theme for a fictitious brand. Taking the colours from a brand guide:

1. **Brand colour → `primary`.** The guide's main colour, as hex: Acme Blue `#0b5fff`.
2. **Text on it → `primary-content`.** White or near-black, whichever reaches 4.5:1. White on Acme Blue is 5.13:1.
3. **Surfaces and text.** `base-100` is the paper colour (usually white), `base-200` a slightly darker page background, `base-content` the guide's text colour (`#1a1a1a`).
4. **Dark scheme.** Do not reuse the light colours: take a dark surface (`#111418`), light text (`#e8eaed`), and a lighter tint of the brand colour (`#6ea0ff`), because the original is too dark on a dark surface. Leave `dark` out when the brand has no dark look.
5. **Secondary brand colours → `accent` and `palette`.** List the palette in the order the guide ranks them; the first series gets `palette[0]`.
6. **Corners, font and logo.** `radius` from the guide's shapes (0 for square). `font.family` with fallbacks; add `font.file` only when the licence allows it (below).
7. **Build** and fix any contrast warning.

## Fonts and logos: licence

A font file and a logo are embedded in every page built with the theme, so everyone who gets the HTML gets the files. Embed a font only when its licence allows embedding in web pages (many desktop licences do not); otherwise give `font.family` alone and the viewer's installed fonts are used. Use a logo only with the owner's permission. The user is responsible for both; ask when unsure. The Acme logo was drawn for the example; its font is Inter, whose SIL Open Font License allows embedding and redistribution, and the licence text ships next to the file.

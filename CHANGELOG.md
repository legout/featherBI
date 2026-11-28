# Changelog

## Unreleased

- Rewrite as an agent skill (`skill/featherbi`): `build` and `profile`, 17 ECharts presets, KPI, pivot, table and text tiles, filters with URL-hash state, Explore, and the default, `--offline` and `--split` outputs.
- Install with `npx skills add legout/featherbi`.
- `--offline` is not supported with `engine: duckdb-wasm`; the build rejects it.
- Document `build --remote` (bucket-hosted data, presigned links) in `references/remote.md`; the mode is unqualified until verified.
- Themes: `theme:` takes a built-in theme (`default`, `corporate`, `minimal`, `high-contrast`) or a theme file (`references/themes.md`). The default's light `primary-content` is now white, so text on the primary colour reaches 4.5:1; pages without `theme` change with it.
- Shell contract v1: the page chrome moves into a replaceable shell module (`assets/shell.js`, contract `shell: 1` in `references/shell.md`). `build --shell <file>` embeds another shell in every mode; a file without the `export const manifest = { shell: 1 };` first line fails the build. Pages built with the default shell are unchanged.
- Designs and tile sizes (spec 0006): `design:` takes `classic-bi` (default), `market-desk`, `timetable-board` or `visible-grid`, and every tile may set `size: small | medium | large | wide`; an unknown value stops the build. **Pages without `design` change**: the default is now `classic-bi`, with the filters in a side panel (a disclosure on narrow screens) and a section rail on the left. The other three names are accepted and render as `classic-bi` until their layouts ship.
- Shell contract v1 gains the read-only `page.design` and a `size` on every tile of `page.groups`; the manifest stays `shell: 1` and `--shell <file>` still wins over `design`.
- The npm package `featherbi` is retired in favour of this repository.

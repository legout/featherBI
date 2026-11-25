# Changelog

## Unreleased

- Rewrite as an agent skill (`skill/featherbi`): `build` and `profile`, 17 ECharts presets, KPI, pivot, table and text tiles, filters with URL-hash state, Explore, and the default, `--offline` and `--split` outputs.
- Install with `npx skills add legout/featherbi`.
- `--offline` is not supported with `engine: duckdb-wasm`; the build rejects it.
- The npm package `featherbi` is retired in favour of this repository.

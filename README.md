# featherBI

An agent skill that turns a short `dashboard.yaml` into one HTML file: KPIs, 17 chart presets, pivot, table, filters with cross-filtering, and an Explore view. The recipient double-clicks the file; no server.

## Install

```sh
npx skills add legout/featherbi
```

This installs `skill/featherbi` (global or per project, as `skills` asks). Update with `npx skills update`.

Needs Node >= 22 and the DuckDB CLI >= 2.0 on `PATH`. Dashboard builds need no npm install.

## Use

Ask your agent: "build a dashboard of revenue by region and month from `data/sales.parquet`". It profiles the data, writes `dashboard.yaml` and runs:

```sh
node skill/featherbi/scripts/featherbi.mjs build dashboard.yaml [--out <path>] [--offline | --split]
```

Output modes: default (one file, JS from a CDN), `--offline` (everything inlined; not with `engine: duckdb-wasm`), `--split` (folder, serve it over HTTP). See `skill/featherbi/references/config.md`.

## Development

`npm ci`, then `npm test` (node:test and Playwright, Chrome and Firefox). Specs and decisions are in `project/`; terms in `CONTEXT.md`. The previous implementation is on the `legacy` branch and the `legacy-final` tag.

## The old npm package

`featherbi` on npm is retired; this repository is the product ([ADR 0002](project/adr/0002-repository-is-the-skill.md)).

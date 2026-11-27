---
name: featherbi
description: Build a single-file BI dashboard (filters, cross-filtering, KPIs, 17 chart presets, pivot, table, Explore) from CSV, JSON, Parquet, Excel, SQLite, Delta, Iceberg, DuckLake, Postgres or S3 data. Use when the user wants a dashboard, report or BI view of data files that they can open by double-click or share.
---

# featherBI

You write one `dashboard.yaml`; `build` turns it into one HTML file. Never write HTML, JS or chart code.

Needs on the machine: Node >= 22 and the DuckDB CLI >= 2.0 on `PATH`. No npm install.

## Workflow

1. **Profile** the data. Pass files or DuckDB table expressions:
   `node scripts/featherbi.mjs profile data/sales.parquet "read_xlsx('data/targets.xlsx')"`
   It prints schema, row counts and sample values as JSON. Remote or credentialed sources: read `references/sources.md` first; never put credentials in the config.
2. **Pick tiles.** For each question choose a tile type and, for charts, one of the 17 presets in `references/presets.md` (it lists each preset's required result columns).
3. **Write `dashboard.yaml`** following `references/config.md`. Source paths are relative to the config file.
4. **Build**:
   `node scripts/featherbi.mjs build dashboard.yaml`
   Add `--out <path>`, `--offline` (everything inlined, opens with no network) or `--split` (folder, needs a web server). Details in `references/config.md`. `--remote s3://<bucket>/<prefix>` puts the data in a bucket behind expiring links; it is **unqualified**, read `references/remote.md` before using or recommending it.
5. **On error**, the message names the tile (`tile "<id or number>": …`) or source. Fix that tile or source in the config and rebuild. See `references/troubleshooting.md`. Do not change scripts or assets.
6. **Report** to the user the output path and its size, as the build prints them, plus any warning. Say how to open it (double-click; `--split` via `python3 -m http.server`).

Paths above are relative to the skill folder (`skill/featherbi/` in a checkout, or wherever `npx skills add` put it).

## Brainstorming mode

When the user names data but not what to show, or asks for ideas, read `references/brainstorm.md` and: (1) profile, (2) guess the domain from `references/domains.md` and say why, (3) ask at most five questions with defaults, (4) propose 3 ideas with 4–8 tiles each, (5) build the picked one. A specific request skips the mode. Never invent data.

## Rules

- Every tile SQL reads only snapshot tables (the source names) and core DuckDB functions, and puts `{{filters:<table>}}` in each `WHERE`.
- Write repeatable source SQL: no clock functions, no `random()`. The same config, data and DuckDB give a byte-identical file.
- Credentials never go in the config.
- Do not claim a remote source works unless `references/sources.md` marks it verified. `--remote` is unqualified until `references/remote.md` says otherwise.
- `--offline` does not work with `engine: duckdb-wasm`, and cannot be combined with `--split`.

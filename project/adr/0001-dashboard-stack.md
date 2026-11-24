# ADR 0001: Dashboard stack (snapshot + Haybarn + ECharts/DaisyUI/AG Grid, Perspective on demand)

Status: accepted. The owner adopted it on 2026-11-24 ("So übernehmen") after the round-3 probe.
Evidence: [research/2026-11-24-dashboard-stack.md](../research/2026-11-24-dashboard-stack.md)

## Context

featherBI is a skill that produces BI dashboards as one HTML file. The owner listed these sources: CSV, JSON, Parquet, Excel, Delta, Iceberg, DuckLake, SQLite, Postgres, S3 and SharePoint/OneDrive.

No browser DuckDB can read Postgres or Delta, and SharePoint needs OAuth and CORS. In the probe, Perspective was the slow part whenever a filter changed. The previous featherBI collapsed under accidental complexity, so the parts below are deliberately few and fixed.

## Decision

1. **Snapshot at build time.** Native DuckDB 2.0.x on the author's machine reads every source. Data goes into the HTML as Parquet. The browser never needs credentials or reachable sources.
2. **Browser engine: Haybarn-Wasm 2.x** (`@haybarn/haybarn-wasm`, pinned).
   - The engine sits behind one small adapter, so upstream `@duckdb/duckdb-wasm` 2.x can replace it by changing configuration.
   - One engine instance is shared by all tiles.
3. **Charts and KPIs: ECharts** (pinned major version).
   - The heatmap is an ECharts tile.
   - No other chart library.
4. **Tables:**
   - **Pivot:** DuckDB SQL (`GROUPING SETS`) rendered as a DaisyUI table.
   - **Large raw data:** AG Grid Community (MIT), infinite row model. Every sort, filter and scroll is a bound-parameter SQL query.
5. **Design:** DaisyUI 5 + Tailwind 4 CSS, generated at build time and inlined. No Tailwind runtime. Light and dark themes.
6. **Perspective only as on-demand "Explore".**
   - It loads lazily on first open and is never re-rendered by the filter path.
   - It keeps a pinned, anchor-checked build-time patch so it works on `file://`.
7. **The agent writes configuration, never rendering code.**
   - A dashboard is one config: data sources, SQL and tile JSON.
   - Templates and one generic renderer turn it into HTML.
8. **Libraries load from a pinned CDN by default.** A fully offline file is opt-in.

## Alternatives considered

- **Perspective as the main UI:** rejected. Its tiles took 2–8 s per filter change, against 0.5–1 s for SQL + ECharts. It also needs a `file://` patch on the main path.
- **Plotly, Vega-Lite, Observable Plot:** they overlap with ECharts and add a second config model.
- **TanStack Table or Tabulator instead of AG Grid:** viable, but would mean more of our own code to reach the same sort, filter and infinite-scroll features.
- **Mosaic/vgplot:** strong cross-filtering on DuckDB-Wasm, but it is a second chart model. Revisit only if our own filter path cannot stay under 1 s.
- **Upstream duckdb-wasm as default:** not on DuckDB 2.x on npm yet. Kept as the swap-in.
- **Live loading in v1:** postponed. Postgres and Delta are impossible in the browser. Iceberg, DuckLake (pg_lake, pg_ducklake via S3) and Grainlift are candidates for a later per-source live mode.

## Consequences

- Delta, Postgres and SharePoint work in v1, but only as snapshots.
- The file size is dominated by the data. Large datasets need build-time aggregation or sampling, which the spec decides.
- Libraries come from a CDN, so opening a dashboard needs network access unless the offline option is used. The offline option makes the file larger by tens of MB.
- Haybarn is a release candidate with its own signed extension CDN. The engine adapter is the way out.
- The Perspective patch can break on upgrades. The build fails loudly when its anchors are not found.

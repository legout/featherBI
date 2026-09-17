# Dashboard authoring and UI landscape

Status: research evidence for the approved featherBI dashboard-project/runtime-v2 design. This note records source facts and design implications; it is not behavioral authority.

## Question

What should featherBI adopt from Rill, Evidence, FINOS Perspective, modern UI/grid/editor libraries, and Parquet-over-object-storage patterns to support an agent-led dashboard interview and feedback loop?

## Findings

### Rill: useful separation between metrics, exploration, and canvas

Rill distinguishes generated/interactive Explore dashboards from configurable Canvas dashboards. Canvas components can be authored in YAML and include KPIs, tables, charts, filters, and Markdown, with global and component-level filtering. Rill also separates reusable metrics/dimensions from individual visualizations.

featherBI should adopt the separation of reusable models/metrics from layout and the idea of a manually editable YAML canvas. It should not adopt Rill's hosted control plane, authenticated embedding model, or metrics engine wholesale.

Sources:

- [Rill dashboard overview](https://docs.rilldata.com/developers/build/dashboards/dashboards-101)
- [Rill Canvas dashboards](https://docs.rilldata.com/developers/build/dashboards/canvas)
- [Rill component YAML reference](https://docs.rilldata.com/reference/project-files/component)
- [Rill metrics SQL](https://docs.rilldata.com/developers/build/metrics-view/metrics-sql)

### Evidence: SQL-as-code and composable report projects

Evidence treats SQL queries and components as source-controlled project material. Its component catalog and query model show the value of keeping analytical logic in ordinary files rather than embedding large query strings in generated application code.

featherBI should adopt separate SQL files and source-controlled authoring projects. Evidence's Markdown-first page model is less suitable as featherBI's primary abstraction because the target is a highly interactive responsive dashboard rather than a narrative report.

Sources:

- [Evidence components](https://docs.evidence.dev/core-concepts/components)
- [Evidence queries and data loading](https://docs.evidence.dev/core-concepts/queries)

### Perspective: strong optional exploration/view layer

FINOS Perspective is a framework-independent analytics/viewer system with a WebAssembly engine, virtualized datagrid, grouping/pivoting, filters, expressions, and chart plugins. It accepts tabular data including Apache Arrow and can save/restore viewer configuration. These capabilities overlap some BI presentation and exploration needs.

Perspective should not become a second source/query lifecycle in featherBI. DuckDB-WASM already owns local files, SQL, typed parameters, replacement, and coherent filter revisions. The lower-risk integration is to feed bounded DuckDB query results into Perspective viewers. This supports both individual Perspective components and a Perspective-first dashboard preset without duplicating source ownership.

The official repository and integration discussions also show that Perspective's DuckDB/virtual-server integration and Arrow type behavior have evolving constraints. Direct raw-source replacement would therefore add uncertainty without solving a current requirement.

Sources:

- [FINOS Perspective repository](https://github.com/finos/perspective)
- [Perspective view concepts](https://perspective.finos.org/guide/explanation/view.html)
- [Perspective DuckDB virtual-server work](https://github.com/finos/perspective/pull/2890)

### Grids: AG Grid Community is the practical default

AG Grid Community provides sorting, filtering, pagination, editing, and row/column virtualization under its community license. Advanced grouping, pivoting, and tool panels are Enterprise features. Siemens Industrial Experience officially integrates AG Grid through `@siemens/ix-aggrid`, which makes AG Grid the lowest-friction default for both neutral and optional Siemens-themed dashboards.

TanStack Table is headless and would require featherBI to build more rendering and virtualization behavior. Tabulator is a credible framework-independent alternative but lacks the direct Siemens iX integration. Perspective remains available when pivot-style exploration is needed. featherBI should use AG Grid Community only; it must not silently depend on Enterprise modules.

Sources:

- [AG Grid Community vs Enterprise](https://www.ag-grid.com/javascript-data-grid/community-vs-enterprise/)
- [Siemens iX AG Grid guide](https://ix.siemens.io/docs/components/grid/guide)
- [TanStack Table](https://tanstack.com/table/latest)
- [Tabulator documentation](https://tabulator.info/docs/6.3)

### Design systems: presentation should be an explicit choice

Siemens Industrial Experience supplies a broad industrial component system, responsive layout guidance, ECharts theming, and AG Grid integration. daisyUI supplies Tailwind-based semantic component classes and a large set of built-in/customizable themes. Neither should define featherBI's domain or query model.

A theme-neutral shell with adapters is the appropriate boundary. The authoring interview should separately choose a renderer preset (`standard` or `perspective-first`) and a shell theme (`neutral`, `daisyui`, or explicitly requested `siemens-ix`). Only selected capabilities should be bundled. Optional author CSS needs a constrained, documented trust boundary.

Sources:

- [Siemens iX components](https://ix.siemens.io/docs/components/overview)
- [Siemens iX layout grid](https://ix.siemens.io/docs/components/layout-grid)
- [daisyUI components](https://daisyui.com/components/)
- [daisyUI themes](https://daisyui.com/docs/themes/)

### SQL editing: CodeMirror fits the bounded playground

CodeMirror 6 is modular and extension-based. Its SQL package supports SQL dialect configuration and completion hooks. Monaco offers a larger IDE-like surface, but SQL behavior would still need custom integration. A plain textarea does not meet the requested editing experience.

CodeMirror should power author and recipient playgrounds. The runtime must continue to enforce featherBI's engine-backed SELECT/CTE admission, declared-source boundary, parameter safety, time limit, and result limit; editor syntax support is not a security boundary.

Sources:

- [CodeMirror system guide](https://codemirror.net/docs/guide/)
- [CodeMirror SQL language package](https://github.com/codemirror/lang-sql)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)

### Object storage and Hyparquet: valuable later, not the local default

Hamilton Ulmer's R2/Hyparquet dashboard demonstrates a different serving model: precompute bounded grouping sets into a carefully sorted Parquet cube, use footer metadata and row-group min/max values to identify byte ranges, and answer a fixed set of interactions with HTTP range requests. This can reduce browser downloads dramatically for customer-facing dashboards when filter/chart combinations are bounded and refresh cadence is coarse.

That approach shifts query complexity into a data pipeline and is not a substitute for featherBI's current arbitrary local-file/DuckDB workflow. It is strong evidence for a future remote-data mode using public or signed URLs, precomputed cubes, and range-capable storage. It should remain deferred until the local authoring/runtime-v2 contract is established.

Source:

- [Fast drilldown dashboards from a single Parquet file](https://www.hamiltonulmer.com/customer-dashboards-r2-hyparquet/)

## Adopted direction

- Source-controlled dashboard projects with YAML, SQL models/queries, and generated ignored state.
- A lightweight dimensions/measures catalog compiled into ordinary runtime SQL.
- DuckDB-WASM as the single source/query engine.
- ECharts and AG Grid Community as standard renderers.
- Perspective as a bounded result viewer and Perspective-first preset.
- CodeMirror for bounded author/recipient SQL exploration.
- A theme-neutral shell with neutral, daisyUI, and explicit Siemens iX themes.
- Capability-built bundles rather than one universal viewer.
- Precomputed Parquet cubes and remote range reads deferred to a later specification.

## Open feasibility evidence before implementation

The implementation plan should assign focused spikes for:

1. profiling large CSV/JSON/Parquet files from a portable skill script without copying whole datasets into model context;
2. passing bounded DuckDB-WASM results into Perspective under `file://` and preserving the selected theme;
3. capability-built bundles that include only the selected theme/renderers/editor; and
4. safely scoping author CSS while rejecting imports and remote URLs.

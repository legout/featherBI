# featherBI runtime and config contract v1

Status: written specification, concrete defaults, and all five implementation plans under `docs/plans/` approved by the owner. Execution remains subject to Plan 01's explicit baseline-commit gate and supervised candidate/integration approvals.

## 1. Authority and scope

Sources:

- [Original brainstorm](../../brainstorm_serverless_ai_dashboards.md): contract-first authoring, shared client runtime, Siemens iX and ECharts, portable artifacts.
- [Approved AP dashboard](ap-inspection-dashboard.md): the reference user-visible behavior and metric definitions.
- [Chrome feasibility report](../research/browser-feasibility-report.md): verified browser seam and file-replacement failure.
- Subsequent owner decisions: Chrome-only validation; multiple named local sources and joins; recipients may replace compatible data; no recipient SQL/layout editor. The owner approved the contract boundary covering explicit schemas, typed SQL parameters, declarative presentation, atomic replacement, and two packaging modes.

First release: agent-authored `grid` dashboards, local CSV/Parquet/JSON, client-side queries, filtering, and sharing. No backend, remote-data connector, authentication flow, DuckLake, XLSX, lab, doc, chat, scheduler, or live file watcher. Online runtime dependencies are allowed; offline operation is not promised. Scope changes from the brainstorm are intentional, not incomplete implementations of its later phases.

Vocabulary is defined in [CONTEXT.md](../../CONTEXT.md). The existing approved architectural choices are recorded in [portable delivery](../adr/0001-portable-browser-delivery.md), [declarative config and fixed viewer](../adr/0002-declarative-config-and-fixed-viewer.md), [source generations](../adr/0003-single-worker-source-generations.md), and [engine-backed admission](../adr/0004-engine-backed-query-admission.md). These records capture rationale; this specification continues to own behavior and acceptance.

## 2. Architecture and ownership

- **Contract validator:** validates config structure and cross-references before loading data. The authoring tool and browser use the same versioned schema and semantic rules.
- **Local-data runtime:** owns the DuckDB-WASM worker, File/embedded-byte registration, normalized source views, source generations, and cleanup.
- **Query runtime:** binds typed parameters, runs named SELECT queries, validates results, and prevents stale results from becoming visible.
- **Grid renderer:** renders filter controls and declarative KPI/chart/table components using Siemens iX and ECharts. It does not own source loading or generate SQL.
- **Packager and skill:** the agent creates config; deterministic tooling validates and packages config, viewer code, and data. The skill never hand-generates executable dashboard HTML.

These are responsibilities, not a requirement for five classes, services, or packages. Keep one runtime bundle with independently testable functions. Rendering consumes query results rather than millions of raw source rows.

## 3. Config document

A JSON object has `contract: 1`, `app: "grid"`, a plain-text `title`, `data`, `filters`, `queries`, and `layout`. Reject unsupported contract/app versions, unknown properties, duplicate IDs, and unresolved references. Do not silently migrate incompatible configs.

- `data.mode` is `upload` or `embedded`. `upload` includes the extracted-HTML-plus-data bundle use case; it does not mean sending data to a server.
- `data.sources` is a non-empty array. Each source has `id`, `type` (`csv`, `parquet`, or `json`), `file` (a suggested basename), and `schema`.
- `schema` maps required column names to `{type, nullable}`. Types are `string`, `boolean`, `integer`, `number`, `date`, and `timestamp`; `nullable` is explicit.
- Embedded sources additionally contain `content: {encoding: "base64", value: "..."}`. Upload sources cannot contain `content`. V1 uses one delivery mode for the artifact, not mixed embedded/upload sources.
- Source, filter, query, and component IDs match `[a-z][a-z0-9_]*`. Quote SQL identifiers when generating runtime-owned SQL; IDs are not permission to concatenate unquoted SQL.
- Source schemas reject case-insensitively duplicate names because SQL column resolution can otherwise be ambiguous. Input files with duplicate header/column names are rejected, not silently renamed.
- Config contains no File handles, absolute local paths, tokens, or arbitrary script/HTML fields. `file` is a non-empty basename: reject slash, backslash, colon, NUL/control characters, and `.`/`..`. It is a hint, never authority to access a sibling file automatically.

Minimal example (not the complete AP dashboard):

```json
{
  "contract": 1,
  "app": "grid",
  "title": "Inspection activity",
  "data": {
    "mode": "upload",
    "sources": [{
      "id": "inspections",
      "type": "parquet",
      "file": "inspections.parquet",
      "schema": {
        "station": {"type": "string", "nullable": false},
        "order_number": {"type": "string", "nullable": false}
      }
    }]
  },
  "filters": [{
    "id": "station",
    "kind": "select",
    "source": "inspections",
    "column": "station",
    "default": null
  }],
  "queries": {
    "summary": {
      "sql": "SELECT count(*) AS records FROM inspections WHERE ($station IS NULL OR station = $station)",
      "params": ["station"]
    },
    "stations": {
      "sql": "SELECT station, count(*) AS records FROM inspections WHERE ($station IS NULL OR station = $station) GROUP BY station ORDER BY records DESC, station",
      "params": ["station"]
    }
  },
  "layout": [
    {"id": "records", "type": "kpi", "query": "summary", "field": "records", "label": "Inspection records"},
    {"id": "by_station", "type": "bar", "query": "stations", "x": "station", "y": "records", "label": "Records by station"}
  ]
}
```

## 4. Input normalization

Validate every declared column across the complete candidate input before accepting replacement; a successful sample or `LIMIT 1` is insufficient. Extra input columns are ignored. Missing required columns are errors even when declared nullable. Never silently discard malformed rows or turn conversion failures into null.

- **CSV:** UTF-8, optional BOM, comma-separated, quoted fields and header row. Read lexical values before conversion so `001` stays a string. Unquoted empty fields are null; quoted empty strings remain strings. Alternate delimiters/encodings require preprocessing in v1.
- **JSON:** UTF-8 array of flat objects or newline-delimited flat objects. Missing required object keys behave as null values and therefore fail non-null constraints. No automatic unnesting or flattening; reject nested values in declared columns. For NDJSON, blank lines may be ignored, but invalid non-blank lines are errors.
- **Parquet:** preserve typed values and nulls; no lossy coercion to strings and back. A typed number is not silently accepted for a declared string identifier. Unsupported nested or binary values in declared columns require preprocessing.
- **Strings:** preserve leading zeros, whitespace, case, and empty strings. Never infer business meaning from column names.
- **Booleans:** JSON/Parquet booleans, or CSV literal `true`/`false`. Do not guess whether integers, `Y/N`, or coded statuses mean true.
- **Integers/numbers:** accept appropriate typed numeric input, or strict numeric CSV text. Reject fractional integers, overflow, NaN, and infinities. V1's interoperable integer range is JavaScript's safe-integer range; reject unsafe input instead of rounding it.
- **Dates:** ISO `YYYY-MM-DD` or typed Parquet dates. Validate calendar dates, not just the textual shape.
- **Timestamps:** timezone-naive ISO date/time values or timezone-naive Parquet timestamps, preserving microseconds. Reject offset-bearing/timezone-aware values rather than silently shift them. AP timestamps are grouped and displayed as recorded; no browser-local timezone conversion. UTC-aware support is outside this initial contract.
- **Empty input:** an empty Parquet with its schema, a header-only CSV, or an empty JSON array may be valid and return zero rows. Construct the declared typed zero-row relation for an empty JSON array. An empty byte file or missing CSV header is an input error.

The validator reports source ID, column, expected type, and an error category. Counts and a bounded location/sample can aid diagnosis, but do not dump source rows or local paths into exported reports or config.

## 5. File selection and source generations

Recipients explicitly assign a selected/dropped file to each source ID. A matching basename can suggest an assignment; never guess between ambiguous candidates or treat an extension as proof of format. The format and schema must match the source declaration. One File may be deliberately assigned to more than one logical source; mapping is explicit.

Use browser-selected File handles for upload sources. Do not eagerly copy a large selected Parquet through `arrayBuffer()`. Embedded data necessarily requires decoding bytes. Each physical registration receives a fresh generation-specific name; named logical source views remain stable.

Initial state has no active dataset until all sources pass validation. Replacement uses this sequence:

1. Retain the active source mappings, filters, and displayed results.
2. Stage replacements for one or more sources; unchanged mappings remain part of the candidate dataset.
3. Validate all replacement files and build the candidate's typed views. Allow only one candidate apply at a time; no unbounded queue of File references.
4. Prepare/recompute the initial filter defaults and all visible queries against the candidate. Validate result bindings before committing.
5. Commit source mappings, filter defaults, and visible results together. After success, retire obsolete statements/views/registrations and references when no in-flight query can use them.
6. On any failure, discard the candidate, show its error, and leave the previous active dashboard usable. Do not replace previous results with a mixture of old and new sources.

Replacement resets filters to their declared defaults and clearly notifies the recipient. It is not a live connection to the filesystem; replacing a file on disk does not automatically refresh the artifact. No reload persistence is promised. Failure to reclaim resources is a regression to test, not a reason to retain every historical generation.

This atomic behavior does not mandate copying entire datasets or running two permanent workers. The implementation plan must identify the actual staging/rollback seam and verify it in WASM.

## 6. Filters, parameters, and query execution

Supported filters:

- **`select`:** one exact, typed source-column value or null for “all”; searchable option UI does not change equality semantics.
- **`text`:** exact string lookup or null for “all”; no implicit wildcard/substring matching. Suitable for order lookup.
- **`date-range`:** inclusive displayed start/end calendar dates against a declared date/timestamp column. Emits `<id>_from` inclusive and `<id>_to` exclusive-next-day DATE parameters. The AP default is `{kind: "latest-days", days: 30}` anchored to the unfiltered active source's maximum inspection date. No current-clock dependency. An empty source produces no date restriction and unavailable date bounds.

Every filter declares `id`, `kind`, `source`, `column`, and `default`. Null defaults are allowed for select/text. Date-range defaults are either `latest-days` or `{kind: "fixed", from: "YYYY-MM-DD", through: "YYYY-MM-DD"}`. Reject reversed or invalid fixed ranges. Null dataset values are not distinct product identifiers; selecting missing values is not a separate v1 filter operation.

Each query has `sql` and `params`. Filter outputs define the parameter types; the declared parameter list must match the parsed placeholders. Bind values through DuckDB prepared statements, never substitute them into SQL. User filter text containing quotes or SQL syntax remains a literal value. Joins reference declared logical source tables; the agent owns correct join keys and avoiding unintended fan-out.

Queries are authored code: one SELECT statement, including SELECT with CTEs; no multi-statement scripts, DDL/DML, extension installation, file readers, external URLs, or exports in config SQL. Use the engine/parser for statement validation, not a SELECT-prefix regular expression. Supported SQL is not a complete sandbox against malicious authored code; do not open untrusted HTML artifacts or treat a schema validator as a security boundary for arbitrary SQL. Runtime-owned loading SQL is separate from authored queries.

A coherent filter revision is evaluated as one batch. Run a query once per revision even if several components bind to it. Validate all results before swapping the batch into view; on failure retain prior results explicitly labeled with their prior filter state. Increment a revision whenever filters or data change; ignore late results from obsolete revisions. Serialize execution for one worker and coalesce pending filter changes to the latest state rather than building an unbounded backlog. The current in-flight query may finish, but its obsolete results cannot render.

Source options/defaults are obtained from declared source columns using runtime-owned, parameterized queries, not additional arbitrary config SQL. Option search is separate from the active filter value; distinct option lists are searched/paged rather than loading tens of thousands of products into the DOM.

## 7. Results and rendering

`layout` is an ordered array with unique component IDs. Every component declares `id`, `type`, `query`, and a plain-text `label`. Supported component bindings:

- `kpi`: `field`, optionally numeric display `decimals` (0–6). Result must be exactly one row with a numeric or null field; zero rows/multiple rows are binding errors.
- `bar` or `line`: `x`, numeric `y`, optional categorical `series`. A bar may specify `orientation: "horizontal"` or `"vertical"` (default vertical).
- `heatmap`: `x`, `y`, numeric `value`. The query owns aggregation to unique x/y pairs.
- `table`: non-empty ordered `columns` with `{field, label}`; values must be scalar or null. Table paging preserves the query's deterministic ordering. By the owner's planning clarification, each table has an exclusive query ID: no other component may reference that ID. Identical SQL under a different query ID is allowed; compatible KPI/chart components may still share queries.

Bar/line components with temporal x values may declare `annotations: [{at: "YYYY-MM-DD", label: "..."}]`. Render only annotations within the displayed x domain; this supports the AP source-transition marker without executable chart options.

Chart/heatmap queries own aggregation and ordering. Reject duplicate result column names and missing/wrongly typed bindings. Do not silently reinterpret duplicate heatmap coordinates as another aggregation. Render null categorical values as an explicit missing-value label; numeric nulls are gaps/unavailable, never zero. Chart axes and tooltips expose the metric label rather than inventing units.

Convert Arrow values deliberately. Safe count values can become JavaScript numbers; unsafe integers must not be rounded. Tables/KPIs may display exact integer text, while charts reject unsafe numeric bindings with an actionable error. The result boundary must distinguish null, zero, and an empty result.

Use text nodes/escaped text for titles, labels, cells, and tooltips. No `eval`, event-handler strings, HTML formatter callbacks, dynamically chosen component libraries, or raw ECharts JavaScript/config injection. Fixed viewer code maps the declared bindings into ECharts options. Accessible labels, keyboard-operable filters, visible focus, and non-color-only error/status information are required.

Approved operational defaults:

- Debounce text/option-search changes by 250 ms; select/date Apply actions are explicit.
- Table pages contain 100 rows; query the requested page plus one lookahead row. Require authored ORDER BY for paged tables; no full-result JS materialization to paginate.
- At most 10,000 rows per chart/heatmap query. Retrieve at most limit + 1 and reject oversize chart results visibly; do not silently truncate and change totals.
- Option search returns 100 values per page, ordered deterministically. A selected value is displayed even when it is not in the current options page.
- No configurable dashboard-file-size ceiling or latency SLA is invented from the probe. Show progress and catch failures; record actual load/query/memory evidence in acceptance testing.

## 8. Packaging and trust

The deterministic authoring path consumes config plus an explicit source-ID-to-local-file mapping, validates them, and produces one of:

- **Embedded HTML:** config, fixed viewer code, and Base64 data in one file.
- **ZIP bundle:** one HTML file containing config/viewer code and accompanying data files. ZIP members are safe relative names with no traversal or absolute paths; names cannot collide. The user extracts the bundle, opens HTML, and selects the data files.

Both modes render the same config and logical rows. Runtime asset versions are pinned and visible in build metadata; no unversioned `latest` URLs. Runtime dependencies may be fetched online; the artifact must show a useful boot error/retry affordance when they are unavailable, rather than a blank page.

Safely serialize embedded JSON/data into HTML so content such as `</script>` cannot become executable markup. The packager must not publish partially written output as success; validate and build a temporary result before replacing the chosen output. CLI overwrite policy and exact command flags belong to implementation planning. No deploy, upload, commit, or publication is implicit in packaging.

Viewer operation has no application data-upload or telemetry endpoint. Dependencies execute within the viewer's trust context and must be reviewed/pinned; “client-side” is not a guarantee against malicious dependencies or authored SQL. The entire artifact and its data are shared with authorized recipients; source-system ACLs do not follow embedded/exported rows.

In-browser data replacement changes the session, not the original saved HTML/ZIP. Producing an updated distributable remains an authoring/packaging action; viewer-side authoring and re-export are not required in this first release.

## 9. Observable acceptance criteria

- **RC-01 — Config boundary:** browser and authoring validation agree on a valid example and reject unknown versions/properties, duplicate IDs, missing references, unsafe file hints, and invalid bindings before rendering data.
- **RC-02 — Format parity:** equivalent synthetic CSV, Parquet, JSON array, and NDJSON produce identical normalized rows and aggregates, including `001`, null/empty string, booleans, a date boundary, and an empty dataset. Malformed/conversion failures are not silently dropped.
- **RC-03 — Multiple sources:** an inspections source joined to a product-label source produces known expected counts and labels. Missing/ambiguous file assignments cannot activate an incomplete initial dataset.
- **RC-04 — Replacement rollback:** stage two replacements, make one invalid, and verify the original data/filter/results remain active. A corrected batch commits together and resets defaults. Repeated selected/embedded/replacement loads use fresh physical names and reproduce results without retained-file growth after cleanup.
- **RC-05 — Filter safety/coherence:** exact values with quotes, empty strings, and SQL-looking text are bound as data. Two rapid revisions never render mixed or obsolete results; failed revisions retain and label the prior active state.
- **RC-06 — Query contract:** reject multi-statement/non-SELECT queries, unresolved placeholders, incorrect typed values, undeclared source references, and unsupported query constructs. Positive tests include a SELECT CTE and a two-source join; this is supported-language validation, not proof of a hostile-code sandbox.
- **RC-07 — Result semantics:** shared queries execute once per revision; null/zero/empty and unsafe numeric values retain their defined meanings. Wrong result types, duplicate field names, multiple-row KPIs, and chart overflows show useful errors. Config validation rejects a table query ID referenced by another component.
- **RC-08 — Bounded UI:** table/option paging and chart limits are enforced before JS materialization. A null product is distinguishable from real product labels; charts never invent utilization, failure, or physical units.
- **RC-09 — Packaging parity:** reopen embedded HTML and an extracted ZIP in desktop Chrome through file:// and compare aggregates. Missing network assets show a boot error. Embedded `</script>` and hostile-looking cell/label strings remain text. Output contains no credentials, File handles, or absolute input paths.
- **RC-10 — AP scenario:** satisfy AP-01 through AP-07 against synthetic fixtures and the private local AP file, with the agreed Chrome-only scope and explicit observed performance/memory limitations.
- **RC-11 — Authoring handoff:** the skill produces config accepted by the shared validator and invokes deterministic packaging for both modes. A human recipient can select inputs, filter, inspect, and replace compatible data without an agent or local server.

## 10. Planning handoff

Documentation capture checkpoint (planning-contract v1; installed catalog revision unknown): confirmed vocabulary is captured in [CONTEXT.md](../../CONTEXT.md), and the four ADRs linked in §1 record existing approved choices, not new behavior. Browser evidence now lives under `docs/research/`; historical run manifests retain their original revision-specific paths. This documentation capture does not clear outstanding implementation reviews or the P2.1 capability/binding gate.

The owner approved five dependency-ordered implementation plans under `docs/plans/`: contract/fixtures; data normalization and source lifecycle; query/filter execution; grid/AP dashboard; packaging/skill. Each plan links RC/AP criteria rather than redefining behavior, specifies exact files and commands, and identifies one writer for shared interfaces. Source/query lifecycle changes require immediate review because they define dependent behavior.

The browser probe validates only a subset of this design. New-test tasks must establish focused red → green checks for their own behavior; a fast recent-window query is not evidence for full-column validation, atomic multi-source staging, or cleanup under repeated replacement. Execution follows the approved plans and their explicit baseline, candidate, integration, and publication gates; no change of execution protocol is authorized.

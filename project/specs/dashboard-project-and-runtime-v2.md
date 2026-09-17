# featherBI dashboard project and runtime contract v2

Status: owner-approved target specification captured from the 2026-09-16 grilling/design session; written-review gate pending. The staged v2 migration is complete: this specification is the implemented behavior, and runtime contract v1 is removed.

## 1. Purpose and authority

This specification defines the target workflow:

1. give the `featherbi` skill one or more representative local data files;
2. profile them without placing the complete dataset in agent context;
3. interview the user about audience, decisions, metrics, filters, interactions, renderer, and visual treatment;
4. create an editable dashboard project;
5. compile, validate, build, and open a working Chrome preview;
6. edit the source project and refresh the preview until the user approves it; and
7. package the approved dashboard as external-data ZIP delivery.

It expands and has now replaced [runtime contract v1](runtime-contract-v1.md), which survives as a superseded historical specification. The final v2 state does not accept v1 runtime configs. Staged implementation used temporary dual support only while each migration slice stayed coherent and green.

Sources and rationale:

- [Dashboard authoring and UI landscape](../research/dashboard-authoring-and-ui-landscape.md)
- [ADR 0005: external-data-only delivery](../adr/0005-external-data-only-delivery.md)
- [ADR 0006: compiled dashboard projects and typed viewers](../adr/0006-compile-dashboard-projects-into-typed-viewers.md)
- [ADR 0007: remote sources and recipient credentials](../adr/0007-remote-sources-and-recipient-credentials.md)
- [Remote sources specification](remote-sources-v1.md), which supersedes the prior remote non-goal
- [AP inspection dashboard](ap-inspection-dashboard.md), which remains the reference large local-data scenario
- [CONTEXT.md](../../CONTEXT.md), which owns vocabulary

## 2. Architectural boundary

A **dashboard project** is the editable source of truth. Generated JSON, HTML, ZIPs, profiles, screenshots, and local source paths are derived state, never a second editable source.

DuckDB-WASM remains the single browser owner of selected files, logical sources, model/query execution, typed parameters, coherent revisions, and cleanup. Presentation capabilities consume bounded DuckDB results:

- ECharts renders typed chart components.
- AG Grid Community renders the default feature-rich table.
- Perspective renders an optional exploratory component or a Perspective-first dashboard preset.
- CodeMirror edits author and recipient SQL.
- neutral, daisyUI, and Siemens iX adapters style the shell and compatible components.

Perspective does not load or replace raw dashboard sources independently. AG Grid Enterprise modules and arbitrary component plugins are not supported.

The compiler builds a deterministic viewer containing only the capabilities selected by the project. A capability-built viewer remains fixed executable code: projects cannot provide JavaScript, raw HTML, callbacks, remote component URLs, or arbitrary ECharts functions/options.

## 3. Dashboard project

The portable source tree is:

```text
<dashboard>/
├── dashboard.yaml
├── models/
│   └── <model>.sql
├── queries/
│   └── <query>.sql
├── theme.css                 # optional trusted author CSS
└── .gitignore
```

Generated local state is ignored:

```text
<dashboard>/.featherbi/
├── profile.json
├── local-sources.yaml
├── dashboard.config.json
├── preview/
└── screenshots/
```

The final ZIP is also generated and excluded from source control by default. Data files, absolute paths, generated configs, preview HTML, ZIPs, and screenshots must not be committed by the ordinary workflow.

`dashboard.yaml` begins with `project: 1`. Compilation emits runtime `contract: 2`. Unknown properties and unsupported versions are rejected; incompatible documents are not silently migrated.

### 3.1 Local source mapping

Portable source declarations contain IDs, formats, safe suggested basenames, and schemas. Absolute author-machine paths live only in `.featherbi/local-sources.yaml`, which is ignored and passed explicitly to profiling/build commands. Portable YAML, generated runtime config, HTML, reports, and logs must not reveal those paths.

### 3.2 Models and queries

- `models/*.sql` are reusable, read-only SELECT/CTE definitions over declared sources or earlier acyclic models.
- `queries/*.sql` produce component or playground-support results from declared sources/models.
- Model/query IDs use the existing safe identifier grammar.
- The compiler rejects cycles, undeclared references, ambiguous placeholders, multiple statements, mutation/DDL, extension installation, file readers, external URLs, exports, and unsupported engine constructs.
- Joins proposed from profiles require explicit user confirmation, including the intended keys and expected cardinality, before model SQL is generated.

### 3.3 Lightweight metrics catalog

YAML defines reusable dimensions and measures above a model:

- a dimension names a typed model field or approved derived expression, label, optional description, and display format;
- a measure names an aggregation, input expression, label, format, and empty-result behavior;
- supported initial aggregations are count, distinct count, sum, minimum, maximum, and average;
- ratios and other derived measures reference named measures and define zero/null behavior explicitly;
- business meaning is supplied or confirmed by the user; the skill must not infer failure, yield, utilization, currency, units, or unique entity identity from column names alone.

The authoring compiler expands dimensions/measures into ordinary validated SQL and runtime query declarations. The browser does not implement a second dynamic metrics engine.

## 4. Bounded data understanding

Before interviewing, the skill runs a deterministic local profile for each mapped source. The profile may include:

- file format and byte size;
- column names, physical/logical types, and nullability evidence;
- row count when practical;
- null/empty counts;
- approximate or exact distinct counts, identified as such;
- numeric/date/timestamp minima and maxima;
- bounded top values for plausible categorical fields;
- high-cardinality, constant, sparse, duplicate-key, and likely identifier signals; and
- candidate join keys with overlap/cardinality evidence.

The complete dataset and unbounded raw values never enter agent context. Raw sample rows and likely sensitive-field values require explicit user permission. Profiling output is local generated state and must redact absolute paths from portable reports.

Profiling failure is actionable: identify the source, unsupported format/type, and failed operation; do not fabricate a schema or continue with guessed metrics.

## 5. Progressive interview and draft loop

The skill uses a progressive interview rather than either exhaustive upfront design or blind generation.

### 5.1 Initial frontier

After explaining material profile findings, ask the user for:

- audience and decisions the dashboard should support;
- authoritative metric meanings, units, and unique-entity definitions;
- default population/time window and update cadence;
- required filters and lookup behavior;
- renderer preset: `standard` or `perspective-first`;
- shell theme: `neutral` (default), `daisyui`, or explicitly requested `siemens-ix`;
- required views/interactions; and
- whether the recipient SQL playground is enabled.

Recommend concrete defaults from evidence. Ask the user only for decisions; inspect files/tools and research factual library capabilities independently.

### 5.2 First draft

Create the smallest dashboard that answers the stated decisions. Do not fill the canvas merely because component types exist. Compile and validate the project, build/extract a preview, open it in desktop Chrome, select the local sample files, and verify that visible values agree with independent profile/query evidence.

### 5.3 Feedback loop

Present the working preview and ask targeted questions about correctness, missing decisions, filters, chart choice, layout, labels, density, and theme. Edit the same YAML/SQL/CSS source, rebuild, refresh/reopen Chrome, reselect data when required, and reverify changed behavior. Git is the iteration history when available; the skill does not create a parallel `.featherbi/history` ledger.

Stop only when the user approves the draft or explicitly pauses. Final packaging reruns validation and the applicable browser checks. A successful preview does not authorize commit, push, publication, or release.

## 6. Layout and themes

### 6.1 Responsive grid

The canvas uses a 12-column desktop grid. Components declare integer `x`, `y`, `width`, and `height` within validated bounds. Layout rejects overlap unless a containing tabs/stack component explicitly owns the alternatives. At narrower breakpoints, components preserve source order and stack deterministically; mobile output must not require horizontal page scrolling.

### 6.2 Renderer preset

- `standard`: typed featherBI components using ECharts, AG Grid, Markdown/text, and filters.
- `perspective-first`: the shell and shared filter state remain featherBI-owned, while primary analytical regions use Perspective viewers with their toolbar, pivots, filters, datagrid, and chart plugins.

Renderer preset and visual theme are independent choices.

### 6.3 Theme

- `neutral`: lightweight default theme.
- `daisyui`: daisyUI-based shell/theme adapter.
- `siemens-ix`: explicit Siemens Industrial Experience shell/theme adapter; never selected implicitly from organization or data names.

Only the selected theme is bundled. Projects may provide `theme.css` as trusted author code. Build tooling scopes it to the dashboard root, rejects imports and remote URLs, preserves the artifact content-security policy, and documents that AG Grid/Perspective internals are customizable only through supported variables, parts, and adapters. CSS cannot hide required error/progress/status affordances or defeat accessibility basics.

## 7. Typed component catalog

Every component has an ID, label, query/metric binding where applicable, grid placement, and explicit empty/error behavior. Text remains escaped. No component accepts JavaScript callbacks or raw executable options.

Initial built-ins:

- content: heading, Markdown/text, divider, tabs/sections;
- metrics: KPI and compact metric group;
- ECharts: bar, line, area, scatter, pie/donut, heatmap, treemap, sankey, gauge, and boxplot;
- data: AG Grid Community table;
- exploration: Perspective viewer/table;
- author-defined recipient SQL playground; and
- filters: single-select, multi-select, exact text, date range, numeric range, boolean toggle, and option search.

ECharts options are typed per component. The contract owns supported encodings, labels, axes, series, legends, limits, and interactions; arbitrary raw option objects remain unsupported.

AG Grid uses Community features only. The contract must not expose an option that silently requires Enterprise. Tables retain bounded server/query-side paging where full materialization is unnecessary.

Perspective components receive a named bounded query result. Authors select row limits under a global row/byte/time ceiling. Oversize results fail visibly before uncontrolled browser memory growth.

## 8. Shared filtering and interaction

Shared filters retain typed bound-parameter semantics. Filter values never become SQL text.

Automatic cross-filtering is dimension-aware:

- chart and Perspective dimension selections update matching shared filters;
- an ordinary click replaces the dimension selection;
- modifier-click adds/removes values for multi-select-capable filters;
- selecting the active value again clears it;
- different dimensions combine with AND;
- compatible multiple values within one dimension combine with OR;
- a temporal brush sets the matching date range; and
- AG Grid columns opt in to cross-filter actions rather than making every row click mutate dashboard state.

Component bindings identify the dimension that an emitted value represents. If no compatible shared filter exists, the selection remains local and must not guess a target. Every interaction creates a coherent filter revision and follows existing stale-result/rollback guarantees.

Typed YAML actions may additionally open a tab or set a declared drilldown. Arbitrary event handlers and navigation scripts are unsupported.

## 9. SQL playground

When enabled, the recipient SQL playground uses CodeMirror 6 with DuckDB syntax support and completion from declared logical sources/models.

Runtime rules:

- one SELECT statement, including SELECT with CTEs;
- declared logical sources/models only;
- no file readers, local paths, URLs, extension install/load, DDL/DML, export, or multiple statements;
- independent of active dashboard filters; filters are shown for context but not silently injected;
- cancel after 30 seconds;
- return at most 10,000 rows;
- render results in AG Grid or Perspective under their own ceilings; and
- retain query/result only for the browser session.

Recipient SQL does not alter YAML, named queries, metrics, layout, or the packaged artifact. Saving/promoting a query is an authoring action performed by the agent/human against project source.

## 10. Capability-built viewer

The compiler resolves the transitive capabilities used by the project and creates a deterministic build manifest. It includes only the selected theme, component renderers, grid/editor/viewer modules, and pinned versions required by the project.

Builds with equal source, source mappings, tool versions, and inputs are byte-identical. Missing capability implementations, unsupported combinations, unresolved assets, or license-incompatible requests fail before publication. The build metadata exposes selected capabilities and pinned versions without exposing source paths.

Online pinned assets remain allowed unless a later specification adds offline delivery. Missing assets produce a visible retry/error state rather than a blank page.

## 11. External-data packaging and trust

ADR 0005 remains binding:

- dataset bytes remain outside HTML;
- final delivery is a ZIP containing `dashboard.html` plus separate safe data members;
- recipients extract, open through `file://` in supported desktop Chrome, and explicitly select the accompanying files;
- automatic sibling-file access is not claimed;
- absolute source paths, credentials, File handles, and private profile values do not enter portable source or output;
- ZIP members remain relative, traversal-safe, case-insensitively collision-free, deterministic, and failure-atomically published; and
- packaging never authorizes upload or publication.

The SQL playground does not expand the shared-data trust boundary: recipients already possess the selected files. It does expand executable query surface, so engine-backed admission, limits, cancellation, and visible failures are required.

## 12. Skill package

The existing `skill/featherbi` capability evolves rather than creating competing peer skills. Its description must trigger on requests to understand sample data, design/build dashboards, choose metrics/charts/filters, create featherBI projects, or iterate on an existing dashboard.

The ordinary path stays concise in `SKILL.md`. Progressive resources provide:

- an interview guide and decision tree;
- dashboard-project/YAML reference;
- component/filter/interaction catalog;
- metrics/model/SQL guidance;
- theme and renderer guidance;
- failure and verification procedures;
- starter project/query/theme templates; and
- deterministic scripts for profiling, compiling, validating, previewing, and packaging where repetition or fragile logic warrants code.

The skill must check current project state, preserve user files, distinguish source from generated output, and run a verify/fix/reverify loop. It never hand-generates final HTML and never silently commits data.

Skill evaluation covers positive triggers, nearby negative triggers, single- and multi-source profiling, ambiguous join handling, interview quality, YAML compilation, browser preview, feedback revision, and final external-data packaging. Human review judges dashboard usefulness and appearance; objective assertions cover structure, safety, compilation, and runtime behavior.

## 13. Migration

The v2 migration replaced runtime config v1 with contract v2 and migrated the checked AP dashboard/project. It used expand-contract sequencing:

1. introduce project/compiler and contract-v2 validation beside v1;
2. migrate runtime capabilities and the AP dashboard while both paths remain green;
3. migrate the skill, README, tests, and examples; and
4. remove v1 schema, embedded compatibility remnants, obsolete docs, and callers once no supported artifact uses them.

The final state rejects v1 rather than silently upgrading it. Archived plans remain historical.

## 14. Observable acceptance examples

- **V2-01 — Bounded understanding:** profiling a representative CSV/JSON/Parquet source produces schema/statistics/top-value evidence without emitting raw files, unbounded rows, or portable absolute paths. A likely sensitive field is not sampled without permission.
- **V2-02 — Confirmed relationships:** with two sources containing plausible keys, the skill proposes join keys/cardinality and waits for confirmation. Confirmed joins compile; an unconfirmed or fan-out-prone join does not become a model silently.
- **V2-03 — Progressive authoring:** from sample data and a short interview, the skill creates a source-only dashboard project, compiles contract v2, opens a usable Chrome preview, and changes the same YAML/SQL source in response to user feedback.
- **V2-04 — Manual edit:** a human changes a documented YAML label, layout position, filter, and query reference; compilation either rebuilds the expected preview or returns a precise source-location error.
- **V2-05 — Themes/presets:** neutral, daisyUI, and explicitly selected Siemens iX builds preserve behavior and required status/error affordances. Standard and Perspective-first presets remain independent of theme choice.
- **V2-06 — Typed catalog:** one representative dashboard exercises the approved chart families, AG Grid Community, a bounded Perspective result, tabs, and the full typed filter set without raw executable options.
- **V2-07 — Coherent cross-filter:** chart/Perspective selections update compatible filters with replace/add/clear semantics; different dimensions combine coherently; an unmapped dimension stays local; stale results never render.
- **V2-08 — SQL playground:** a valid SELECT/CTE query receives schema completion, returns a bounded AG Grid/Perspective result, and remains ephemeral. Mutation, file readers, URLs, extensions, multiple statements, timeout, and excess rows fail visibly without damaging the active dashboard.
- **V2-09 — Capability build:** two equal builds are byte-identical and contain only declared capabilities/pinned versions. A dashboard without Perspective, CodeMirror, daisyUI, or Siemens iX does not load those capabilities.
- **V2-10 — External-data delivery:** the migrated private AP dashboard packages separate Parquet data, leaks no path/data into HTML, opens under `file://`, accepts explicit selection, and reproduces the approved AP baseline in desktop Chrome.
- **V2-11 — Source hygiene:** Git status after the ordinary workflow contains only approved YAML/SQL/CSS source changes; local mappings, profiles, compiled JSON, previews, screenshots, ZIPs, and data remain ignored.
- **V2-12 — Skill quality:** realistic skill evaluations show that the skill triggers for dataset-to-dashboard work, avoids unrelated visualization/report tasks, asks material decisions, produces valid projects, and improves a draft from human feedback.

## 15. Non-goals

- remote writes, presigned-URL issuing infrastructure, non-S3/HTTPS connectors, precomputed Hyparquet cubes, or server-hosted embedding; read-only S3-compatible/HTTPS sources are owned by the [remote sources specification](remote-sources-v1.md);
- offline assets or browsers other than the explicitly supported Chrome target;
- AG Grid Enterprise;
- arbitrary/custom component plugins;
- arbitrary JavaScript, raw HTML, event handlers, or raw ECharts callbacks/options;
- unrestricted/global/network-loading CSS;
- recipient persistence of SQL/layout changes or in-browser re-export;
- automatic publication, deployment, commit, push, or release;
- inferring undocumented business meanings, units, pass/fail semantics, or entity identity; and
- proving every combination of theme, component, filter, and chart through an exhaustive matrix.

## 16. Required feasibility work

Before production implementation depends on them, run bounded disposable probes for:

1. portable large-file profiling from skill scripts;
2. DuckDB result transfer to Perspective and Perspective-first interaction under `file://`;
3. capability-built bundle composition and asset initialization for ECharts, AG Grid Community, Perspective, CodeMirror, daisyUI, and Siemens iX; and
4. scoped CSS transformation/rejection of imports and remote URLs.

Probe reports belong under `project/research/`. A successful probe is evidence, not authorization to weaken this contract or skip the staged implementation plan.

# Plan 03 — Queries and filters

> **Archived:** superseded by [`../mvp.md`](../mvp.md). Keep for historical evidence only; do not execute this decomposition.

Status: approved by the owner and pending its prerequisites. Plan 01 is integrated; Plan 02 remains subject to supervised candidate/integration approval.

- **Approval reference:** owner message on 2026-09-07: “plans look good. approved”.
- **Approved revision and scope:** `742330bb95b1a19c9ab26a33029b9a75ac470633`; RC-03 through RC-08 and AP-01/AP-04 query, filter, result, and coherent-publication scope described below.
- **Capture checkpoint:** [runtime contract §10](../../specs/runtime-contract-v1.md#10-planning-handoff), reconciled at `0d166f322ed6724ce14437fee278a542d506206b`; vocabulary is in [`CONTEXT.md`](../../../CONTEXT.md), architectural constraints are in ADR-0001 through ADR-0004, and no material capture decision remains unresolved.
- **Planning contract/provenance:** contract version 1; installed `write-implementation-plan` hash `fbad63d3b33b854f78d5d93b91bc0b756448a819f877010649fe453455689609`; installed `planning-contract` hash `671e9bf465ecf63e4030882f5e848c33aa028d271949a89a2ce776af0c89c271`.

## Goal, dependencies, and sources

Turn a validated config and staged source generation into a coherent, bounded result snapshot. No grid implementation or packaging in this plan.

Prerequisites: [Plan 01](01-contract-and-fixtures.md) and [Plan 02](02-data-loading-and-replacement.md), particularly the actual WASM AST/binding gate. Source: [runtime contract](../../specs/runtime-contract-v1.md) §§5–7. Map: RC-06 → P3.1; RC-05 → P3.2/P3.3; RC-07/RC-08 → P3.2; RC-03/RC-04 → P3.3; AP-01/AP-04 → P3.2/P3.3, completed visibly in Plan 04.

Owner clarification: every paged table has an exclusive query ID, enforced in P1.2. Compatible KPI/chart components can share a query; identical SQL under different IDs is allowed. Do not quietly broaden or weaken that rule while implementing pagination.

## Interfaces

- `admitQuery(connection, definition, config)` → `{canonicalSql, parameterOrder, sourceIds, hasOrderBy}`. Engine AST APIs receive SQL as bound data; authored SQL is not executed during admission.
- `defaultFilters(connection, config)` → `{values, bounds}`. `values` maps filter IDs to a scalar/null or `{from, through}` date range; `bounds` maps date-filter IDs to source `{min, max}` calendar timestamp strings/null for snapshot labels. Bounds are runtime metadata, never user-supplied filter values.
- `bindFilters(config, values)` → typed parameter map; `fetchOptions(connection, filter, search, offset)` → `{values, hasMore}`. Page state maps exclusive table query IDs to zero-based page numbers.
- `runQueries(connection, config, parameters, pageState)` → bounded result map plus metadata; close every owned prepared statement/stream in `finally`.
- Result envelope: `{columns: [{name, type}], rows, hasMore}`; row values retain null and exact scalar meaning. Avoid premature `JSON.stringify`/Number conversion of Arrow integers, decimals, or timestamps.
- `createController({engine, config, onState})` → `{load(inputs), replace(replacements), setFilters(values), setPage(queryId, page), snapshot(), dispose()}`.
- Published state contains active generation ID, `activeFilters: {values, bounds}`, page state, bounded results, pending/error information, and a monotonic revision. Candidate/queued requests are not published as active data.

One controller owns engine serialization. Source/filter/default/query functions do not schedule each other or import the renderer. Keep the state record and one execution loop; no general event bus, cache service, reducer framework, or pool of workers.

## P3.1 — Engine-backed query admission and binding

**Prerequisites:** P2.1 capability gate, P2.3 generation switching. **Obligation:** `new-test` — SQL structure and parameter binding are dependency/security boundaries.

**Modify:** `runtime/sql.mjs`, `tests/browser/harness.mjs`. **Create:** `tests/unit/sql.test.mjs`, `tests/browser/sql.spec.mjs`.

**Consumed interfaces:** Plan 02's generation-scoped connection and reviewed parser/parameter capability evidence. **Produced interface:** `admitQuery(connection, definition, config)` with canonical SQL, parameter order, declared source IDs, and ordering metadata.

- [ ] RED: valid SELECT, SELECT CTE, joined declared sources, quoted identifiers, repeated/reordered named placeholders, comments/semicolons inside strings; invalid multiple statements, DDL/DML, table-function/file readers, undeclared or explicitly schema/catalog-qualified sources, and placeholder mismatches.
- [ ] Parse using the pinned engine's `json_serialize_sql` with SQL passed as a bound value. Reject engine errors, statement counts other than one, unsupported statement/from-node forms, and unsupported source constructs before prepare/execution. Traverse CTE/subquery scopes correctly; an alias is not an undeclared physical source, and a CTE name must not authorize an unrelated external table.
- [ ] Use actual engine `named_param_map` ordinals to bind named values. Compare declared names without allowing declaration order to silently change which value is bound. Runtime pagination parameters use the reserved internal `__fb_` namespace, which cannot collide with user filter IDs.
- [ ] Obtain canonical SQL through the engine's deserializer using the original serialized JSON text. Do not parse/reserialize AST numeric constants through JavaScript and accidentally round large SQL literals. Tests cover strings containing semicolons/comments and trailing statement delimiters.
- [ ] Implement identifier quoting once in `runtime/sql.mjs`; runtime-owned source/options/wrapper SQL reuses it. Do not substitute user values, use a SELECT-prefix regex, or add a separate third-party SQL grammar.
- [ ] GREEN: `node --test tests/unit/sql.test.mjs`; `npm run build:harness && npx --no-install playwright test tests/browser/sql.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** rejected queries never reach authored-query execution; accepted CTE/join/parameter cases execute against the selected generation. Tests establish the supported language, not a complete malicious-SQL sandbox. If an engine construct cannot be classified safely, report the unsupported case rather than admitting it by default.

## P3.2 — Typed filter defaults and bounded results

**Prerequisites:** P3.1. **Obligation:** `new-test` — date bounds, null semantics, numeric precision, and pagination affect metric correctness.

**Create:** `runtime/filters.mjs`, `runtime/queries.mjs`, `tests/unit/filters.test.mjs`, `tests/unit/results.test.mjs`, `tests/browser/queries.spec.mjs`. **Modify:** `tests/browser/harness.mjs`.

**Consumed interfaces:** admitted queries, validated config, and a generation-scoped connection. **Produced interfaces:** `defaultFilters`, `bindFilters`, `fetchOptions`, and `runQueries` with the bounded result envelope defined above.

- [ ] RED: latest-30-date defaults anchored to the source maximum, fixed/leap-date bounds, empty input, null versus empty-string selections, exact order lookup, SQL-looking filter text, and behavior independent of the browser's timezone.
- [ ] Bind date-range boundaries as inclusive start/exclusive-next-day DATE values. Preserve AP timestamps as recorded; do not round-trip them through browser-local `Date` formatting. Option search uses a bounded parameterized source query, a stable ordering, and 100 + 1 rows; it is not an active wildcard filter.
- [ ] Execute each shared non-table query once per revision. Derive a sufficient bounded result request from its consumers (KPI cardinality check, chart cap); validate each consumer independently. A KPI cannot silently accept the first of several rows.
- [ ] Enforce chart/heatmap 10,000 + 1 and exclusive-table 100 + 1 windows inside DuckDB before Arrow crosses into main-thread JS. Canonical authored SQL is nested without changing its own LIMIT/ORDER semantics; runtime window values are bound. Validate that the pinned engine preserves deterministic authored ordering through the single-source wrapper, including an inner LIMIT, null sort keys, and later pages. Stop rather than strip ORDER BY or materialize an unbounded result to fix a failed gate.
- [ ] Results reject duplicate names, missing bindings, wrong types, duplicate heatmap coordinates, and unsafe chart integers. Tables/KPIs preserve exact integer text when needed. Null numeric values remain unavailable/gaps, not zero; null categories use a distinct internal missing-value key so a literal label such as “Missing” cannot collide.
- [ ] Query tests cover the 205-row ordered fixture across three pages, empty last page, chart at 10,000 and 10,001 rows, shared KPI/chart results, incompatible bindings, fractional numeric display, and parameter reuse. The limit sentinel is never displayed as an extra row.
- [ ] GREEN: `node --test tests/unit/filters.test.mjs tests/unit/results.test.mjs`; `npm run build:harness && npx --no-install playwright test tests/browser/queries.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** exact defaults and aggregates match fixtures; engine-to-JS transfer is bounded; page totals/order and chart overflow behavior are correct; no precision loss or silent truncation.

## P3.3 — Coherent revisions and atomic data replacement

**Prerequisites:** P3.2 and P2.3. **Obligation:** `new-test` — out-of-order work must not publish mixed data/filter states.

**Create:** `runtime/controller.mjs`, `tests/unit/controller.test.mjs`, `tests/browser/controller.spec.mjs`. **Modify:** `tests/browser/harness.mjs`.

**Consumed interfaces:** Plan 02 engine/generation lifecycle plus P3.1/P3.2 admission, filter, and query functions. **Produced interface:** `createController({engine, config, onState})` and its coherent published-state envelope.

- [ ] RED with controllable promises: request A, then B before A resolves; verify only B may become current. Inject failures during staging, defaults, query execution, result conversion, and binding validation. Assert the prior active snapshot remains available with its original filter labels.
- [ ] Use a single serialized execution loop and one replaceable pending request. Filter/page changes increment the revision; coalesce obsolete pending work. Do not attempt to cancel execution by merely abandoning a Promise and concurrently mutating the same connection.
- [ ] A page action starts a new view revision for its exclusive table query. Reuse valid non-table results for unchanged source/filter inputs; never feed a table page into a chart. Filter changes reset table pages to zero. Drop a page response if its generation/filter/revision no longer matches.
- [ ] For replacement, stage the candidate via Plan 02, run its defaults and bounded visible queries under `withGeneration`, then publish the generation/defaults/results as one state update. Only after publication retire the old generation and its resources. On failure release the candidate and restore active-schema access.
- [ ] Keep requested/pending filter state separate from active filter state so a failed update cannot label old values as new results. Initial failure has no active dashboard; replacement failure keeps the prior one. Error metadata contains source/query/component IDs, not a dump of data or filesystem paths.
- [ ] Browser integration: two-source join, two-file replacement with one invalid input, corrected retry, refreshed date defaults, rapid filter/page/replacement sequences, and repeated cleanup cycles. Disposal prevents late publication and closes the owned engine. Pure unit races are supplemented by real WASM integration, not used as the only proof.
- [ ] GREEN: `node --test tests/unit/controller.test.mjs`; `npm run build:harness && npx --no-install playwright test tests/browser/controller.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** one coherent snapshot per committed revision; no stale/mixed frames at the state boundary; active data survives invalid replacement; bounded pending work and resource ownership are demonstrated. Source/query-lifecycle review is required before the renderer depends on this interface.

## Global verification and handoff

```sh
npm run check
npm run test:browser
```

No execution result is implied by these planned commands. Use deterministic unit scheduling for race cases and actual file:// browser tests for engine/generation behavior; both must pass. No process-level cancellation SLA is invented: the current query may finish, but its obsolete output cannot publish.

Hand `createController`, state/result envelopes, typed filters, and error codes to [Plan 04](04-grid-and-ap-dashboard.md). Residual risks are visibly rendered atomicity, accessibility, full AP validation cost, final asset delivery, and authoring preflight—not unresolved parameter or generation interfaces.

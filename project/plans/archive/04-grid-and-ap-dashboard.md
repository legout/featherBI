# Plan 04 — Grid and AP dashboard

> **Archived:** superseded by [`../mvp.md`](../mvp.md). Keep for historical evidence only; do not execute this decomposition.

Status: approved by the owner and pending integrated Plans 02–03 plus supervised candidate/integration approvals.

- **Approval reference:** owner message on 2026-09-07: “plans look good. approved”.
- **Approved revision and scope:** `742330bb95b1a19c9ab26a33029b9a75ac470633`; RC-07/RC-08/RC-10 and AP-01 through AP-05/AP-07 generic-grid and AP-dashboard scope described below. AP-06 remains Plan 05 scope.
- **Capture checkpoint:** [runtime contract §10](../../specs/runtime-contract-v1.md#10-planning-handoff), reconciled at `0d166f322ed6724ce14437fee278a542d506206b`; vocabulary is in [`CONTEXT.md`](../../../CONTEXT.md), architectural constraints are in ADR-0001 through ADR-0004, and no material capture decision remains unresolved.
- **Planning contract/provenance:** contract version 1; installed `write-implementation-plan` hash `fbad63d3b33b854f78d5d93b91bc0b756448a819f877010649fe453455689609`; installed `planning-contract` hash `671e9bf465ecf63e4030882f5e848c33aa028d271949a89a2ce776af0c89c271`.

## Goal, dependencies, and sources

Render the approved reference dashboard from config and controller state, not handwritten AP-specific application logic.

Prerequisites: [Plan 03](03-queries-and-filters.md), including reviewed source/query lifecycle interfaces. Sources: [runtime contract](../../specs/runtime-contract-v1.md) §§6–7; [AP scenario](../../specs/ap-inspection-dashboard.md) in full. Map: RC-07/RC-08 → P4.1; RC-10 and AP-01 through AP-05 → P4.2/P4.3; AP-06/RC-09 are completed by Plan 05 packaging, not claimed by this plan's harness.

Use fixed Siemens iX components/theme plus ECharts, native CSS grid, and semantic HTML where iX has no suitable primitive. No React/Vue framework, arbitrary chart-option passthrough, layout editor, or new table library is needed for a 100-row page. Resolve actual installed iX exports/assets; do not assume brainstorm tags such as `ix-kpi` exist.

## P4.1 — Declarative grid, filters, charts, and paged table

**Prerequisites:** P3.3. **Obligation:** `new-test` — binding, accessibility, and visible revision coherence need rendered-browser evidence.

**Create:** `shells/grid.html`, `runtime/grid.mjs`, `runtime/viewer.mjs`, `runtime/viewer.css`, `scripts/build.mjs`, `tests/browser/grid.spec.mjs`. **Modify:** `package.json`, `package-lock.json`, `tests/browser/harness.mjs`, `scripts/build-test-harness.mjs`.

**Consumed interfaces:** validated config plus Plan 03's controller/state/result envelopes. **Produced interfaces:** `mountGrid(root, config, controller)` wires user actions and returns `{render(state), dispose()}`. `startViewer(root, rawConfig)` validates config, starts the engine/controller, mounts the grid, connects `onState` to `grid.render`, and reports boot failures. Test hooks stay in the test harness, never the production viewer.

- [ ] Add exact ECharts 6.1.0, Siemens iX 5.2.1, and iX icons 3.5.0 pins; verify peer compatibility and actual asset entry points before installation. If these published pins conflict, report the dependency gate rather than silently selecting another version.
- [ ] RED: config-driven KPI/bar/line/heatmap/table, wrong binding, zero/null/empty cases, source controls, shared filters, independent table paging, and a pending/failed revision retaining clearly labeled prior results. Include the rejected table-query-sharing config from P1.2.
- [ ] Build only viewer-owned JS/CSS into `build/viewer.js` and `build/viewer.css`; fixed versioned runtime assets may remain CDN-hosted. Emit `build/runtime-assets.json` listing exact external URLs and versions. Pin every dynamically loaded iX/worker/icon asset as well as top-level tags. `npm run build` runs contract generation and `node scripts/build.mjs`; it does not package data or publish anything. Once this build exists, update `check` to `npm run fixtures && npm run build && npm run test:unit` so a clean checkout creates every generated import before unit checks; `build` must not call `check`.
- [ ] Verify iX/ECharts loading and styling from file:// early in this task. Stencil lazy-loading, CSS/fonts/icons, and ESM asset paths were not covered by the original probe. Display meaningful boot failure/retry behavior outside the dependency code so failure cannot leave a blank page.
- [ ] Render components from the bounded result envelope. Query labels remain plain text; tooltips do not accept formatter code/HTML. Distinguish missing categories internally from literal strings with the same display label. Use the engine-provided calendar strings without browser-local time shifting.
- [ ] Wire select/text/date controls to controller methods: 250 ms text/search debounce, explicit select/date Apply, and explicit Clear to null. Clearing to “all” must remain distinguishable from applying an exact empty string. Keep selected values visible outside the current 100-value options page.
- [ ] Show file-to-source assignments and explicit Apply for staged replacements. Reflect initial missing data, candidate validation progress, success/default reset, and rollback errors. Never silently auto-map an ambiguous dropped file.
- [ ] Build/validate the next visible presentation before replacing the current one; apply one committed controller revision in a single render update. Rendering failures must not relabel old chart values with new filter state. Dispose obsolete chart instances/listeners.
- [ ] GREEN: `npm run build && npm run build:harness && npx --no-install playwright test tests/browser/grid.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** config drives all required primitives; keyboard/focus/accessible labels work; nulls and errors remain visible; paging never creates thousands of DOM rows; same-query KPI/chart fanout does not rerun SQL. Inspect and retain a real Chrome screenshot as well as DOM assertions. No claim of packaged-artifact completion yet.

## P4.2 — AP config and synthetic acceptance dashboard

**Prerequisites:** P4.1. **Obligation:** `new-test` — authoritative AP semantics must be embodied in queries/config, not only prose.

**Create:** `examples/ap-dashboard.config.json`, `tests/browser/ap-dashboard.spec.mjs`. **Modify:** `tests/fixtures/expected.json`, `tests/fixtures/generate.py` only for additional synthetic AP cases; `tests/browser/harness.mjs` to load the public example config.

**Consumed interfaces:** contract v1 and `startViewer`; no AP-specific renderer branch. **Produced:** reusable authored AP config with all required views and filters.

- [ ] RED: synthetic exact KPI expectations; latest-30-calendar-date default; date range follows dataset maximum rather than today; source/station/product/order filters update every relevant view; empty selection semantics; top-10-plus-Other reconciliation.
- [ ] Use source ID `ap` and declare the eight AP schema fields from the approved scenario; preserve nullable product/code/last-flag semantics and lexical order/sequence IDs. The example config contains a basename hint only, never `/Users/volker/...`.
- [ ] Use query IDs `q_summary`, `q_daily`, `q_stations`, `q_products`, `q_codes`, `q_heatmap`, and exclusive `q_details`. One summary row supplies eight single-value KPI cards: four count metrics plus count and percentage cards for each of the two diagnostic metrics. Remaining queries supply daily source-split records, station ranking, top products plus Other, code frequency, station/day heatmap, and detail rows. Filter IDs are `period`, `source`, `station`, `product`, and `order`. Each relevant query binds the shared filters; do not sum distinct counts from groups or infer failure/retest/utilization.
- [ ] Use an explicit source-transition annotation at 2023-11-22 and show the last date as potentially incomplete. The date control's source bounds/default metadata supplies the snapshot-end label; it is not hardcoded to August 2026.
- [ ] Detail rows include timestamp, order, product, station, source, sequence, code, and last flag. Use deterministic ordering with sufficient tie-breakers; exact duplicate records may display identically but cannot cause missing or repeated non-identical rows across pages.
- [ ] Test timezone invariance, station selection, quoted/empty order lookup, product search with a selected off-page value, missing product labels, code-null exclusion, and filtered top-N/Other totals. Cover all AP semantics with synthetic data so normal CI never needs the real file.
- [ ] GREEN: `npm run fixtures && npm run build && npm run build:harness && npx --no-install playwright test tests/browser/ap-dashboard.spec.mjs --project=chrome`; then `npm run check && npm run test:browser`.

**Completion evidence:** the same generic viewer renders the whole approved AP scenario, with documented labels and consistent filter populations. AP-01 through AP-05 pass synthetically; AP-06 is reserved for packaged-artifact tests.

## P4.3 — Private full-file acceptance and operational evidence

**Prerequisites:** P4.2. **Obligation:** `new-test` — the actual dataset must exercise the implemented loader/validator/controller, not the discarded prototype.

**Create:** `tests/browser/ap-private.spec.mjs`, `scripts/test-ap.mjs`. **Modify:** `package.json`.

**Consumed interfaces:** the generic viewer, AP example config, private-path gate, and Plan 03 controller/result envelopes. **Produced evidence:** bounded private full-file acceptance results for AP-02/AP-03/AP-07 and RC-10; no new product interface.

- [ ] Implement an explicit private-test entry point. `npm run test:ap` builds the viewer/harness and runs `node scripts/test-ap.mjs`; the script requires `FEATHERBI_AP_PATH`, checks that the file exists, and runs only Playwright tests tagged `@private`. Missing private input is a nonzero blocked result for this command, never a green skip or a synthetic fallback.
- [ ] The normal `test:browser` script excludes `@private`; retain that exclusion explicitly in reports. The private file and any full data export stay outside Git and public CI.
- [ ] RED: assert known file row count and the AP baseline against the completed input-validation and rendering path before changing code to make them pass. If the owner's file has changed, report the mismatch and get a new baseline approved; never rewrite expected values from failing results.
- [ ] Verify 5,384,125 total rows; default-window metrics 34,596 / 11,151 / 4,618 / 27; code presence 3,105 (8.98%); non-last 2,120 (6.13%); SJ = 2,585 and SD = 2,476. Check full-history distinct totals and one filtered subset against an independently executed reference query.
- [ ] Record source registration, complete declared-column validation, first/repeat filter/query, render, and replacement timings separately. Capture actual Chrome/engine versions and host characteristics. Distinguish main-thread heap, tracked DuckDB allocations, process RSS, and unmeasured peak memory.
- [ ] Test a failed compatible-data replacement without losing the active AP dashboard, a later valid retry, and at least one page/search interaction on real cardinalities. Capture bounded screenshots/results only; no raw AP rows in committed evidence.
- [ ] GREEN: `FEATHERBI_AP_PATH=/Users/volker/data/ewn/ap_unified.parquet npm run test:ap`; then `npm run check && npm run test:browser`. Save local private-run evidence under `.artifacts/private/` and summarize results without making an SLA from one machine.

**Completion evidence:** AP-07 and RC-10 are measured on the actual implementation; all baseline and visible checks pass. Full-column validation may cost much more than the probe's recent-window query; report it honestly instead of weakening validation.

## Global verification and handoff

```sh
npm run check
npm run build
npm run test:browser
FEATHERBI_AP_PATH=/Users/volker/data/ewn/ap_unified.parquet npm run test:ap
```

These gates are prospective. Missing Chrome/CDN access/private data is reported with the exact failed command; do not substitute another browser or native-only SQL. The owner removed Edge work, so it is neither run nor an outstanding gate.

Hand the example config, viewer bundle/shell, pinned runtime-asset manifest, controller, and evidence to [Plan 05](05-packaging-and-agent-skill.md). Remaining release functionality is deterministic authoring/preflight, safe output construction, package reopening, and the skill—not more rendering primitives.

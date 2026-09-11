# featherBI MVP plan

**Goal:** open a config → see a dashboard → filter → replace data → share a single HTML file. Working end to end beats complete.

**Sources:** behavior = [runtime contract v1](../specs/runtime-contract-v1.md); constraints = ADRs 0001–0004; deferred hardening = [deferred.md](deferred.md). Supersedes the per-phase plans in [archive/](archive/) (Plans 01/02 P2.1 remain merged and valid).

**Execution:** one step at a time, in the working tree. After each step: `npm run check` (+ `npm run test:browser` for S1–S4), one commit, owner reviews the diff.

**Test rule:** a step adds at most 1–2 browser tests and only touches unit tests when it adds hand-written logic. Do not test libraries.

---

## S1 — Load and normalize inputs

`runtime/sources.mjs` + harness wiring. Register File/embedded bytes in the worker, register Parquet/CSV/JSON/NDJSON, create typed views for the declared schema. Reject with a visible, actionable error: duplicate or case-colliding headers, missing declared columns, unreadable file. Keep it simple: load, cast declared columns, surface errors — no generation staging machinery yet (single active generation; full replacement = re-register, see S2 note).

**Test:** one browser test loading the synthetic `inspections` fixtures through the real engine (row count = `expected.json.canonical.rowCount`, join with `products` matches `expected.join.allRows`) and one rejection case (missing declared column).

## S2 — Queries, filters, replacement

`runtime/queries.mjs`: bind named params as typed values, run named SELECT queries. Admission = reject multi-statement / non-SELECT (statement count + top node via `json_serialize_sql`, already proven in P2.1). Bounded results: `LIMIT n+1` on chart/table queries, reject oversize visibly. Replacement: register candidate under fresh physical names, swap on success, drop on failure — no 20-cycle ceremony, one test proves a failed replacement keeps the old data.

**Test:** one browser test — run the join query with a quoted/station param from `expected.json` values, verify counts; replace with an invalid file, assert old results still served and a clear error is shown.

## S3 — Grid dashboard UI

`viewer/` (single bundle): renders config layout as KPI cards, bar/line charts (ECharts via CDN), paged table (100/page), filter controls (select, text, date-range) bound to query params. Plain CSS or Siemens iX via CDN — whichever is fewer lines. Errors and boot status visible in-page. A static `examples/ap-dashboard.config.json` drives it from the synthetic fixtures.

**Test:** one e2e — build viewer + example config, open over `file://`, assert the KPI number from `expected.json` and one chart label render.

## S4 — Package and authoring skill

`scripts/build-dashboard.mjs` (the CLI): validates config via `contract/config.mjs`, then emits **embedded mode** (config + data base64-inlined, single HTML) and **zip mode** (HTML + data files side-by-side). Reopen check: the build script's `--verify` reopens the artifact in headless Chrome and asserts the KPI renders. Authoring skill: `skills/featherbi-authoring/SKILL.md` — instructs an agent to write config JSON + run the CLI; never hand-generate dashboard HTML.

**Test:** extend the e2e to open the produced embedded artifact and assert the same KPI. One `</script>`-in-data case inlined as text.

---

## Definition of done

Owner runs `node scripts/build-dashboard.mjs --config examples/ap-dashboard.config.json --data /path/to/ap.parquet` on the real private file and the dashboard works in Chrome by double-click. Deferred items stay in `deferred.md`.

# Interview guide

Ask questions in frontier order and only when the answer changes the dashboard. Inspect files and research library facts yourself; ask the user only for decisions and meanings.

## Initial frontier (after profiling)

1. **Audience and decisions** — who opens it and what choice it supports.
2. **Metrics and grain** — authoritative meaning, units, and unique-entity definition per metric; one row = what? Never infer failure, yield, utilization, currency, or identity from column names.
3. **Population and cadence** — default time window (e.g. last 30 days ending at the newest record), update expectations.
4. **Filters and lookups** — which dimensions need single/multi-select, search, ranges, or exact text.
5. **Renderer preset** — `standard` (default) or `perspective-first`; keep the shell featherBI-owned either way.
6. **Theme** — `neutral` (default), `daisyui`, or explicitly requested `siemens-ix`; never pick Siemens iX from a company name.
7. **Views and interactions** — which charts, tables, cross-filtering, brushes, or recipient SQL playground.
8. **Appearance** — layout density, labels, ordering, only after the analytical content is agreed.

## Relationships

Profile-evidenced keys are proposals, not facts. Before generating any model or query with a JOIN, confirm with the user: the two sources, both keys, and the expected cardinality (e.g. many-to-one). An unconfirmed join must fail compilation rather than silently render wrong numbers. Prefer asking twice over guessing once.

## Empty and edge answers

When the user says "you decide", choose the evidence-backed default, state it as your choice, and continue — do not stall. When evidence contradicts the user's assumption (for example a column is 99% null), show the evidence and ask again.

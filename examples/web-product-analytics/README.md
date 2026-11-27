# Web and product analytics

2 000 sessions over 14 days: `sessions.parquet` (`session_id`, `day`, `source`, `pages`, `converted`).
Playbook: `skill/featherbi/references/domains/web-product-analytics.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 1999): `day = 2025-03-01 + (i mod 14)` days; `source` by i mod 4 (Search, Direct, Social, Email);
`pages = 1 + i mod 5`; `converted = 1` when i mod 25 = 4 (those sessions have 5 pages).

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Sessions | `2,000` | rows 0 … 1999 |
| Bounce rate % | `20` | pages = 1 when i mod 5 = 0: 400 of 2 000 |
| Pages per session | `3` | mean of 1 … 5 over complete cycles of five rows |
| Conversion rate % | `4` | i mod 25 = 4 gives 80 of 2 000 |

Funnel check: 2 000 sessions, 1 200 with 3+ pages (i mod 5 ≥ 2), 80 converted.

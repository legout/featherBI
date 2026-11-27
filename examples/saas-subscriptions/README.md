# SaaS subscriptions

300 subscriptions: `subscriptions.parquet` (`customer`, `plan`, `mrr`, `started`, `status`).
Playbook: `skill/featherbi/references/domains/saas-subscriptions.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 299): `plan` by i mod 3 (Basic 10, Pro 30, Team 100 per month); `started = 2025-01-01 + (i mod 6)` months;
`status = churned` when i mod 5 = 0, else `active`. Plan and status repeat every 15 rows, and each of the
3 × 5 combinations occurs once per cycle (3 and 5 are coprime).

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Subscriptions | `300` | rows 0 … 299 |
| Active subscriptions | `240` | 4 of every 5 rows (i mod 5 ≠ 0) |
| MRR | `11,200` | per 15-row cycle 4 active per plan: 4 · (10 + 30 + 100) = 560; 20 cycles |
| Churned share of all % | `20` | i mod 5 = 0 gives 60 churned of 300 ever started (a snapshot share, not a rate over time) |

Bar check: active MRR by plan is Basic 800, Pro 2 400, Team 8 000 (80 active per plan).

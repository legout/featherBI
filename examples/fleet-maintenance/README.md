# Fleet and maintenance

400 work orders over 60 days: `work_orders.parquet` (`work_order_id`, `vehicle`, `opened`, `job`, `cost`,
`downtime_days`, `preventive`). Playbook: `skill/featherbi/references/domains/fleet-maintenance.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 399): `vehicle = V(i mod 8 + 1)`; `opened = 2025-01-01 + (i mod 60)` days; `job` by i mod 4
(Oil, Brakes, Tires, Engine); `cost = 100 + 50 · (i mod 8)` (100 … 450); `downtime_days = 1 + i mod 4`;
`preventive = 1` when i mod 5 = 0.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Work orders | `400` | rows 0 … 399 |
| Maintenance cost | `110,000` | 50 cycles of eight rows, each 100 + 150 + … + 450 = 2 200 |
| Average cost per order | `275` | 110 000 / 400 (mean of 100 … 450) |
| Downtime days | `1,000` | 100 cycles of four rows, each 1 + 2 + 3 + 4 = 10 |
| Preventive share % | `20` | i mod 5 = 0 gives 80 of 400 |

Pareto check: job t = i mod 4 collects costs 100 + 50t and 300 + 50t per eight rows, so 50 · (400 + 100t):
Oil 20 000, Brakes 25 000, Tires 30 000, Engine 35 000 (sum 110 000); `Engine` leads.

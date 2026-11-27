# Logistics

1 200 shipments over 30 days: `shipments.parquet` (`shipment_id`, `ship_date`, `carrier`, `region`, `weight_kg`,
`transit_days`, `promised_days`, `on_time`). Playbook: `skill/featherbi/references/domains/logistics.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 1199): `ship_date = 2025-03-01 + (i mod 30)` days; `carrier` by i mod 3 (Alpha, Beta, Gamma);
`region` by i mod 4 (North, South, East, West); `weight_kg = 5 + 5 · (i mod 6)` (5 … 30);
`transit_days = 1 + i mod 5`; `promised_days = 3`; `on_time = 1` when `transit_days ≤ 3`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Shipments | `1,200` | rows 0 … 1199 |
| On-time % | `60` | transit 1, 2, 3 are on time: 3 of every 5 rows |
| Late shipments | `480` | transit 4 and 5: 2 of every 5 rows, 240 cycles × 2 |
| Average transit days | `3` | mean of 1 … 5 |
| Weight kg | `21,000` | 200 cycles of six rows, each 5 + 10 + … + 30 = 105 |

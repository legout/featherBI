# Energy / smart meter

Four meters, quarter-hour readings for a week: 2 688 rows in `readings.parquet` (`read_at`, `meter`, `kwh`
per interval). Playbook: `skill/featherbi/references/domains/energy-smart-meter.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 2 687): `meter = M(i mod 4 + 1)`, `slot = i div 4` (0 … 671),
`read_at = 2025-03-03 00:00 + 15 · slot minutes`, `hour = (slot mod 96) div 4`,
`kwh = (100 + 50 · (i mod 4) + 10 · hour) / 1000`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Intervals | `2,688` | 4 meters × 672 |
| Peak demand kW | `1.92` | highest kwh is M4 at hour 23: (100 + 150 + 230) / 1000 = 0.48 kWh per 15 min, × 4 |
| Meter M1 kWh | `144.48` | one day: 4 · (24 · 100 + 10 · (0 + … + 23)) = 20 640 Wh = 20.64 kWh; × 7 days |
| Consumption kWh | `779.52` | meter m has 144.48 + 33.6 · m (one day adds 4 · 24 · 50 · m = 4.8 · m kWh); sum over m = 0 … 3 is 4 · 144.48 + 33.6 · 6 |

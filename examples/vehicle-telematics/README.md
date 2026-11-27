# Vehicle telematics

600 trips over 30 days: `trips.parquet` (`trip_id`, `vehicle`, `trip_date`, `distance_km`, `harsh_brakes`,
`idle_min`, `max_speed_kmh`). Playbook: `skill/featherbi/references/domains/vehicle-telematics.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 599): `vehicle = V(i mod 6 + 1)`; `trip_date = 2025-03-01 + (i mod 30)` days;
`distance_km = 10 + 5 · (i mod 8)` (10 … 45); `harsh_brakes = i mod 5`; `idle_min = i mod 10`;
`max_speed_kmh = 60 + 10 · (i mod 6)`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Trips | `600` | rows 0 … 599 |
| Distance km | `16,500` | 75 cycles of eight rows, each 10 + 15 + … + 45 = 220 |
| Average trip km | `27.5` | 16 500 / 600 (mean of 10 … 45) |
| Harsh brakes | `1,200` | 120 cycles of five rows, each 0 + 1 + 2 + 3 + 4 = 10 |
| Idle minutes | `2,700` | 60 cycles of ten rows, each 0 + 1 + … + 9 = 45 |

# Weather

Three stations, 90 days of daily observations: `observations.parquet` (270 rows: `station`, `day`, `temp_c`, `precip_mm`).
Playbook: `skill/featherbi/references/domains/weather.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 269): `station` by i mod 3 (Coast, Valley, Peak); `d = i div 3` (0 … 89), `day = 2025-01-01 + d` days;
`temp_c = [10, 14, 2][station] + d mod 10`; `precip_mm = [4, 2, 8][station]` when d mod 6 = 5, else 0.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Observations | `270` | 3 stations × 90 days |
| Average °C | `13.17` | mean of d mod 10 is 4.5 (9 full cycles); mean of the bases is 26 / 3; 8.667 + 4.5 = 13.167 |
| Maximum °C | `23` | Valley 14 + 9 |
| Minimum °C | `2` | Peak 2 + 0 |
| Precipitation mm | `210` | wet days d = 5, 11, … 89 are 15 per station; 15 · (4 + 2 + 8) |

Bar check: precipitation by station is Coast 60, Valley 30, Peak 120.

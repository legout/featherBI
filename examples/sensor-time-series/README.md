# Sensor time series

Four temperature sensors, one reading per minute for a day: 5 760 rows in `readings.parquet`
(`ts`, `sensor`, `temp_c`). Playbook: `skill/featherbi/references/domains/sensor-time-series.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 5 759): `sensor = S(i mod 4 + 1)`, `minute = i div 4` (0 … 1 439),
`ts = 2025-03-01 00:00 + minute minutes`, `temp_c = 20 + (i mod 4) + (minute mod 60) / 10`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Readings | `5,760` | 4 sensors × 1 440 minutes |
| Maximum °C | `28.9` | sensor S4 (offset 3) at minute 59 of an hour: 20 + 3 + 5.9 |
| Minimum °C | `20` | sensor S1 (offset 0) at minute 0 of an hour |
| Average °C | `24.45` | 20 + mean offset 1.5 + mean of (0 … 59) / 10 = 2.95 |

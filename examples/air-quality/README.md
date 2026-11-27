# Air quality

Three stations, 14 days of hourly PM2.5 (µg/m³): `readings.parquet` (1 008 rows: `station`, `read_at`, `pm25`).
Playbook: `skill/featherbi/references/domains/air-quality.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 1 007): `station` by i mod 3 (Downtown 30, Suburb 20, Park 10); `h = i div 3` (0 … 335),
`read_at = 2025-03-03 00:00 + h` hours; `pm25 = base + h div 24` plus 20 at hours 7–9, plus 10 at hours 17–19, else plus 0.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Readings | `1,008` | 3 stations × 336 hours |
| Average PM2.5 | `30.25` | base mean 20, day offset mean 6.5, rush-hour mean (3 · 20 + 3 · 10) / 24 = 3.75 |
| Peak PM2.5 | `63` | Downtown 30 + day 13 + 20 at hour 7–9 |
| Minimum PM2.5 | `10` | Park 10 + day 0 + 0 |
| Hours above 35 | `318` | per station, readings with base + day offset + rush > 35 over 14 days: Downtown 144 + 42 + 42 = 228, Suburb 24 + 42 = 66, Park 24 |

Bar check: hours above 35 by station are Downtown 228, Suburb 66, Park 24.

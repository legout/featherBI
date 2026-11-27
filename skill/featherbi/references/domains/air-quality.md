# Air quality

Playbook for brainstorming mode. Example: `examples/air-quality/`.

## Detection signals

A `station`, an hourly timestamp (`read_at`), a pollutant column (`pm25`, `pm10`, `no2`, `o3`) in µg/m³. Grain: one row per station per hour.

## Interview questions

- Which pollutant? Default: PM2.5.
- Which threshold applies (WHO, EU, a local one)? Default: 35 µg/m³ as an hourly alert level; ask for the real one.
- Which stations, or all? Default: all.
- Hourly or daily view? Default: daily average line, hourly pattern heatmap.
- Is a period given? Default: all data.

## Figures

```sql
SELECT COUNT(*) AS readings FROM readings;
SELECT AVG(pm25) AS avg_pm25, MAX(pm25) AS peak_pm25 FROM readings;
SELECT COUNT(*) AS hours_above FROM readings WHERE pm25 > 35;
SELECT station, COUNT(*) AS hours_above FROM readings WHERE pm25 > 35 GROUP BY 1 ORDER BY 1;
SELECT station, hour(read_at) AS hr, AVG(pm25) AS avg_pm25 FROM readings GROUP BY 1, 2 ORDER BY 1, 2;
```

## Tile ideas

- KPIs: average, peak, hours above the threshold. How bad did it get?
- `line` of daily average by station. Which station and which days?
- `heatmap` of station by hour of day. When is it worst (rush hours)?
- `bar` of hours above the threshold by station (`click: station`). Who exceeds most?

## Traps

- Limits are defined on 24-hour or annual averages, not on single hours; say which one a figure uses.
- Averaging across stations hides the worst station; show them separately.
- Gaps from sensor outages must not count as clean air; check the reading count per station.
- Units differ (µg/m³ vs ppb); never mix pollutants on one axis.
- Time zones and daylight saving shift the hourly pattern.

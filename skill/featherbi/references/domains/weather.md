# Weather

Playbook for brainstorming mode. Example: `examples/weather/`.

## Detection signals

A `station`/`city`, a day or timestamp, `temp_c`/`temperature`, `precip_mm`/`rain`, maybe `wind`, `humidity`. Grain: one row per station per day.

## Interview questions

- Which stations matter, or all? Default: all.
- Daily values or hourly? Default: as given.
- Is temperature in °C? Default: °C; ask when values exceed 60.
- Which question: trend, extremes or rain totals? Default: extremes and rain totals.
- Is a period given? Default: all data.

## Figures

```sql
SELECT COUNT(*) AS observations FROM observations;
SELECT AVG(temp_c) AS avg_c, MAX(temp_c) AS max_c, MIN(temp_c) AS min_c FROM observations;
SELECT SUM(precip_mm) AS sum_of_station_totals FROM observations;
SELECT SUM(precip_mm) / COUNT(DISTINCT station) AS mean_station_total FROM observations;
SELECT station, SUM(precip_mm) AS precipitation FROM observations GROUP BY 1 ORDER BY 1;
SELECT station, COUNT(DISTINCT CAST(day AS DATE)) FILTER (WHERE precip_mm > 0) AS wet_days FROM observations GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: average, maximum, minimum temperature and precipitation. Title it "Precipitation, sum of station totals mm" or use the mean station total; no gauge received the sum. What was the range?
- `line` of daily temperature by station. How do they trend?
- `bar` of precipitation by station (`click: station`). Where did it rain?
- `histogram` of temperature. What is typical?

## Traps

- Precipitation depths of several gauges are not one catchment depth; name the statistic. Precipitation is summed over time, temperature is averaged; never swap them.
- A mean of daily means differs from the mean of hourly values when hours are missing.
- Fahrenheit or Kelvin data mixed with °C.
- A missing observation is NULL, not 0 mm; a sentinel such as -999 must be removed first.
- Stations at different heights are not comparable without saying so.

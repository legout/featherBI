# Sensor time series

Playbook for brainstorming mode. Example: `examples/sensor-time-series/`.

## Detection signals

A timestamp column at a fixed step (profile `step`), a sensor or device id with few distinct values, one or more numeric readings (`temp_c`, `pressure`, `value`). Grain: one row per sensor per interval.

## Interview questions

- Who watches it: operators (live-ish) or engineers (trends)? Default: engineers.
- Which reading matters most, and what range is normal? Default: the first numeric column, observed min to max.
- Which time grain: raw, hourly or daily? Default: hourly.
- Compare sensors, or look at one at a time? Default: compare.
- Is there an alarm limit to mark? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS value FROM readings;
SELECT AVG(temp_c) AS value FROM readings;
SELECT MAX(temp_c) AS value FROM readings;
SELECT sensor, MAX(ts) AS last_seen FROM readings GROUP BY 1 ORDER BY 1;
SELECT strftime(ts, '%H:00') AS x, ROUND(AVG(temp_c), 2) AS y, sensor AS series
FROM readings GROUP BY 1, 3 ORDER BY 3, 1;
```

## Tile ideas

- KPIs: readings, average, maximum, minimum. Which level, and how far did it go?
- `line` of the hourly average per sensor (`click: sensor`, `exclude: [sensor]`). How do sensors differ over time?
- `histogram` of the reading, bins by `floor`. Where does the signal spend its time?

## Traps

- Raw rows at 1 s over weeks exceed the 25 MB snapshot limit: downsample in the source SQL (hourly `AVG`, `MIN`, `MAX`).
- Averages hide spikes: keep `MAX` next to `AVG`.
- Time zone: timestamps are shown as stored; say whether they are UTC.
- Gaps (a sensor offline) look like zero in a daily SUM; use `AVG`.
- Units: Celsius vs Fahrenheit, never mix sensors in one axis without checking.

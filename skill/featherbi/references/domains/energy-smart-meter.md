# Energy / smart meter

Playbook for brainstorming mode. Example: `examples/energy-smart-meter/`.

## Detection signals

A `meter` or `mpan`/`device` id, an interval timestamp at 15 or 60 minutes, `kwh` (energy per interval) or a growing register value. Grain: one row per meter per interval.

## Interview questions

- Who uses it: facility manager, household, utility analyst? Default: facility manager.
- Energy or demand: kWh totals or peak kW? Default: both.
- Is there a tariff (peak/off-peak hours, price per kWh)? Default: none; never invent a price.
- Compare meters or look at the site total? Default: compare meters.
- What time grain: day, hour of day, or the interval? Default: day plus hour of day.

## Figures

```sql
SELECT SUM(kwh) AS value FROM readings;
SELECT MAX(kwh) * 4 AS value FROM readings;
SELECT meter, SUM(kwh) AS kwh FROM readings GROUP BY 1 ORDER BY 1;
SELECT meter, hour(read_at) AS hr, SUM(kwh) AS kwh FROM readings GROUP BY 1, 2 ORDER BY 1, 2;
SELECT strftime(read_at, '%Y-%m-%d') AS day, SUM(kwh) AS kwh FROM readings GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: consumption, peak demand, intervals. How much, how high?
- `line` of daily consumption per meter. Trend and anomalies?
- `heatmap` of meter by hour of day. When is the load?
- `bar` of consumption by meter (`click: meter`). Which meter dominates?

## Traps

- kWh per 15 minutes × 4 is kW; a 60-minute interval is already kW. Check the interval (profile `step`).
- Cumulative registers: use the difference between readings, and handle resets and rollover.
- Daylight-saving days have 23 or 25 hours; missing intervals understate sums.
- The `featherbi` number format shows two decimals; the `kpi` title carries the unit.
- 15-minute data of many meters exceeds the 25 MB limit: aggregate to hourly in the source SQL.

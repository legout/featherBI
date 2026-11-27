# OEE and downtime

Playbook for brainstorming mode. Example: `examples/oee-downtime/`.

## Detection signals

Per machine and shift: planned and run minutes, produced and scrap counts, an ideal rate. Or stop rows with `start`, `end` and a `reason`. Grain: one row per machine shift, one per stop.

## Interview questions

- Who is it for: shift lead or plant manager? Default: plant manager.
- Is the ideal rate in the data? Default: use the column; if absent, say OEE cannot be computed.
- Do planned stops (changeover, breaks) count as downtime? Default: yes, with their own reason.
- Break down by machine, line or shift? Default: machine.
- Which reasons are known, and is a target OEE given? Default: none; never invent one.

## Figures

Precondition: the product availability × performance × quality equals OEE only within one ideal rate. With mixed rates, group by `ideal_per_min` (the grouped recipe below) and report one OEE per rate. Group by machine only when that machine's rate is constant. Example: M1 480 planned, 240 run at 2/min, 480 produced; M2 480 planned, 480 run at 1/min, 480 produced. Together availability 75 %, performance 100 %, but OEE 66.7 %; per rate, 50 % and 100 %.

```sql
SELECT 100.0 * SUM(run_min) / SUM(planned_min) AS availability FROM shifts;
SELECT 100.0 * SUM(produced) / SUM(run_min * ideal_per_min) AS performance FROM shifts;
SELECT 100.0 * SUM(produced - scrap) / SUM(produced) AS quality FROM shifts;
SELECT 100.0 * SUM(produced - scrap) / SUM(planned_min * ideal_per_min) AS oee FROM shifts;
SELECT ideal_per_min, 100.0 * SUM(produced - scrap) / SUM(planned_min * ideal_per_min) AS oee FROM shifts GROUP BY ideal_per_min ORDER BY 1;
SELECT reason, SUM(date_diff('minute', start_at, end_at)) AS minutes FROM downtime GROUP BY 1 ORDER BY 2 DESC;
```

## Tile ideas

- KPIs: availability, performance, quality, OEE, downtime minutes. Where is the loss?
- `pareto` of downtime minutes by reason. Which reason to attack first?
- `timeline` of stops per machine, coloured by reason. When and how long?
- `bar` of OEE by machine. Which machine lags?

## Traps

- Mixed ideal rates: group by `ideal_per_min`; by machine only when its rate is constant (see Figures).
- OEE = availability × performance × quality only when each is a ratio of sums; never average percentages across machines or days.
- Performance above 100 % means a wrong ideal rate.
- Stops that cross midnight: filter by start time and say so.
- The time column of a stop table is a timestamp and the shift table's a date: map them with `date.cols`.
- Timeline times are shown in UTC; state the plant's zone.

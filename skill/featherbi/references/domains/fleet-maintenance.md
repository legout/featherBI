# Fleet and maintenance

Playbook for brainstorming mode. Example: `examples/fleet-maintenance/`.

## Detection signals

A `vehicle`/`asset` id, a work order id, an opened date, a `job`/`type`, `cost`, `downtime_days`, maybe a `preventive` flag. Grain: one row per work order.

## Interview questions

- Who is it for: fleet manager, workshop lead or finance? Default: fleet manager.
- Is cost parts, labour or both? Default: the column as given; say which.
- Preventive versus corrective: which column says it? Default: a `preventive` flag if present.
- Break down by vehicle, job or both? Default: job.
- Is a budget given? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS work_orders FROM work_orders;
SELECT SUM(cost) AS cost FROM work_orders;
SELECT AVG(cost) AS average_cost FROM work_orders;
SELECT SUM(downtime_days) AS downtime_days FROM work_orders;
SELECT 100.0 * SUM(preventive) / COUNT(*) AS preventive_share FROM work_orders;
SELECT job, SUM(cost) AS cost FROM work_orders GROUP BY 1 ORDER BY 2 DESC;
```

## Tile ideas

- KPIs: work orders, cost, average cost, downtime days, preventive share. What does the fleet cost us?
- `pareto` of cost by job. Which jobs carry the cost?
- `bar` of downtime days by vehicle. Which vehicles are off the road?
- `line` of cost by day. Is spend rising?

## Traps

- Cost per vehicle needs the fleet size; a vehicle without orders has zero, not a missing row.
- Several jobs on one work order: count distinct work orders, not lines.
- Downtime days overlap when orders overlap; do not read the sum as calendar days.
- Warranty and internal charges: say whether they are in cost.
- Average of per-vehicle averages is not the fleet average; divide sums.

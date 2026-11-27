# Logistics

Playbook for brainstorming mode. Example: `examples/logistics/`.

## Detection signals

A `shipment_id`, a ship date, `carrier`, `region`/`lane`, `weight_kg`, `transit_days` or ship and delivery timestamps, a promised date or `on_time` flag. Grain: one row per shipment.

## Interview questions

- Who is it for: dispatcher, carrier manager or customer service? Default: carrier manager.
- On time against what: the promised date or a fixed number of days? Default: the promised date column.
- Does the clock count weekends? Default: calendar days; say so.
- Break down by carrier, region or lane? Default: carrier.
- Is a service level target given? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS shipments FROM shipments;
SELECT 100.0 * SUM(on_time) / COUNT(*) AS on_time_pct FROM shipments;
SELECT COUNT(*) - SUM(on_time) AS late_shipments FROM shipments;
SELECT AVG(transit_days) AS average_transit_days FROM shipments;
SELECT SUM(weight_kg) AS weight_kg FROM shipments;
SELECT carrier, 100.0 * SUM(on_time) / COUNT(*) AS on_time_pct FROM shipments GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: shipments, on-time share, late shipments, transit time, weight. Do we deliver on time?
- `line` of daily shipments. Volume peaks?
- `bar` of on-time % by carrier. Which carrier is reliable?
- `histogram` of transit days. How long do shipments really take?

## Traps

- Undelivered shipments have no transit time yet: leave them out of averages and say so.
- A rate of rates: on-time % across carriers divides sums, not an average of percentages.
- Time zones decide which day a delivery counts for.
- Weight units (kg, lb) and chargeable versus actual weight differ.
- Splits and re-deliveries: one shipment id may have several legs.

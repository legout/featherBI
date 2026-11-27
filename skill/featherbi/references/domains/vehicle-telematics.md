# Vehicle telematics

Playbook for brainstorming mode. Example: `examples/vehicle-telematics/`.

## Detection signals

A `vehicle`/`device` id, a trip or ping timestamp, `distance_km`/`odometer`, `speed`, `fuel_l`, event counts such as `harsh_brakes` or `idle_min`. Grain: one row per trip (or per GPS ping).

## Interview questions

- Who is it for: fleet manager, driver coach or finance? Default: fleet manager.
- Is a row a trip or a ping? Default: trip; pings need a trip id before distance is summed.
- Which safety events count (harsh brake, speeding, idle)? Default: the columns present.
- Break down by vehicle, driver or day? Default: vehicle.
- Is a target given (idle limit, km per vehicle)? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS trips FROM trips;
SELECT SUM(distance_km) AS distance_km FROM trips;
SELECT AVG(distance_km) AS average_trip_km FROM trips;
SELECT 100.0 * SUM(harsh_brakes) / NULLIF(SUM(distance_km), 0) AS brakes_per_100_km FROM trips;
SELECT vehicle, SUM(distance_km) AS distance_km, SUM(idle_min) AS idle_min FROM trips GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: trips, distance, average trip, harsh brakes, idle minutes. How much and how safely do we drive?
- `line` of daily distance. Which days are busy?
- `hbar` of distance by vehicle. Who is used most?
- `histogram` of trip distance. Short hops or long hauls?

## Traps

- Pings are not trips: summing per-ping distance double counts; sum per trip.
- Odometer is cumulative and can reset or be replaced; use differences, not values.
- Units: km versus miles, km/h versus mph; say which.
- Time zones: a trip across midnight belongs to its start day; say so.
- Rates need a denominator, and a zero one (an idle-only trip) makes the rate undefined: use `NULLIF(..., 0)`. Brakes per 100 km, not raw counts across unequal vehicles.

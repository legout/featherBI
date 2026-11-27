-- Generates trips.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 600 trips (i = 0 ... 599):
--   trip_id = i + 1; vehicle = 'V' || (i mod 6 + 1); trip_date = 2025-03-01 + (i mod 30) days
--   distance_km = 10 + 5 * (i mod 8); harsh_brakes = i mod 5; idle_min = i mod 10; max_speed_kmh = 60 + 10 * (i mod 6)
COPY (
  SELECT i + 1 AS trip_id,
         'V' || (i % 6 + 1) AS vehicle,
         DATE '2025-03-01' + (i % 30)::INTEGER AS trip_date,
         10 + 5 * (i % 8) AS distance_km,
         i % 5 AS harsh_brakes,
         i % 10 AS idle_min,
         60 + 10 * (i % 6) AS max_speed_kmh
  FROM range(600) t(i) ORDER BY i
) TO 'trips.parquet' (FORMAT parquet);

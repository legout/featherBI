-- Generates readings.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 4 meters x 672 quarter-hours (7 days from 2025-03-03 00:00): i = 0 ... 2687.
--   meter = 'M' || (i mod 4 + 1); slot = i div 4; read_at = start + 15 * slot minutes; hour = (slot mod 96) div 4
--   kwh (per 15 minutes) = (100 + 50 * (i mod 4) + 10 * hour) / 1000
COPY (
  SELECT TIMESTAMP '2025-03-03 00:00' + to_minutes((15 * (i // 4))::INTEGER) AS read_at,
         'M' || (i % 4 + 1) AS meter,
         ((100 + 50 * (i % 4) + 10 * ((i // 4) % 96 // 4))::DECIMAL(8,3) / 1000)::DECIMAL(6,3) AS kwh
  FROM range(2688) t(i)
  ORDER BY i
) TO 'readings.parquet' (FORMAT parquet);

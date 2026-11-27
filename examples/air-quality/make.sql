-- Generates readings.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 1008 hourly PM2.5 readings (i = 0 ... 1007): s = i mod 3 -> station Downtown, Suburb, Park; h = i // 3 (0 ... 335), read_at = 2025-03-03 00:00 + h hours
--   pm25 = [30, 20, 10][s] + (h // 24) + 20 when h mod 24 in 7..9, + 10 when h mod 24 in 17..19, else + 0
COPY (
  SELECT ['Downtown', 'Suburb', 'Park'][i % 3 + 1] AS station,
         TIMESTAMP '2025-03-03 00:00' + to_hours((i // 3)::INTEGER) AS read_at,
         [30, 20, 10][i % 3 + 1] + (i // 3) // 24
           + CASE WHEN (i // 3) % 24 BETWEEN 7 AND 9 THEN 20 WHEN (i // 3) % 24 BETWEEN 17 AND 19 THEN 10 ELSE 0 END AS pm25
  FROM range(1008) t(i) ORDER BY i
) TO 'readings.parquet' (FORMAT parquet);

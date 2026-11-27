-- Generates readings.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 4 sensors x 1440 minutes (one day, 2025-03-01): i = 0 ... 5759.
--   sensor = 'S' || (i mod 4 + 1); minute = i div 4; ts = 2025-03-01 00:00 + minute minutes
--   temp_c = 20 + (i mod 4) + (minute mod 60) / 10   (so 20.0 ... 28.9)
COPY (
  SELECT TIMESTAMP '2025-03-01 00:00' + to_minutes((i // 4)::INTEGER) AS ts,
         'S' || (i % 4 + 1) AS sensor,
         (((200 + 10 * (i % 4) + (i // 4) % 60)::DECIMAL(6,1)) / 10)::DECIMAL(5,1) AS temp_c
  FROM range(5760) t(i)
  ORDER BY i
) TO 'readings.parquet' (FORMAT parquet);

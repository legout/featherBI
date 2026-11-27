-- Generates observations.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 270 daily observations (i = 0 ... 269): s = i mod 3 -> station Coast, Valley, Peak; d = i // 3 (0 ... 89), day = 2025-01-01 + d days
--   temp_c = [10, 14, 2][s] + d mod 10; precip_mm = [4, 2, 8][s] when d mod 6 = 5, else 0
COPY (
  SELECT ['Coast', 'Valley', 'Peak'][i % 3 + 1] AS station,
         DATE '2025-01-01' + (i // 3)::INTEGER AS day,
         [10, 14, 2][i % 3 + 1] + (i // 3) % 10 AS temp_c,
         CASE WHEN (i // 3) % 6 = 5 THEN [4, 2, 8][i % 3 + 1] ELSE 0 END AS precip_mm
  FROM range(270) t(i) ORDER BY i
) TO 'observations.parquet' (FORMAT parquet);

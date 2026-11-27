-- Generates tests.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- One row per unit, i = 0 ... 9999, one unit every 30 s from 2025-03-03 06:00.
--   serial = 'SN' || i (5 digits); station = 'ST' || (i mod 4 + 1)
--   result = FAIL if i mod 25 = 0, else PASS; with j = i div 25, fail_code = F01 if j mod 4 is 0 or 1, F02 if 2, F03 if 3
--   meas_mv = 4800 + 10 * (i mod 50); limits lsl 4850, usl 5250 (millivolt)
COPY (
  SELECT TIMESTAMP '2025-03-03 06:00' + to_seconds(30 * i) AS tested_at,
         'SN' || lpad(i::VARCHAR, 5, '0') AS serial,
         'ST' || (i % 4 + 1) AS station,
         CASE WHEN i % 25 = 0 THEN 'FAIL' ELSE 'PASS' END AS result,
         CASE WHEN i % 25 <> 0 THEN NULL
              WHEN (i // 25) % 4 <= 1 THEN 'F01'
              WHEN (i // 25) % 4 = 2 THEN 'F02'
              ELSE 'F03' END AS fail_code,
         4800 + 10 * (i % 50) AS meas_mv,
         4850 AS lsl,
         5250 AS usl
  FROM range(10000) t(i)
  ORDER BY i
) TO 'tests.parquet' (FORMAT parquet);

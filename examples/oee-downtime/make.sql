-- Generates shifts.parquet and downtime.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 3 machines x 20 days, one 480-minute shift each (i = 0 ... 59), from 2025-03-03.
--   machine = 'M' || (i mod 3 + 1); day = i div 3; shift_date = 2025-03-03 + day
--   one stop per shift at 09:00 lasting 30 * (i mod 3 + 1) minutes (M1 30, M2 60, M3 90)
--   reason by day mod 4: 0 and 1 'Jam', 2 'Changeover', 3 'Tool break'
--   run_min = 480 - stop; ideal rate 2 parts/min; produced = run_min * 19 / 10; scrap = produced div 50
CREATE TEMP TABLE g AS
  SELECT 'M' || (i % 3 + 1) AS machine,
         DATE '2025-03-03' + (i // 3)::INTEGER AS shift_date,
         30 * (i % 3 + 1) AS stop_min,
         CASE (i // 3) % 4 WHEN 0 THEN 'Jam' WHEN 1 THEN 'Jam' WHEN 2 THEN 'Changeover' ELSE 'Tool break' END AS reason
  FROM range(60) t(i);
COPY (
  SELECT machine, shift_date, 480 AS planned_min, 480 - stop_min AS run_min, 2 AS ideal_per_min,
         (480 - stop_min) * 19 // 10 AS produced, ((480 - stop_min) * 19 // 10) // 50 AS scrap
  FROM g ORDER BY shift_date, machine
) TO 'shifts.parquet' (FORMAT parquet);
COPY (
  SELECT machine, shift_date::TIMESTAMP + INTERVAL 9 HOUR AS start_at,
         shift_date::TIMESTAMP + INTERVAL 9 HOUR + to_minutes(stop_min) AS end_at, reason
  FROM g ORDER BY shift_date, machine
) TO 'downtime.parquet' (FORMAT parquet);

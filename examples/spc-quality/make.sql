-- Generates samples.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 100 hourly subgroups of 5 shaft diameters, i = 0 ... 499, from 2025-03-03 00:00.
--   subgroup = i div 5 + 1; pos = i mod 5
--   diameter_mm = 10 + ((subgroup mod 5) - 2) * 0.004 + (pos - 2) * 0.01, plus 0.1 in subgroup 77 (a deliberate shift)
COPY (
  SELECT TIMESTAMP '2025-03-03 00:00' + to_hours((i // 5)::INTEGER) AS sampled_at,
         i // 5 + 1 AS subgroup,
         ((10000 + ((i // 5 + 1) % 5 - 2) * 4 + (i % 5 - 2) * 10 + CASE WHEN i // 5 + 1 = 77 THEN 100 ELSE 0 END) / 1000.0)::DECIMAL(7,3) AS diameter_mm
  FROM range(500) t(i)
  ORDER BY i
) TO 'samples.parquet' (FORMAT parquet);

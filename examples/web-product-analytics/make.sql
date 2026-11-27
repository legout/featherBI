-- Generates sessions.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 2 000 sessions (i = 0 ... 1999):
--   session_id = i + 1; day = 2025-03-01 + (i mod 14) days
--   source by i mod 4: Search, Direct, Social, Email; pages = 1 + i mod 5
--   converted = 1 when i mod 25 = 4 (such a session has 5 pages), else 0
COPY (
  SELECT i + 1 AS session_id,
         DATE '2025-03-01' + (i % 14)::INTEGER AS day,
         ['Search', 'Direct', 'Social', 'Email'][i % 4 + 1] AS source,
         1 + i % 5 AS pages,
         CASE WHEN i % 25 = 4 THEN 1 ELSE 0 END AS converted
  FROM range(2000) t(i) ORDER BY i
) TO 'sessions.parquet' (FORMAT parquet);

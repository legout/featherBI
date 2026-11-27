-- Generates logs.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 2 000 log events (i = 0 ... 1999), one per minute:
--   ts = 2025-03-01 00:00 + i minutes; service by i mod 4: api, db, auth, web
--   level by i mod 10: ERROR at 0, WARN at 1 and 2, else INFO; latency_ms = 50 + 10 * (i mod 10)
COPY (
  SELECT TIMESTAMP '2025-03-01 00:00' + to_minutes(i::INTEGER) AS ts,
         ['api', 'db', 'auth', 'web'][i % 4 + 1] AS service,
         CASE WHEN i % 10 = 0 THEN 'ERROR' WHEN i % 10 IN (1, 2) THEN 'WARN' ELSE 'INFO' END AS level,
         50 + 10 * (i % 10) AS latency_ms
  FROM range(2000) t(i) ORDER BY i
) TO 'logs.parquet' (FORMAT parquet);

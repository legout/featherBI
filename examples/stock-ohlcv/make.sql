-- Generates prices.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 200 rows (i = 0 ... 199): ticker = AAA when i mod 2 = 0, else BBB; d = i // 2 (0 ... 99), day = 2025-01-01 + d days
--   open = 100 + 50 * (i mod 2) + d; close = open - 2 when d mod 4 = 3, else open + 1
--   high = max(open, close) + 2; low = min(open, close) - 1; volume = 1000 + 100 * (d mod 5)
COPY (
  SELECT ['AAA', 'BBB'][i % 2 + 1] AS ticker,
         DATE '2025-01-01' + (i // 2)::INTEGER AS day,
         100 + 50 * (i % 2) + i // 2 AS open,
         100 + 50 * (i % 2) + i // 2 + 2 + CASE WHEN (i // 2) % 4 = 3 THEN 0 ELSE 1 END AS high,
         100 + 50 * (i % 2) + i // 2 - 1 - CASE WHEN (i // 2) % 4 = 3 THEN 2 ELSE 0 END AS low,
         100 + 50 * (i % 2) + i // 2 + CASE WHEN (i // 2) % 4 = 3 THEN -2 ELSE 1 END AS close,
         1000 + 100 * ((i // 2) % 5) AS volume
  FROM range(200) t(i) ORDER BY i
) TO 'prices.parquet' (FORMAT parquet);

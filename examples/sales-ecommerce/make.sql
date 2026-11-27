-- Generates orders.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 1 000 orders (i = 0 ... 999), one line item each:
--   order_id = i + 1; order_date = 2025-03-01 + (i mod 30) days
--   channel by i mod 4: Web, App, Marketplace, Store; category by i mod 5: Books, Toys, Garden, Sports, Home
--   revenue = 20 + 10 * (i mod 10); units = 1 + i mod 3; returned = 1 when i mod 20 = 0, else 0
COPY (
  SELECT i + 1 AS order_id,
         DATE '2025-03-01' + (i % 30)::INTEGER AS order_date,
         ['Web', 'App', 'Marketplace', 'Store'][i % 4 + 1] AS channel,
         ['Books', 'Toys', 'Garden', 'Sports', 'Home'][i % 5 + 1] AS category,
         20 + 10 * (i % 10) AS revenue,
         1 + i % 3 AS units,
         CASE WHEN i % 20 = 0 THEN 1 ELSE 0 END AS returned
  FROM range(1000) t(i) ORDER BY i
) TO 'orders.parquet' (FORMAT parquet);

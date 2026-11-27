-- Generates subscriptions.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 300 subscriptions (i = 0 ... 299):
--   customer = 'C' || (i + 1); plan by i mod 3: Basic (mrr 10), Pro (30), Team (100)
--   started = 2025-01-01 + (i mod 6) months; status = 'churned' when i mod 5 = 0, else 'active'
COPY (
  SELECT 'C' || (i + 1) AS customer,
         ['Basic', 'Pro', 'Team'][i % 3 + 1] AS plan,
         [10, 30, 100][i % 3 + 1] AS mrr,
         DATE '2025-01-01' + to_months((i % 6)::INTEGER) AS started,
         CASE WHEN i % 5 = 0 THEN 'churned' ELSE 'active' END AS status
  FROM range(300) t(i) ORDER BY i
) TO 'subscriptions.parquet' (FORMAT parquet);

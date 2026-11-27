-- Generates work_orders.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 400 work orders (i = 0 ... 399):
--   work_order_id = i + 1; vehicle = 'V' || (i mod 8 + 1); opened = 2025-01-01 + (i mod 60) days
--   job by i mod 4: Oil, Brakes, Tires, Engine; cost = 100 + 50 * (i mod 8); downtime_days = 1 + i mod 4
--   preventive = 1 when i mod 5 = 0, else 0 (corrective)
COPY (
  SELECT i + 1 AS work_order_id,
         'V' || (i % 8 + 1) AS vehicle,
         DATE '2025-01-01' + (i % 60)::INTEGER AS opened,
         ['Oil', 'Brakes', 'Tires', 'Engine'][i % 4 + 1] AS job,
         100 + 50 * (i % 8) AS cost,
         1 + i % 4 AS downtime_days,
         CASE WHEN i % 5 = 0 THEN 1 ELSE 0 END AS preventive
  FROM range(400) t(i) ORDER BY i
) TO 'work_orders.parquet' (FORMAT parquet);

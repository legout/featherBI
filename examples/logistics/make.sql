-- Generates shipments.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 1 200 shipments (i = 0 ... 1199):
--   shipment_id = i + 1; ship_date = 2025-03-01 + (i mod 30) days
--   carrier by i mod 3: Alpha, Beta, Gamma; region by i mod 4: North, South, East, West
--   weight_kg = 5 + 5 * (i mod 6); transit_days = 1 + i mod 5; promised_days = 3; on_time = 1 when transit_days <= 3
COPY (
  SELECT i + 1 AS shipment_id,
         DATE '2025-03-01' + (i % 30)::INTEGER AS ship_date,
         ['Alpha', 'Beta', 'Gamma'][i % 3 + 1] AS carrier,
         ['North', 'South', 'East', 'West'][i % 4 + 1] AS region,
         5 + 5 * (i % 6) AS weight_kg,
         1 + i % 5 AS transit_days,
         3 AS promised_days,
         CASE WHEN 1 + i % 5 <= 3 THEN 1 ELSE 0 END AS on_time
  FROM range(1200) t(i) ORDER BY i
) TO 'shipments.parquet' (FORMAT parquet);

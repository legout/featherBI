-- Generates the 1 M-row volume fixture into the git-ignored fixtures/volume/sales.parquet.
-- Run from the repo root: duckdb < tools/gen-volume.sql
-- Same columns as fixtures/hand; the targets come from the committed fixtures/hand/targets.xlsx.
-- Deterministic: every value is a pure function of the row number i.
COPY (
  SELECT DATE '2025-01-01' + (i % 90)::INTEGER AS order_date,
         CASE WHEN i % 2 = 0 THEN 'EU' ELSE 'US' END AS region,
         CASE WHEN (i // 2) % 2 = 0 THEN 'Online' ELSE 'Retail' END AS channel,
         (((i % 10000) + 1)::DECIMAL(12,2) / 100)::DECIMAL(10,2) AS revenue
  FROM range(1000000) t(i)
  ORDER BY i
) TO 'fixtures/volume/sales.parquet' (FORMAT parquet);

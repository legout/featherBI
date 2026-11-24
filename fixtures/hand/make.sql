-- Regenerates the hand fixture. Run inside fixtures/hand: duckdb < make.sql
INSTALL excel; LOAD excel;
COPY (
  SELECT order_date, region, channel, revenue::DECIMAL(10,2) AS revenue
  FROM (VALUES
    (DATE '2025-01-05', 'EU', 'Online', 100.00),
    (DATE '2025-01-05', 'US', 'Online', 200.00),
    (DATE '2025-01-15', 'EU', 'Retail', 150.00),
    (DATE '2025-01-25', 'US', 'Retail', 250.00),
    (DATE '2025-02-05', 'EU', 'Online', 120.00),
    (DATE '2025-02-05', 'US', 'Online', 220.00),
    (DATE '2025-02-15', 'EU', 'Retail', 180.00),
    (DATE '2025-02-25', 'US', 'Retail', 270.00),
    (DATE '2025-03-05', 'EU', 'Online', 140.00),
    (DATE '2025-03-05', 'US', 'Online', 240.00),
    (DATE '2025-03-15', 'EU', 'Retail', 160.00),
    (DATE '2025-03-25', 'US', 'Retail', 230.50)
  ) AS t(order_date, region, channel, revenue)
) TO 'sales.parquet' (FORMAT parquet);
COPY (SELECT * FROM (VALUES ('EU', 800), ('US', 1500)) AS t(region, target))
  TO 'targets.xlsx' (FORMAT xlsx, HEADER true);

-- Generates employees.parquet next to this file. Run here: duckdb < make.sql
-- SYNTHETIC, anonymous rows only: never use this per-employee shape for real payroll data.
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 300 employees (i = 0 ... 299):
--   employee_id = i + 1; department by i mod 6: Engineering, Sales, Operations, Finance, People, Legal
--   hire_date = 2020-01-01 + 5 * i days; tenure_years = i mod 10; salary = 40000 + 5000 * (i mod 10)
--   left_company = 1 when i mod 25 = 0, else 0
COPY (
  SELECT i + 1 AS employee_id,
         ['Engineering', 'Sales', 'Operations', 'Finance', 'People', 'Legal'][i % 6 + 1] AS department,
         DATE '2020-01-01' + (5 * i)::INTEGER AS hire_date,
         i % 10 AS tenure_years,
         40000 + 5000 * (i % 10) AS salary,
         CASE WHEN i % 25 = 0 THEN 1 ELSE 0 END AS left_company
  FROM range(300) t(i) ORDER BY i
) TO 'employees.parquet' (FORMAT parquet);

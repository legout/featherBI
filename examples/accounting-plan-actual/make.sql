-- Generates ledger.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 144 lines (i = 0 ... 143): p = i mod 4 -> department Sales, Ops, R&D, Admin; a = (i // 4) mod 3 -> account Payroll, Travel, Software;
--   m = i // 12 (0 ... 11), month = 2025-01-01 + m months
--   plan = [1000, 200, 500][a] * (p + 1); actual = plan + plan // 5 when m mod 3 = 2, else plan - plan // 20 (costs: actual > plan is overspend)
COPY (
  SELECT ['Sales', 'Ops', 'R&D', 'Admin'][i % 4 + 1] AS dept,
         ['Payroll', 'Travel', 'Software'][(i // 4) % 3 + 1] AS account,
         DATE '2025-01-01' + to_months((i // 12)::INTEGER) AS month,
         [1000, 200, 500][(i // 4) % 3 + 1] * (i % 4 + 1) AS plan,
         [1000, 200, 500][(i // 4) % 3 + 1] * (i % 4 + 1)
           + CASE WHEN (i // 12) % 3 = 2 THEN [1000, 200, 500][(i // 4) % 3 + 1] * (i % 4 + 1) // 5
                  ELSE -([1000, 200, 500][(i // 4) % 3 + 1] * (i % 4 + 1) // 20) END AS actual
  FROM range(144) t(i) ORDER BY i
) TO 'ledger.parquet' (FORMAT parquet);

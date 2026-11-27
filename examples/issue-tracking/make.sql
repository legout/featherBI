-- Generates issues.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 500 issues (i = 0 ... 499):
--   issue_id = i + 1; opened = 2025-02-01 + (i mod 45) days; type by i mod 4: Bug, Feature, Task, Chore
--   status by i mod 5: Done at 0, 1, 2; In Progress at 3; Open at 4; points = 1 + i mod 5
COPY (
  SELECT i + 1 AS issue_id,
         DATE '2025-02-01' + (i % 45)::INTEGER AS opened,
         ['Bug', 'Feature', 'Task', 'Chore'][i % 4 + 1] AS type,
         CASE WHEN i % 5 <= 2 THEN 'Done' WHEN i % 5 = 3 THEN 'In Progress' ELSE 'Open' END AS status,
         1 + i % 5 AS points
  FROM range(500) t(i) ORDER BY i
) TO 'issues.parquet' (FORMAT parquet);

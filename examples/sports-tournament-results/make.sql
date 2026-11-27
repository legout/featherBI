-- Generates results.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 480 team-games (i = 0 ... 479), one row per team per game:
--   team = 'T' || (i mod 8 + 1); game_date = 2025-03-01 + (i div 16) days
--   goals_for = i mod 4; goals_against = i mod 3
--   result = Win when goals_for > goals_against, Draw when equal, else Loss; points = 3, 1, 0
COPY (
  SELECT 'T' || (i % 8 + 1) AS team,
         DATE '2025-03-01' + (i // 16)::INTEGER AS game_date,
         i % 4 AS goals_for,
         i % 3 AS goals_against,
         CASE WHEN i % 4 > i % 3 THEN 'Win' WHEN i % 4 = i % 3 THEN 'Draw' ELSE 'Loss' END AS result,
         CASE WHEN i % 4 > i % 3 THEN 3 WHEN i % 4 = i % 3 THEN 1 ELSE 0 END AS points
  FROM range(480) t(i) ORDER BY i
) TO 'results.parquet' (FORMAT parquet);

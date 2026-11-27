-- Generates results.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 240 games, each written once as two mirrored rows (i = 0 ... 479); game g = i div 2, side = i mod 2 (0 home, 1 away):
--   home team = T(g mod 8 + 1); away team = T((g mod 8 + 1 + (g div 8) mod 7) mod 8 + 1); game_date = 2025-03-01 + (g div 8) days
--   home goals h = g mod 4, away goals a = g mod 3; the away row mirrors the home row (goals swapped)
--   result = Win when goals_for > goals_against, Draw when equal, else Loss; points = 3, 1, 0
COPY (
  WITH g AS (SELECT i, i // 2 AS g, i % 2 AS side, (i // 2) % 4 AS h, (i // 2) % 3 AS a FROM range(480) t(i))
  SELECT 'T' || CASE WHEN side = 0 THEN g % 8 + 1 ELSE (g % 8 + 1 + (g // 8) % 7) % 8 + 1 END AS team,
         DATE '2025-03-01' + (g // 8)::INTEGER AS game_date,
         CASE WHEN side = 0 THEN h ELSE a END AS goals_for,
         CASE WHEN side = 0 THEN a ELSE h END AS goals_against,
         CASE WHEN h = a THEN 'Draw' WHEN (h > a) = (side = 0) THEN 'Win' ELSE 'Loss' END AS result,
         CASE WHEN h = a THEN 1 WHEN (h > a) = (side = 0) THEN 3 ELSE 0 END AS points
  FROM g ORDER BY i
) TO 'results.parquet' (FORMAT parquet);

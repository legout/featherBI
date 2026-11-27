# Sports tournament results

480 team-games (one row per team per game) over 30 days: `results.parquet` (`team`, `game_date`,
`goals_for`, `goals_against`, `result`, `points`). Playbook:
`skill/featherbi/references/domains/sports-tournament-results.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 479): `team = T(i mod 8 + 1)`; `game_date = 2025-03-01 + (i div 16)` days;
`goals_for = i mod 4`; `goals_against = i mod 3`; `result` Win when for > against, Draw when equal, else Loss;
`points` 3, 1, 0.

Pairs (for, against) repeat every 12 rows: (0,0) D, (1,1) D, (2,2) D, (3,0) W, (0,1) L, (1,2) L, (2,0) W,
(3,1) W, (0,2) L, (1,0) W, (2,1) W, (3,2) W: 6 wins, 3 draws, 3 losses; 480 / 12 = 40 cycles.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Team-games | `480` | rows 0 … 479 |
| Wins | `240` | 6 per cycle × 40 |
| Points | `840` | per cycle 6 · 3 + 3 · 1 = 21, × 40 |
| Goals for | `720` | per cycle 3 · (0 + 1 + 2 + 3) = 18, × 40 |
| Goals against | `480` | per cycle 4 · (0 + 1 + 2) = 12, × 40 |

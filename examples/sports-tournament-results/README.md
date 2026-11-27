# Sports tournament results

480 team-games (one row per team per game) over 30 days: `results.parquet` (`team`, `game_date`,
`goals_for`, `goals_against`, `result`, `points`). Playbook:
`skill/featherbi/references/domains/sports-tournament-results.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

240 games, each written once as two mirrored rows: game `g = i div 2` (0 … 239), side `i mod 2` (0 home, 1 away).
Home team `T(g mod 8 + 1)`, away team `T((g mod 8 + 1 + (g div 8) mod 7) mod 8 + 1)` (always a different team);
`game_date = 2025-03-01 + (g div 8)` days; home goals `h = g mod 4`, away goals `a = g mod 3`; the away row
swaps them. `result` is Win when `goals_for > goals_against`, Draw when equal, else Loss; `points` 3, 1, 0.

Pairs (h, a) repeat every 12 games: (0,0) D, (1,1) D, (2,2) D, (3,0) H, (0,1) A, (1,2) A, (2,0) H, (3,1) H,
(0,2) A, (1,0) H, (2,1) H, (3,2) H: 6 home wins, 3 draws, 3 away wins; 240 / 12 = 20 cycles. Every game is
mirrored, so wins equal losses and goals for equal goals against.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Team-games | `480` | 240 games × 2 rows |
| Wins | `180` | per cycle 6 home wins + 3 away wins = 9, × 20 (losses are 180 too) |
| Points | `660` | per cycle 9 decisive games × 3 + 3 draws × 2 = 33, × 20 |
| Goals for | `600` | per cycle h sums to 3 · (0 + 1 + 2 + 3) = 18 and a to 4 · (0 + 1 + 2) = 12, so 30, × 20 |
| Goals against | `600` | the same games with the sides swapped |

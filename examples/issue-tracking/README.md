# Issue tracking

500 issues opened over 45 days: `issues.parquet` (`issue_id`, `opened`, `type`, `status`, `points`).
Playbook: `skill/featherbi/references/domains/issue-tracking.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 499): `opened = 2025-02-01 + (i mod 45)` days; `type` by i mod 4 (Bug, Feature, Task, Chore);
`status` by i mod 5: Done at 0, 1, 2; In Progress at 3; Open at 4; `points = 1 + i mod 5`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Issues | `500` | rows 0 … 499 |
| Not done | `200` | i mod 5 = 3 or 4: 2 of every 5 rows |
| Done | `300` | i mod 5 = 0, 1, 2: 3 of every 5 rows |
| Bugs | `125` | i mod 4 = 0 |
| Average points | `3` | mean of 1 … 5 |

# Accounting plan vs actual

Four departments, three cost accounts, 12 months: `ledger.parquet` (144 lines: `dept`, `account`, `month`, `plan`, `actual`).
Playbook: `skill/featherbi/references/domains/accounting-plan-actual.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Line `i` (0 … 143): `dept` by i mod 4 (Sales, Ops, R&D, Admin, factor p + 1 = 1 … 4); `account` by (i div 4) mod 3
(Payroll 1 000, Travel 200, Software 500); `m = i div 12`, `month = 2025-01-01 + m` months; `plan = account base · (p + 1)`;
`actual = plan + plan div 5` when m mod 3 = 2 (overspend), else `plan − plan div 20`. Costs: variance = actual − plan, positive is overspend.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Plan | `204,000` | one month: (1 000 + 200 + 500) · (1 + 2 + 3 + 4) = 17 000; 12 months |
| Actual | `210,800` | 4 months (m = 2, 5, 8, 11) at 1.2 · 17 000 = 20 400, 8 months at 0.95 · 17 000 = 16 150: 81 600 + 129 200 |
| Variance | `6,800` | 210 800 − 204 000 |
| Variance % | `3.33` | 6 800 of 204 000 |
| Lines over plan | `48` | the 12 lines of each of the 4 overspend months |

Waterfall check: variance by account is Payroll 4 000, Software 2 000, Travel 800 (4 · account base).

# HR

300 employees: `employees.parquet` (`employee_id`, `department`, `hire_date`, `tenure_years`, `salary`,
`left_company`). Playbook: `skill/featherbi/references/domains/hr.md`. Synthetic and anonymous; the raw per-employee shape is for this fixture only, real HR data must be aggregated before snapshotting.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 299): `department` by i mod 6 (Engineering, Sales, Operations, Finance, People, Legal);
`hire_date = 2020-01-01 + 5 · i` days; `tenure_years = i mod 10`; `salary = 40000 + 5000 · (i mod 10)`
(40 000 … 85 000); `left_company = 1` when i mod 25 = 0.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Employees | `300` | rows 0 … 299 |
| Leavers | `12` | i mod 25 = 0: i = 0, 25, … 275 |
| Leaver share of hire cohort % | `4` | 12 of 300: share of exported employees who left, not period attrition |
| Average salary | `62,500` | mean of 40 000, 45 000, … 85 000 |
| Average tenure years | `4.5` | mean of 0 … 9 |

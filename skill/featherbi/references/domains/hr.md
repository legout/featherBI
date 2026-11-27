# HR

Playbook for brainstorming mode. Example: `examples/hr/`.

## Detection signals

An `employee_id`, a `department`, a `hire_date`, maybe a `termination_date` or `left` flag, `salary`, `tenure`. Grain: one row per employee.

## Interview questions

- Who is it for: HR lead, a department head or management? Default: HR lead.
- Is the data personal? Default: yes. Aggregate in the source SQL (`GROUP BY department`) before snapshotting; the snapshot embeds every row it reads, and Explore reads every column, so disabling Explore or averaging in tile SQL does not remove individual rows from the file.
- Is a period attrition rate needed? Default: no; the export has hire dates, not departure dates or average headcount, so show the leaver share of the hire cohort.
- Break down by department, location or level? Default: department.
- Is a target given (attrition, pay band)? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS employees FROM employees;
SELECT SUM(left_company) AS leavers FROM employees;
SELECT 100.0 * SUM(left_company) / NULLIF(COUNT(*), 0) AS leaver_share_pct FROM employees;
SELECT AVG(salary) AS average_salary FROM employees;
SELECT AVG(tenure_years) AS average_tenure_years FROM employees;
SELECT department, COUNT(*) AS employees FROM employees GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: employees, leavers, leaver share of hire cohort, average salary, average tenure. How is the workforce?
- `bar` of employees by department. Where are the people?
- `histogram` of salary. How is pay spread?
- `line` of hires per year. Are we growing?

## Traps

- Personal data: the example's raw rows are synthetic only. Real data: aggregate before snapshotting; hide groups of fewer than five people or say they are small.
- The date filter selects hire dates, so leavers over hires is a cohort share, not attrition; attrition needs departure dates and average headcount over the period.
- Salary: full-time equivalent versus actual, currency, and bonus are different.
- Survivorship: tenure of current staff alone understates leavers' short stays.
- Average of per-department averages is not the company average; divide sums.

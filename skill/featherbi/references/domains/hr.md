# HR

Playbook for brainstorming mode. Example: `examples/hr/`.

## Detection signals

An `employee_id`, a `department`, a `hire_date`, maybe a `termination_date` or `left` flag, `salary`, `tenure`. Grain: one row per employee.

## Interview questions

- Who is it for: HR lead, a department head or management? Default: HR lead.
- Is the data personal? Default: aggregate only; no names, no individual salaries on the page.
- Attrition over what period and against which headcount? Default: leavers of the export over all employees in it.
- Break down by department, location or level? Default: department.
- Is a target given (attrition, pay band)? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS employees FROM employees;
SELECT SUM(left_company) AS leavers FROM employees;
SELECT 100.0 * SUM(left_company) / COUNT(*) AS attrition_pct FROM employees;
SELECT AVG(salary) AS average_salary FROM employees;
SELECT AVG(tenure_years) AS average_tenure_years FROM employees;
SELECT department, COUNT(*) AS employees FROM employees GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: employees, leavers, attrition, average salary, average tenure. How is the workforce?
- `bar` of employees by department. Where are the people?
- `histogram` of salary. How is pay spread?
- `line` of hires per year. Are we growing?

## Traps

- Personal data: aggregate; hide groups of fewer than five people or say they are small.
- Attrition needs average headcount over the period, not the end count; say which you used.
- Salary: full-time equivalent versus actual, currency, and bonus are different.
- Survivorship: tenure of current staff alone understates leavers' short stays.
- Average of per-department averages is not the company average; divide sums.
